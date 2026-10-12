from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class UserCreate(BaseModel):
    nickname: str
    password: str


class UserLogin(BaseModel):
    nickname: str
    password: str


class UserResponse(BaseModel):
    id: int
    nickname: str
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True  # позволяет читать данные из SQLAlchemy-объектов


class ChatCreate(BaseModel):
    nickname: str


class ChatResponse(BaseModel):
    # -1 у виртуального чата «Избранное», настоящей строки в chats у него нет
    id: int
    title: str
    is_favorites: bool = False
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None


class ChatListResponse(BaseModel):
    chats: List[ChatResponse]


class MessageCreate(BaseModel):
    chat_id: int
    text: str
    reply_to_id: Optional[int] = None


class MessageResponse(BaseModel):
    id: int
    chat_id: Optional[int] = None
    sender_id: int
    sender_nickname: Optional[str] = None
    text: Optional[str]
    created_at: datetime
    reply_to_id: Optional[int] = None
    is_favorite: bool = False