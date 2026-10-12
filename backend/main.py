from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.orm import Session, aliased
from sqlalchemy.exc import IntegrityError
from typing import Dict, List
import json
import os

from database import engine, get_db, SessionLocal
import models, schemas, auth

# Схема создаётся через init.sql — он же единственный источник правды

app = FastAPI(title="Messenger API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Виртуальный чат «Избранное»: строки в chats и chat_members у него нет,
# сообщения лежат с chat_id = NULL и is_favorite = TRUE.
FAVORITES_CHAT_ID = -1
FAVORITES_TITLE = "Избранное"

# ==========================================
# Общие помощники
# ==========================================

def is_favorites(chat_id: int) -> bool:
    return chat_id == FAVORITES_CHAT_ID


# ==========================================
# REST API
# ==========================================

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Server is running"}


def can_access_chat(db: Session, user: models.User, chat_id: int) -> bool:
    """Доступ к обычному чату — только через участие в нём."""
    if is_favorites(chat_id):
        return True
    member = (
        db.query(models.ChatMember)
        .filter(models.ChatMember.chat_id == chat_id, models.ChatMember.user_id == user.id)
        .first()
    )
    return member is not None


def chat_member_ids(db: Session, chat_id: int) -> List[int]:
    return [
        row.user_id
        for row in db.query(models.ChatMember).filter(models.ChatMember.chat_id == chat_id).all()
    ]


def serialize_message(msg: models.Message, nickname: str | None) -> schemas.MessageResponse:
    return schemas.MessageResponse(
        id=msg.id,
        chat_id=msg.chat_id,
        sender_id=msg.sender_id,
        sender_nickname=nickname,
        text=msg.text,
        created_at=msg.created_at,
        reply_to_id=msg.reply_to_id,
        is_favorite=msg.is_favorite,
    )


# ==========================================
# REST API
# ==========================================

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Server is running"}

@app.post("/api/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    nickname = user.nickname.strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="Nickname is empty")

    # Проверяем, занят ли никнейм
    existing = db.query(models.User).filter(models.User.nickname == nickname).first()
    if existing:
        raise HTTPException(status_code=400, detail="Nickname already taken")

    new_user = models.User(
        nickname=nickname,
        password_hash=auth.get_password_hash(user.password)
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/login")
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.nickname == credentials.nickname.strip()).first()
    if not user or not auth.verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid nickname or password")

    token = auth.create_access_token({"sub": user.nickname, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "nickname": user.nickname
    }

@app.get("/api/users", response_model=list[schemas.UserResponse])
def get_users(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return db.query(models.User).filter(models.User.id != current_user.id).all()

# ---------- Чаты ----------

@app.get("/api/chats", response_model=schemas.ChatListResponse)
def get_chats(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    # «Избранное» всегда первым — это виртуальная папка, а не строка в chats
    last_favorite = (
        db.query(models.Message)
        .filter(models.Message.is_favorite == True, models.Message.sender_id == current_user.id)
        .order_by(models.Message.created_at.desc())
        .first()
    )
    chats = [
        schemas.ChatResponse(
            id=FAVORITES_CHAT_ID,
            title=FAVORITES_TITLE,
            is_favorites=True,
            last_message=last_favorite.text if last_favorite else None,
            last_message_at=last_favorite.created_at if last_favorite else None,
        )
    ]

    last_msg = aliased(models.Message)
    rows = (
        db.query(models.Chat, last_msg.text, last_msg.created_at)
        .join(models.ChatMember, models.ChatMember.chat_id == models.Chat.id)
        .outerjoin(last_msg, models.Chat.last_message_id == last_msg.id)
        .filter(models.ChatMember.user_id == current_user.id)
        # свежие чаты всплывают наверх, без сообщений — по дате создания
        .order_by(func.coalesce(last_msg.created_at, models.Chat.created_at).desc())
        .all()
    )

    for chat, last_text, last_at in rows:
        title = chat.name
        if chat.type == "private":
            other_nickname = (
                db.query(models.User.nickname)
                .join(models.ChatMember, models.ChatMember.user_id == models.User.id)
                .filter(
                    models.ChatMember.chat_id == chat.id,
                    models.User.id != current_user.id,
                )
                .scalar()
            )
            title = other_nickname or chat.name or "Личный чат"
        chats.append(
            schemas.ChatResponse(
                id=chat.id,
                title=title or "Без названия",
                is_favorites=False,
                last_message=last_text,
                last_message_at=last_at,
            )
        )

    return {"chats": chats}

@app.post("/api/chats", response_model=schemas.ChatResponse)
def create_chat(
    payload: schemas.ChatCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    other = db.query(models.User).filter(models.User.nickname == payload.nickname.strip()).first()
    if not other:
        raise HTTPException(status_code=404, detail="User with this nickname not found")
    if other.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot create chat with yourself")

    pair_key = f"{min(current_user.id, other.id)}:{max(current_user.id, other.id)}"
    chat = db.query(models.Chat).filter(models.Chat.pair_key == pair_key).first()

    if not chat:
        chat = models.Chat(type="private", pair_key=pair_key)
        db.add(chat)
        try:
            db.flush()
            db.add_all([
                models.ChatMember(chat_id=chat.id, user_id=current_user.id),
                models.ChatMember(chat_id=chat.id, user_id=other.id),
            ])
            db.commit()
        except IntegrityError:
            # Гонка: параллельный запрос успел создать тот же чат раньше
            db.rollback()
            chat = db.query(models.Chat).filter(models.Chat.pair_key == pair_key).first()
            if not chat:
                raise HTTPException(status_code=409, detail="Could not create chat")
        db.refresh(chat)

    return schemas.ChatResponse(
        id=chat.id,
        title=other.nickname,
        is_favorites=False,
        last_message=None,
        last_message_at=None,
    )


# ---------- Сообщения ----------

@app.get("/api/messages/{chat_id}", response_model=list[schemas.MessageResponse])
def get_messages(
    chat_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not can_access_chat(db, current_user, chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")

    query = db.query(models.Message, models.User.nickname).join(
        models.User, models.User.id == models.Message.sender_id
    )
    if is_favorites(chat_id):
        # «Избранное» приватно: видно только то, что добавил сам пользователь
        query = query.filter(
            models.Message.is_favorite == True,
            models.Message.sender_id == current_user.id,
        )
    else:
        query = query.filter(models.Message.chat_id == chat_id, models.Message.is_deleted == False)

    rows = query.order_by(models.Message.created_at.desc(), models.Message.id.desc()).limit(limit).all()
    rows.reverse()  # в чате сообщения идут снизу вверх
    return [serialize_message(msg, nickname) for msg, nickname in rows]

@app.post("/api/messages", response_model=schemas.MessageResponse)
def send_message(
    payload: schemas.MessageCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Message text is empty")
    if not can_access_chat(db, current_user, payload.chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")

    if is_favorites(payload.chat_id):
        msg = models.Message(
            chat_id=None,
            sender_id=current_user.id,
            text=payload.text,
            reply_to_id=payload.reply_to_id,
            is_favorite=True,
        )
    else:
        msg = models.Message(
            chat_id=payload.chat_id,
            sender_id=current_user.id,
            text=payload.text,
            reply_to_id=payload.reply_to_id,
            is_favorite=False,
        )

    db.add(msg)
    db.commit()
    db.refresh(msg)
    return serialize_message(msg, current_user.nickname)

@app.post("/api/messages/{message_id}/favorite", response_model=schemas.MessageResponse)
def toggle_favorite(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    msg = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    # В избранное можно добавить только своё сообщение
    if msg.sender_id != current_user.id:
        raise HTTPException(status_code=403, detail="Can favorite own messages only")

    msg.is_favorite = not msg.is_favorite
    db.commit()
    db.refresh(msg)
    return serialize_message(msg, current_user.nickname)

# ==========================================
# WebSocket для real-time сообщений
# ==========================================

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

    async def send_to_users(self, user_ids: List[int], message: dict):
        payload = json.dumps(message, default=str)
        for user_id in user_ids:
            for ws in list(self.active.get(user_id, [])):
                try:
                    await ws.send_text(payload)
                except Exception:
                    self.disconnect(user_id, ws)

manager = ConnectionManager()

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, token: str = ""):
    # Без проверки токена можно было бы подключиться за чужого пользователя
    payload = auth.decode_access_token(token)
    if not payload or payload.get("user_id") != user_id:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user_id)
    db = SessionLocal()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                chat_id = data["chat_id"]
                text = data.get("text")
            except (json.JSONDecodeError, KeyError):
                await websocket.send_text(json.dumps({"error": "Malformed message"}))
                continue
            if not text or not text.strip():
                await websocket.send_text(json.dumps({"error": "Empty message"}))
                continue

            user = db.query(models.User).filter(models.User.id == user_id).first()
            if not user or not can_access_chat(db, user, chat_id):
                await websocket.send_text(json.dumps({"error": "No access to this chat"}))
                continue

            msg = models.Message(
                chat_id=None if is_favorites(chat_id) else chat_id,
                sender_id=user_id,
                text=text,
                reply_to_id=data.get("reply_to_id"),
                is_favorite=is_favorites(chat_id),
            )
            db.add(msg)
            db.commit()
            db.refresh(msg)

            # Рассылаем только участникам чата (в избранное — только автору)
            recipients = [user_id] if is_favorites(chat_id) else chat_member_ids(db, msg.chat_id)
            await manager.send_to_users(recipients, {
                "id": msg.id,
                "chat_id": chat_id,
                "sender_id": msg.sender_id,
                "sender_nickname": user.nickname,
                "text": msg.text,
                "created_at": str(msg.created_at),
                "reply_to_id": msg.reply_to_id,
                "is_favorite": msg.is_favorite,
            })
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)
        db.close()

# ==========================================
# Раздача фронтенда (должно быть В КОНЦЕ!)
# ==========================================
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")