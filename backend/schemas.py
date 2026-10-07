from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class UserCreate(BaseModel):
    username: str
    password: str
    nickname: Optional[str] = 'user'

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

class MessageCreate(BaseModel):
    chat_id: int
    text: str
    reply_to_id: Optional[int] = None

class MessageResponse(BaseModel):
    id: int
    chat_id: int
    sender_id: int
    text: Optional[str]
    created_at: datetime
    reply_to_id: Optional[int] = None

    class Config:
        from_attributes = True