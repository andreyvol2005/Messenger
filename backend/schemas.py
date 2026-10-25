from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


class UserCreate(BaseModel):
    username: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    nickname: str
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True  # позволяет читать данные из SQLAlchemy-объектов


class ProfileResponse(BaseModel):
    # Свой профиль: к данным UserResponse добавлена дата рождения
    id: int
    username: str
    nickname: str
    bio: Optional[str] = None
    birth_date: Optional[date] = None
    avatar_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    # Все поля необязательные: PATCH меняет только то, что пришло в запросе
    username: Optional[str] = None
    nickname: Optional[str] = None
    bio: Optional[str] = None
    birth_date: Optional[date] = None


class AccountDeleteRequest(BaseModel):
    """Запрос на безвозвратное удаление аккаунта."""
    password: str
    confirmation_phrase: str
    two_fa_token: Optional[str] = None


class ContactCreate(BaseModel):
    username: str


class ChatCreate(BaseModel):
    username: str


class ChatResponse(BaseModel):
    # -1 у виртуального чата «Избранное», настоящей строки в chats у него нет
    id: int
    title: str
    is_favorites: bool = False
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    # Только для личных чатов: собеседник и признак того, что он уже в контактах
    peer_username: Optional[str] = None
    is_contact: bool = False


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