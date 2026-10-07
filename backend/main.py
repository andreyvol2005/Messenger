from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import Dict
import json
import os

from database import engine, get_db, SessionLocal
import models, schemas, auth

# Создаём таблицы, если их нет (на случай если init.sql не применён)
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Messenger API")

# CORS — разрешаем запросы с любых доменов (для разработки)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# REST API
# ==========================================

@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Server is running"}

@app.post("/api/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # Проверяем, занят ли username
    existing = db.query(models.User).filter(models.User.username == user.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    new_user = models.User(
        username=user.username,
        password_hash=auth.get_password_hash(user.password),
        nickname=user.nickname
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/login")
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == credentials.username).first()
    if not user or not auth.verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    token = auth.create_access_token({"sub": user.username, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": user.username,
        "nickname": user.nickname
    }

@app.get("/api/users", response_model=list[schemas.UserResponse])
def get_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()

# ==========================================
# WebSocket для real-time сообщений
# ==========================================

class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, WebSocket] = {}  # user_id -> WebSocket

    async def connect(self, ws: WebSocket, user_id: int):
        await ws.accept()
        self.active[user_id] = ws

    def disconnect(self, user_id: int):
        self.active.pop(user_id, None)

    async def broadcast(self, message: dict):
        for ws in self.active.values():
            try:
                await ws.send_text(json.dumps(message, default=str))
            except:
                pass

manager = ConnectionManager()

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int):
    await manager.connect(websocket, user_id)
    db = SessionLocal()
    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            
            # Сохраняем сообщение в БД
            msg = models.Message(
                chat_id=data["chat_id"],
                sender_id=user_id,
                text=data.get("text"),
                reply_to_id=data.get("reply_to_id")
            )
            db.add(msg)
            db.commit()
            db.refresh(msg)
            
            # Рассылаем всем
            await manager.broadcast({
                "id": msg.id,
                "chat_id": msg.chat_id,
                "sender_id": msg.sender_id,
                "text": msg.text,
                "created_at": str(msg.created_at),
                "reply_to_id": msg.reply_to_id
            })
    except WebSocketDisconnect:
        manager.disconnect(user_id)
    finally:
        db.close()

# ==========================================
# Раздача фронтенда (должно быть В КОНЦЕ!)
# ==========================================
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")