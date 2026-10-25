"""Рассылка событий по WebSocket.

Модуль нужен, потому что отправка идёт двумя путями: обычным POST из приложения
и с самого сокета. Событие должно уйти подписчикам в обоих случаях, поэтому
рассылка живёт здесь, а не внутри ws-обработчика.
"""
import json
from typing import Dict, List

from fastapi import WebSocket
from sqlalchemy.orm import Session

import services


class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, List[WebSocket]] = {}  # user_id -> список сокетов

    async def connect(self, ws: WebSocket, user_id: int):
        await ws.accept()
        self.active.setdefault(user_id, []).append(ws)

    def disconnect(self, user_id: int, ws: WebSocket):
        sockets = self.active.get(user_id)
        if not sockets:
            return
        if ws in sockets:
            sockets.remove(ws)
        if not sockets:
            self.active.pop(user_id, None)

    def disconnect_all(self, user_id: int):
        """Разрывает все WebSocket-соединения пользователя (например, при удалении аккаунта)."""
        sockets = self.active.pop(user_id, [])
        for ws in list(sockets):
            try:
                ws.close()
            except Exception:
                pass

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


async def publish(recipients: List[int], event: dict):
    await manager.send_to_users(recipients, event)


async def publish_message(db: Session, msg, chat_id: int, sender_nickname: str | None):
    """Отправляет подписчикам чата событие о новом сообщении."""
    await publish(recipients_for(db, msg, chat_id), build_event(msg, chat_id, sender_nickname))