"""Рассылка событий по WebSocket.

Модуль нужен, потому что отправка идёт двумя путями: обычным POST из приложения
и с самого сокета. Событие должно уйти подписчикам в обоих случаях, поэтому
рассылка живёт здесь, а не внутри ws-обработчика.
"""
import json
from datetime import datetime
from typing import Dict, List

from fastapi import WebSocket
from sqlalchemy.orm import Session

import models
import services


class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, List[WebSocket]] = {}  # user_id -> список сокетов

    async def connect(self, ws: WebSocket, user_id: int) -> bool:
        """Подключает сокет и сообщает, был ли пользователь до этого офлайн.

        Несколько вкладок одного пользователя не должны давать повторный
        «вошёл в сеть»: событие шлём только на переходе 0 → 1 сокет.
        """
        await ws.accept()
        was_online = bool(self.active.get(user_id))
        self.active.setdefault(user_id, []).append(ws)
        return not was_online

    def is_online(self, user_id: int) -> bool:
        return bool(self.active.get(user_id))

    def disconnect(self, user_id: int, ws: WebSocket) -> bool:
        """Убирает сокет и сообщает, ушёл ли пользователь в офлайн.

        Последняя закрытая вкладка — переход 1 → 0; тогда собеседникам нужно
        отправить событие. Пока остаётся хотя бы один сокет, пользователь онлайн.
        """
        sockets = self.active.get(user_id)
        if not sockets:
            return False
        if ws in sockets:
            sockets.remove(ws)
        if sockets:
            return False
        self.active.pop(user_id, None)
        return True

    async def disconnect_all(self, user_id: int) -> bool:
        """Разрывает все сокеты пользователя. True — если он был в сети."""
        sockets = self.active.pop(user_id, [])
        for ws in list(sockets):
            try:
                # WebSocket.close в Starlette — корутина: без await сокет
                # останется открытым, а клиент продолжит получать события.
                await ws.close()
            except Exception:
                pass
        return bool(sockets)

    async def send_to_users(self, user_ids: List[int], message: dict):
        payload = json.dumps(message, default=str)
        for user_id in user_ids:
            for ws in list(self.active.get(user_id, [])):
                try:
                    await ws.send_text(payload)
                except Exception:
                    self.disconnect(user_id, ws)

    async def send_error(self, ws: WebSocket, detail: str):
        await ws.send_text(json.dumps({"error": detail}))


manager = ConnectionManager()


def recipients_for(db: Session, msg, chat_id: int) -> List[int]:
    # В избранное сообщение видно только автору, в обычном чате — всем участникам
    if services.is_favorites(chat_id):
        return [msg.sender_id]
    return services.chat_member_ids(db, msg.chat_id)


def build_event(msg, chat_id: int, sender_nickname: str | None) -> dict:
    return {
        "type": "message",
        "id": msg.id,
        # chat_id для избранного приходит как -1: бэк хранит NULL,
        # а клиенту удобнее знать тот же id, по которому он писал
        "chat_id": chat_id,
        "sender_id": msg.sender_id,
        "sender_nickname": sender_nickname,
        "text": msg.text,
        "media_url": msg.media_url,
        # Именно isoformat, а не str: браузер не понимает "2026-10-13 10:16:18"
        # через пробел и показал бы Invalid Date. Формат совпадает с REST.
        "created_at": msg.created_at.isoformat(),
        "reply_to_id": msg.reply_to_id,
        "is_favorite": msg.is_favorite,
    }


def build_receipt_event(
    chat_id: int, user_id: int, delivered_to: int, read_by: int
) -> dict:
    """Событие о том, что участник получил/прочитал сообщения в чате.

    delivered_to и read_by — уже агрегированные отметки: для получателя это
    минимум по остальным участникам. В группе одного события недостаточно
    рассылать всем: у каждого свой набор собеседников.
    """
    return {
        "type": "status",
        "chat_id": chat_id,
        "user_id": user_id,
        "last_delivered_message_id": delivered_to,
        "last_read_message_id": read_by,
    }


def chat_peer_ids(db: Session, user_id: int) -> set[int]:
    """Пользователи, с которыми у данного есть общий чат."""
    chat_ids = db.query(models.ChatMember.chat_id).filter(
        models.ChatMember.user_id == user_id
    )
    return {
        row.user_id
        for row in (
            db.query(models.ChatMember.user_id)
            .filter(
                models.ChatMember.chat_id.in_(chat_ids),
                models.ChatMember.user_id != user_id,
            )
            .all()
        )
    }


def related_user_ids(db: Session, user_id: int) -> List[int]:
    """Кому показать изменения профиля и присутствия этого пользователя.

    Это люди, у которых он есть в контактах (они сохранили его), и собеседники
    по общим чатам. Обратное направление здесь не нужно: если пользователь сам
    сохранил кого-то, тот ещё не видит его у себя.
    """
    recipients = {user_id}

    for row in (
        db.query(models.Contact.user_id)
        .filter(models.Contact.contact_user_id == user_id)
        .all()
    ):
        recipients.add(row.user_id)

    recipients.update(chat_peer_ids(db, user_id))
    return list(recipients)


def visible_user_ids(db: Session, user_id: int) -> List[int]:
    """Кого видит сам пользователь: свои контакты и собеседники по чатам.

    Для начального снимка присутствия направление контактов обратное
    related_user_ids: пользователю нужны статусы тех, кого он сохранил.
    """
    recipients = {user_id}

    for row in (
        db.query(models.Contact.contact_user_id)
        .filter(models.Contact.user_id == user_id)
        .all()
    ):
        recipients.add(row.contact_user_id)

    recipients.update(chat_peer_ids(db, user_id))
    return list(recipients)


def avatar_recipients(db: Session, user_id: int) -> List[int]:
    """Кому показать смену аватарки: сам пользователь, его контакты и собеседники."""
    return related_user_ids(db, user_id)


def online_related_ids(db: Session, user_id: int) -> List[int]:
    """Кто из видимых пользователей сейчас на связи."""
    return [uid for uid in visible_user_ids(db, user_id) if manager.is_online(uid)]


def visible_last_seen(db: Session, user_id: int) -> Dict[int, datetime]:
    """Когда в последний раз были в сети видимые пользователи.

    Нужно для начального снимка: WebSocket сообщает только об изменениях,
    а «был в …» для тех, кто уже офлайн, клиент узнаёт здесь.
    """
    visible = visible_user_ids(db, user_id)
    rows = (
        db.query(models.User.id, models.User.last_seen_at)
        .filter(
            models.User.id.in_(visible),
            models.User.last_seen_at.is_not(None),
        )
        .all()
    )
    return {row.id: row.last_seen_at for row in rows}


def build_presence_event(
    user_id: int, online: bool, last_seen_at: datetime | None = None
) -> dict:
    return {
        "type": "presence",
        "user_id": user_id,
        "online": online,
        # Для офлайна это и есть время последней активности; для онлайна —
        # момент подключения. None бывает только при удалении аккаунта.
        "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
    }


async def publish_presence(
    db: Session,
    user_id: int,
    online: bool,
    last_seen_at: datetime | None = None,
):
    """Сообщает контактам и собеседникам о входе или выходе пользователя."""
    await publish(
        related_user_ids(db, user_id),
        build_presence_event(user_id, online, last_seen_at),
    )


def build_typing_event(chat_id: int, user_id: int) -> dict:
    return {
        "type": "typing",
        "chat_id": chat_id,
        "user_id": user_id,
    }


async def publish_typing(db: Session, user_id: int, chat_id: int):
    """Эфемерное «печатает…» — только остальным участникам чата.

    Состояние не хранится ни в базе, ни в памяти сервера: клиент присылает
    событие, пока набирает текст, а получатель гасит индикатор по таймауту.
    """
    if services.is_favorites(chat_id):
        return

    recipients = [
        member_id
        for member_id in services.chat_member_ids(db, chat_id)
        if member_id != user_id
    ]
    if recipients:
        await publish(recipients, build_typing_event(chat_id, user_id))


async def disconnect_user_everywhere(user_id: int):
    """Закрывает все сокеты пользователя и сообщает, что он вышел.

    Нужно при удалении аккаунта: обработчик сокета не увидит перехода 1 → 0,
    потому что соединения уже убраны из active.
    """
    if not await manager.disconnect_all(user_id):
        return

    # Сессия запроса к этому моменту уже закрыта, поэтому открываем свою.
    from database import SessionLocal

    db = SessionLocal()
    try:
        await publish_presence(db, user_id, False)
    except Exception:
        # Пользователя уже удаляют; сбой рассылки не должен ломать очистку.
        pass
    finally:
        db.close()


def build_avatar_event(user: models.User) -> dict:
    """Событие для уже открытых клиентов: обновить аватар без перезагрузки."""
    return {
        "type": "avatar_updated",
        "user_id": user.id,
        "username": user.username,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
    }


async def publish(recipients: List[int], event: dict):
    await manager.send_to_users(recipients, event)


async def publish_message(db: Session, msg, chat_id: int, sender_nickname: str | None):
    """Отправляет подписчикам чата событие о новом сообщении."""
    await publish(recipients_for(db, msg, chat_id), build_event(msg, chat_id, sender_nickname))