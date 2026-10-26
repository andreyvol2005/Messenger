from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Date
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    # Логин: уникальный, хранится с ведущим «@», регистр учитывается
    username = Column(String(31), unique=True, index=True, nullable=False)
    # Отображаемое имя: может повторяться, без «@»
    nickname = Column(String(30), nullable=False)
    # При безвозвратном удалении стираем (становится NULL) — вход невозможен.
    password_hash = Column(Text, nullable=True)
    bio = Column(String(150), nullable=True)
    birth_date = Column(Date, nullable=True)
    avatar_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Мягкое удаление: deleted_at != NULL означает аккаунт безвозвратно удалён.
    # Мы не удаляем строку физически, чтобы не ломать FK messages.sender_id -> users(id)
    # и не 파괴ть историю групповチャтов (сообщения остаются, автор — «Удалённый пользователь»).
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    deleted_reason = Column(Text, nullable=True)


class AccountDeletionJob(Base):
    """Outbox/Saga: гарантирует, что асинхронная очистка (S3, Redis, поиск, push)
    не потеряется при падении воркера. Принцип at-least-once + идемпотентность."""
    __tablename__ = "account_deletion_jobs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending")  # pending | done | failed
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=5)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


class Chat(Base):
    __tablename__ = "chats"
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(10), nullable=False)
    name = Column(String(50), nullable=True)
    # Личный чат: "min_id:max_id" участников, защищает от дублей. NULL у групповых
    pair_key = Column(String(32), unique=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_message_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)

class ChatMember(Base):
    __tablename__ = "chat_members"
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Максимальные id сообщений, которые клиент уже получил и прочитал.
    # Статус своего сообщения отправитель считает по этим отметкам остальных.
    last_delivered_message_id = Column(Integer, nullable=True)
    last_read_message_id = Column(Integer, nullable=True)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    # NULL = сообщение в «Избранном» (виртуальная папка, строки в chats нет)
    chat_id = Column(Integer, ForeignKey("chats.id", ondelete="CASCADE"), nullable=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=True)
    media_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    reply_to_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    is_deleted = Column(Boolean, default=False)
    is_favorite = Column(Boolean, nullable=False, default=False)

class Contact(Base):
    __tablename__ = "contacts"
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    contact_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)