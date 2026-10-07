from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Date
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(20), unique=True, index=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    nickname = Column(String(50), default='user')
    bio = Column(String(150), nullable=True)
    birth_date = Column(Date, nullable=True)
    avatar_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Chat(Base):
    __tablename__ = "chats"
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(10), nullable=False)
    name = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)

class ChatMember(Base):
    __tablename__ = "chat_members"
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=True)
    media_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    reply_to_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    is_deleted = Column(Boolean, default=False)

class Contact(Base):
    __tablename__ = "contacts"
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    contact_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)