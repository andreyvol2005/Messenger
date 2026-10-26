import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

import auth
import events
import models
import services
from database import SessionLocal

router = APIRouter(tags=["websocket"])


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
        user = db.query(models.User).filter(
            models.User.id == user_id,
            models.User.deleted_at.is_(None),
        ).first()
        if not user:
            await websocket.close(code=1008)
            return

        await events.manager.connect(websocket, user_id)
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    data = json.loads(raw)
                    chat_id = data["chat_id"]
                    text = data.get("text")
                except (json.JSONDecodeError, KeyError):
                    await events.manager.send_error(websocket, "Malformed message")
                    continue
                if not text or not text.strip():
                    await events.manager.send_error(websocket, "Empty message")
                    continue

                # Аккаунт могли удалить уже после подключения (например,
                # запрос пришёл на другой процесс) — перепроверяем перед
                # каждым сообщением.
                user = db.query(models.User).filter(
                    models.User.id == user_id,
                    models.User.deleted_at.is_(None),
                ).first()
                if not user:
                    await websocket.close(code=1008)
                    return

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
            events.manager.disconnect(user_id, websocket)
    finally:
        db.close()
