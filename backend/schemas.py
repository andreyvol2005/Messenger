from pydantic import BaseModel
from typing import Dict, Optional, List
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
    theme: str = "dark"
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
    theme: str = "dark"
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    # Все поля необязательные: PATCH меняет только то, что пришло в запросе
    username: Optional[str] = None
    nickname: Optional[str] = None
    bio: Optional[str] = None
    birth_date: Optional[date] = None
    theme: Optional[str] = None


class AccountDeleteRequest(BaseModel):
    """Запрос на безвозвратное удаление аккаунта."""
    password: str
    confirmation_phrase: str
    two_fa_token: Optional[str] = None


class ContactCreate(BaseModel):
    username: str


class ChatCreate(BaseModel):
    username: str


class GroupChatCreate(BaseModel):
    name: str
    user_ids: List[int] = []


class ChatMemberAdd(BaseModel):
    user_id: int


class ChatMemberResponse(BaseModel):
    id: int
    nickname: str
    avatar_url: Optional[str] = None
    # Не обязателен по контракту, но удобен интерфейсу для подписи @username
    username: Optional[str] = None


class ChatResponse(BaseModel):
    # -1 у виртуального чата «Избранное», настоящей строки в chats у него нет
    id: int
    title: str
    is_favorites: bool = False
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    # Только для личных чатов: собеседник, его аватар и признак того,
    # что он уже в контактах. peer_id нужен для индикатора «в сети».
    peer_id: Optional[int] = None
    peer_username: Optional[str] = None
    avatar_url: Optional[str] = None
    is_contact: bool = False
    # Входящие сообщения, которые пользователь ещё не прочитал (бейдж в списке)
    unread_count: int = 0
    # "private" | "group": интерфейсу нужно отличать группу от личного чата,
    # даже если у группы ещё нет ни одного сообщения.
    chat_type: str = "private"
    # Число участников — только у группового чата
    members_count: Optional[int] = None


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
    # Относительный путь вида /uploads/images/<uuid>.jpg; None у текстовых сообщений
    media_url: Optional[str] = None
    created_at: datetime
    reply_to_id: Optional[int] = None
    is_favorite: bool = False
    # sent | delivered | read. Показывается только у своих сообщений
    status: str = "sent"


class ReceiptUpdate(BaseModel):
    message_id: int


class PresenceResponse(BaseModel):
    # id связанных пользователей, у которых сейчас есть открытый WebSocket
    online: List[int]
    # Время последней активности связанных пользователей. Ключи — id,
    # значения — ISO-время; для тех, кто ещё ни разу не подключался, пары нет.
    last_seen: Dict[int, datetime] = {}


class ReceiptResponse(BaseModel):
    chat_id: int
    user_id: int
    last_delivered_message_id: Optional[int] = None
    last_read_message_id: Optional[int] = None

    class Config:
        from_attributes = True
