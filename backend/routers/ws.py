import json
from datetime import datetime, timezone

import anyio
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

import auth
import events
import models
import services
from database import SessionLocal

router = APIRouter(tags=["websocket"])

# Обработчик сокета асинхронный, а SQLAlchemy здесь синхронная. Любой запрос
# к базе прямо в корутине остановил бы event loop, и пока он идёт, ждали бы
# все остальные сокеты и HTTP-запросы. Поэтому вся работа с базой собрана в
# обычные функции ниже и вызывается через run_in_threadpool, а в корутине
# остаются только приём и отправка по сети.


def release_read_transaction(db):
    """Закрывает транзакцию после чтения.

    Сокет живёт часами, и если оставить транзакцию открытой, её блокировки
    держат таблицы и не дают применить миграции. Пишущие операции коммитят
    сами, поэтому здесь достаточно отката.
    """
    try:
        db.rollback()
    except Exception:
        pass


def active_user(db, user_id: int):
    """Пользователь, если аккаунт ещё не удалён."""
    return (
        db.query(models.User)
        .filter(
            models.User.id == user_id,
            models.User.deleted_at.is_(None),
        )
        .first()
    )


def _check_user(db, user_id: int) -> bool:
    try:
        return active_user(db, user_id) is not None
    finally:
        # Проверка пользователя — только чтение; не держим её транзакцию,
        # пока сокет ждёт следующего сообщения.
        release_read_transaction(db)


def _go_online(db, user_id: int) -> tuple[list[int], datetime]:
    """Запоминает момент входа и возвращает, кому сообщить о нём."""
    try:
        # Запоминаем активность до рассылки: если процесс упадёт, у
        # собеседников останется корректное «был в …».
        last_seen = datetime.now(timezone.utc)
        db.query(models.User).filter(models.User.id == user_id).update({models.User.last_seen_at: last_seen})
        db.commit()
        return events.related_user_ids(db, user_id), last_seen
    finally:
        release_read_transaction(db)


def _go_offline(db, user_id: int) -> tuple[list[int], datetime | None]:
    """Запоминает момент выхода и возвращает, кому сообщить о нём."""
    last_seen = None
    try:
        user = active_user(db, user_id)
        if user:
            last_seen = datetime.now(timezone.utc)
            user.last_seen_at = last_seen
            db.commit()
    except Exception:
        # Сбой записи не должен мешать сообщить собеседникам,
        # что человек ушёл в офлайн.
        db.rollback()
    try:
        return events.related_user_ids(db, user_id), last_seen
    finally:
        release_read_transaction(db)


def _typing_targets(db, user_id: int, chat_id: int) -> tuple[bool, list[int], str | None]:
    """(аккаунт жив, кому слать «печатает…», ник автора)."""
    try:
        # Аккаунт могли удалить уже после подключения (например,
        # запрос пришёл на другой процесс) — перепроверяем.
        user = active_user(db, user_id)
        if not user:
            return False, [], None
        if not services.can_access_chat(db, user, chat_id):
            return True, [], None
        return True, events.typing_recipients(db, user_id, chat_id), user.nickname
    finally:
        release_read_transaction(db)


def _send_message(db, user_id: int, chat_id: int, text: str, reply_to_id) -> tuple[str, object, object]:
    """Сохраняет сообщение с сокета.

    Возвращает ("closed", None, None), если аккаунт удалён,
    ("error", detail, None) при ошибке валидации/доступа и
    ("ok", получатели, событие) при успехе.
    """
    try:
        # Перепроверяем аккаунт перед каждым сообщением.
        user = active_user(db, user_id)
        if not user:
            return "closed", None, None
        try:
            result = services.create_message(db, user, chat_id, text, reply_to_id)
        except HTTPException as exc:
            return "error", exc.detail, None
        recipients = events.recipients_for(db, result, chat_id)
        return "ok", recipients, events.build_event(result, chat_id, user.nickname)
    finally:
        # Чтения и рассылка могли открыть транзакцию — закрываем её,
        # чтобы сокет не блокировал таблицы между сообщениями.
        release_read_transaction(db)


@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, token: str = ""):
    # Без проверки токена можно было бы подключиться за чужого пользователя
    payload = auth.decode_access_token(token)
    if not payload or payload.get("user_id") != user_id:
        await websocket.close(code=1008)
        return

    db = SessionLocal()
    try:
        # JWT живёт сутки, поэтому одной проверки подписи мало: после удаления
        # аккаунта старый токен не должен открывать сокет.
        if not await run_in_threadpool(_check_user, db, user_id):
            await websocket.close(code=1008)
            return

        became_online = await events.manager.connect(websocket, user_id)
        if became_online:
            # Первая вкладка пользователя: контакты и собеседники видят зелёную точку
            recipients, last_seen = await run_in_threadpool(_go_online, db, user_id)
            await events.publish(recipients, events.build_presence_event(user_id, True, last_seen))
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    await events.manager.send_error(websocket, "Malformed message")
                    continue
                if not isinstance(data, dict):
                    await events.manager.send_error(websocket, "Malformed message")
                    continue

                chat_id = data.get("chat_id")
                if not isinstance(chat_id, int):
                    await events.manager.send_error(websocket, "Malformed message")
                    continue

                # «Печатает…» — эфемерное событие, в базу не пишем
                if data.get("type") == "typing":
                    alive, recipients, nickname = await run_in_threadpool(_typing_targets, db, user_id, chat_id)
                    if not alive:
                        await websocket.close(code=1008)
                        return
                    if recipients:
                        await events.publish(recipients, events.build_typing_event(chat_id, user_id, nickname))
                    continue

                text = data.get("text")
                if not isinstance(text, str) or not text.strip():
                    await events.manager.send_error(websocket, "Empty message")
                    continue

                status, first, second = await run_in_threadpool(
                    _send_message, db, user_id, chat_id, text, data.get("reply_to_id")
                )
                if status == "closed":
                    await websocket.close(code=1008)
                    return
                if status == "error":
                    await events.manager.send_error(websocket, first)
                    continue
                await events.publish(first, second)
        except WebSocketDisconnect:
            pass
        finally:
            # Последняя закрытая вкладка — пользователь ушёл в офлайн.
            # Обработчик в этот момент могут отменять (закрытие соединения,
            # остановка сервера), поэтому блок защищён от отмены: иначе «был
            # в …» не запишется, а собеседники так и увидят человека в сети.
            if events.manager.disconnect(user_id, websocket):
                with anyio.CancelScope(shield=True):
                    try:
                        recipients, last_seen = await run_in_threadpool(_go_offline, db, user_id)
                        await events.publish(recipients, events.build_presence_event(user_id, False, last_seen))
                    except Exception:
                        # Сокет уже закрыт, сбой рассылки не должен всплывать наружу.
                        pass
    finally:
        with anyio.CancelScope(shield=True):
            await run_in_threadpool(db.close)
