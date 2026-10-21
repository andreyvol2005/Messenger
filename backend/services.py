"""Бизнес-логика чатов и сообщений. Роутеры только разбирают HTTP и зовут сюда."""
from typing import List

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

import models
import schemas
from constants import FAVORITES_CHAT_ID, FAVORITES_TITLE


# ==========================================
# Общие помощники
# ==========================================

def is_favorites(chat_id: int) -> bool:
    return chat_id == FAVORITES_CHAT_ID


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


# ==========================================
# Чаты
# ==========================================

def list_chats(db: Session, user: models.User) -> schemas.ChatListResponse:
    # «Избранное» всегда первым — это виртуальная папка, а не строка в chats
    last_favorite = (
        db.query(models.Message)
        .filter(models.Message.is_favorite == True, models.Message.sender_id == user.id)
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
        .filter(models.ChatMember.user_id == user.id)
        # свежие чаты всплывают наверх, без сообщений — по дате создания
        .order_by(func.coalesce(last_msg.created_at, models.Chat.created_at).desc())
        .all()
    )

    for chat, last_text, last_at in rows:
        title = chat.name
        if chat.type == "private":
            title = _other_nickname(db, chat.id, user.id) or chat.name or "Личный чат"
        chats.append(
            schemas.ChatResponse(
                id=chat.id,
                title=title or "Без названия",
                is_favorites=False,
                last_message=last_text,
                last_message_at=last_at,
            )
        )

    return schemas.ChatListResponse(chats=chats)


def _other_nickname(db: Session, chat_id: int, user_id: int) -> str | None:
    """Ник собеседника в личном чате (у группы вернёт None)."""
    return (
        db.query(models.User.nickname)
        .join(models.ChatMember, models.ChatMember.user_id == models.User.id)
        .filter(models.ChatMember.chat_id == chat_id, models.User.id != user_id)
        .scalar()
    )


def create_or_get_chat(db: Session, user: models.User, nickname: str) -> schemas.ChatResponse:
    """Создаёт личный чат с пользователем или возвращает уже существующий."""
    other = db.query(models.User).filter(models.User.nickname == nickname.strip()).first()
    if not other:
        raise HTTPException(status_code=404, detail="User with this nickname not found")
    if other.id == user.id:
        raise HTTPException(status_code=400, detail="Cannot create chat with yourself")

    pair_key = f"{min(user.id, other.id)}:{max(user.id, other.id)}"
    chat = db.query(models.Chat).filter(models.Chat.pair_key == pair_key).first()

    if not chat:
        chat = _insert_private_chat(db, pair_key, user.id, other.id)

    return schemas.ChatResponse(
        id=chat.id,
        title=other.nickname,
        is_favorites=False,
        last_message=None,
        last_message_at=None,
    )


def _insert_private_chat(db: Session, pair_key: str, first_id: int, second_id: int) -> models.Chat:
    chat = models.Chat(type="private", pair_key=pair_key)
    db.add(chat)
    try:
        db.flush()
        db.add_all([
            models.ChatMember(chat_id=chat.id, user_id=first_id),
            models.ChatMember(chat_id=chat.id, user_id=second_id),
        ])
        db.commit()
    except IntegrityError:
        # Гонка: параллельный запрос успел создать тот же чат раньше
        db.rollback()
        existing = db.query(models.Chat).filter(models.Chat.pair_key == pair_key).first()
        if not existing:
            raise HTTPException(status_code=409, detail="Could not create chat")
        return existing
    db.refresh(chat)
    return chat


# ==========================================
# Сообщения
# ==========================================

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


def list_messages(
    db: Session, user: models.User, chat_id: int, limit: int = 50
) -> List[schemas.MessageResponse]:
    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")

    query = db.query(models.Message, models.User.nickname).join(
        models.User, models.User.id == models.Message.sender_id
    )
    if is_favorites(chat_id):
        # «Избранное» приватно: видно только то, что добавил сам пользователь
        query = query.filter(
            models.Message.is_favorite == True,
            models.Message.sender_id == user.id,
        )
    else:
        query = query.filter(models.Message.chat_id == chat_id, models.Message.is_deleted == False)

    rows = query.order_by(
        models.Message.created_at.desc(), models.Message.id.desc()
    ).limit(limit).all()
    rows.reverse()  # в чате сообщения идут снизу вверх
    return [serialize_message(msg, nickname) for msg, nickname in rows]


def create_message(
    db: Session,
    user: models.User,
    chat_id: int,
    text: str,
    reply_to_id: int | None = None,
) -> schemas.MessageResponse:
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Message text is empty")
    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")

    # В избранном chat_id не хранится — строка в chats просто не нужна
    msg = models.Message(
        chat_id=None if is_favorites(chat_id) else chat_id,
        sender_id=user.id,
        text=text,
        reply_to_id=reply_to_id,
        is_favorite=is_favorites(chat_id),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return serialize_message(msg, user.nickname)


def toggle_favorite(
    db: Session, user: models.User, message_id: int
) -> schemas.MessageResponse:
    msg = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    # В избранное можно добавить только своё сообщение
    if msg.sender_id != user.id:
        raise HTTPException(status_code=403, detail="Can favorite own messages only")

    msg.is_favorite = not msg.is_favorite
    db.commit()
    db.refresh(msg)
    return serialize_message(msg, user.nickname)