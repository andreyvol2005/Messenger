import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

import auth
import events
import models
import services
from database import SessionLocal

router = APIRouter(tags=["websocket"])


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
        user = active_user(db, user_id)
        if not user:
            await websocket.close(code=1008)
            return

        became_online = await events.manager.connect(websocket, user_id)
        if became_online:
            # Запоминаем активность до рассылки: если процесс упадёт, у
            # собеседников останется корректное «был в …».
            last_seen = datetime.now(timezone.utc)
            user.last_seen_at = last_seen
            db.commit()
            # Первая вкладка пользователя: контакты и собеседники видят зелёную точку
            await events.publish_presence(db, user_id, True, last_seen)
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

                # Аккаунт могли удалить уже после подключения (например,
                # запрос пришёл на другой процесс) — перепроверяем перед
                # каждым событием.
                user = active_user(db, user_id)
                if not user:
                    await websocket.close(code=1008)
                    return

                # «Печатает…» — эфемерное событие, в базу не пишем
                if data.get("type") == "typing":
                    chat_id = data.get("chat_id")
                    if not isinstance(chat_id, int):
                        await events.manager.send_error(websocket, "Malformed message")
                        continue
                    if services.can_access_chat(db, user, chat_id):
                        await events.publish_typing(db, user_id, chat_id)
                    continue

                chat_id = data.get("chat_id")
                text = data.get("text")
                if not isinstance(chat_id, int):
                    await events.manager.send_error(websocket, "Malformed message")
                    continue
                if not isinstance(text, str) or not text.strip():
                    await events.manager.send_error(websocket, "Empty message")
                    continue

                try:
                    result = services.create_message(
                        db, user, chat_id, text, data.get("reply_to_id")
                    )
                except HTTPException as exc:
                    await events.manager.send_error(websocket, exc.detail)
                    continue

                await events.publish_message(db, result, chat_id, user.nickname)
        except WebSocketDisconnect:
            pass
        finally:
            # Последняя закрытая вкладка — пользователь ушёл в офлайн
            if events.manager.disconnect(user_id, websocket):
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
                await events.publish_presence(db, user_id, False, last_seen)
    finally:
        db.close()
