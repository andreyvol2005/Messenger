"""Бизнес-логика чатов, сообщений и контактов. Роутеры только разбирают HTTP и зовут сюда."""
from datetime import datetime, timezone
from typing import List

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

import auth
import models
import schemas
import validation
from constants import FAVORITES_CHAT_ID, FAVORITES_TITLE


# ==========================================
# Константы удаления аккаунта
# ==========================================

CONFIRM_PHRASE = "УДАЛИТЬ АККАУНТ"
DELETED_DISPLAY_NAME = "Удалённый пользователь"


# ==========================================
# Удаление аккаунта
# ==========================================

def schedule_delete_account(
    db: Session,
    user: models.User,
    password: str,
    confirmation_phrase: str,
    two_fa_token: str | None = None,
) -> models.User:
    """Помечает аккаунт удалённым (tombstone) и ставит задачу на физическую очистку.

    Идемпотентен: повторный вызов на уже удалённом аккаунте не создаёт новую джобу.
    """
    if user.deleted_at is not None:
        # Уже удалён — ничего не дублируем.
        return user

    # 1. Пароль
    if not auth.verify_password(password, user.password_hash):
        raise HTTPException(status_code=400, detail="Неверный пароль")

    # 2. Контрольная фраза — защита от случайного нажатия
    if confirmation_phrase.strip() != CONFIRM_PHRASE:
        raise HTTPException(
            status_code=400,
            detail=f"Контрольная фраза не совпадает. Напишите ровно: {CONFIRM_PHRASE}",
        )

    # 3. 2FA (заглушка — подключить реальную проверку при внедрении 2FA)
    if two_fa_token is not None:
        if not _verify_two_fa(user.id, two_fa_token):
            raise HTTPException(status_code=401, detail="Неверный код 2FA")

    # 4. Транзакция: мягкое удаление + outbox-джоба
    user.deleted_at = datetime.now(timezone.utc)
    user.deleted_reason = "user_requested"
    user.password_hash = None  # стираем учётные данные сразу
    user.nickname = DELETED_DISPLAY_NAME  # анти-impersonation + отображение в чатах
    db.add(user)

    job = models.AccountDeletionJob(user_id=user.id, status="pending")
    db.add(job)
    db.commit()
    db.refresh(user)

    return user


def _verify_two_fa(user_id: int, token: str) -> bool:
    """Заглушка проверки 2FA. Реализовать при подключении реального 2FA-провайдера."""
    return True


# ==========================================
# Общие помощники
# ==========================================

def is_favorites(chat_id: int) -> bool:
    return chat_id == FAVORITES_CHAT_ID


def can_access_chat(db: Session, user: models.User, chat_id: int) -> bool:
    """Доступ к обычному чату — только через участие в нём."""
    if user.deleted_at is not None:
        return False
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
# Контакты
# ==========================================

def list_contacts(db: Session, user: models.User) -> List[models.User]:
    # Удалённые пользователи не видны в контактах.
    return (
        db.query(models.User)
        .join(models.Contact, models.Contact.contact_user_id == models.User.id)
        .filter(
            models.Contact.user_id == user.id,
            models.User.deleted_at.is_(None),
        )
        .order_by(models.User.nickname)
        .all()
    )


def add_contact(db: Session, user: models.User, username: str) -> models.User:
    stored_username = validation.normalize_username(username)
    contact_user = (
        db.query(models.User)
        .filter(models.User.username == stored_username, models.User.deleted_at.is_(None))
        .first()
    )
    if not contact_user:
        raise HTTPException(
            status_code=404,
            detail="Пользователь с таким именем пользователя не найден",
        )
    if contact_user.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя добавить себя в контакты")

    existing = (
        db.query(models.Contact)
        .filter(
            models.Contact.user_id == user.id,
            models.Contact.contact_user_id == contact_user.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Этот пользователь уже в контактах")

    db.add(
        models.Contact(
            user_id=user.id,
            contact_user_id=contact_user.id,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Гонка: контакт успели добавить параллельным запросом
        db.rollback()
        raise HTTPException(status_code=409, detail="Этот пользователь уже в контактах")

    return contact_user


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
            last_message=(
                _message_preview(last_favorite.text, last_favorite.media_url)
                if last_favorite
                else None
            ),
            last_message_at=last_favorite.created_at if last_favorite else None,
        )
    ]

    contact_ids = {
        row.contact_user_id
        for row in db.query(models.Contact.contact_user_id)
        .filter(models.Contact.user_id == user.id)
        .all()
    }

    last_msg = aliased(models.Message)
    rows = (
        db.query(models.Chat, last_msg.text, last_msg.media_url, last_msg.created_at)
        .join(models.ChatMember, models.ChatMember.chat_id == models.Chat.id)
        .outerjoin(last_msg, models.Chat.last_message_id == last_msg.id)
        .filter(models.ChatMember.user_id == user.id)
        .order_by(func.coalesce(last_msg.created_at, models.Chat.created_at).desc())
        .all()
    )

    for chat, last_text, last_media, last_at in rows:
        title = chat.name
        peer_username = None
        is_contact = False
        if chat.type == "private":
            peer = _other_user(db, chat.id, user.id)
            if peer:
                # Удалённый собеседник отображается как «Удалённый пользователь»
                title = peer.nickname
                peer_username = peer.username
                is_contact = peer.id in contact_ids
            else:
                title = chat.name or "Личный чат"
        chats.append(
            schemas.ChatResponse(
                id=chat.id,
                title=title or "Без названия",
                is_favorites=False,
                last_message=_message_preview(last_text, last_media),
                last_message_at=last_at,
                peer_username=peer_username,
                is_contact=is_contact,
            )
        )

    return schemas.ChatListResponse(chats=chats)


def _message_preview(text: str | None, media_url: str | None) -> str | None:
    """Превью для списка чатов: у сообщения только с картинкой текста нет."""
    if text:
        return text
    if media_url:
        return "📷 Изображение"
    return None


def _other_user(db: Session, chat_id: int, user_id: int) -> models.User | None:
    """Собеседник в личном чате (у группы вернёт None). Удалённые возвращаются тоже —
    их nickname уже заменён на «Удалённый пользователь» при удалении."""
    return (
        db.query(models.User)
        .join(models.ChatMember, models.ChatMember.user_id == models.User.id)
        .filter(models.ChatMember.chat_id == chat_id, models.User.id != user_id)
        .first()
    )


def create_or_get_chat(db: Session, user: models.User, username: str) -> schemas.ChatResponse:
    """Создаёт личный чат с пользователем или возвращает уже существующий."""
    # Нельзя создать чат с удалённым пользователем.
    stored_username = validation.normalize_username(username)
    other = (
        db.query(models.User)
        .filter(models.User.username == stored_username, models.User.deleted_at.is_(None))
        .first()
    )
    if not other:
        raise HTTPException(status_code=404, detail="Пользователь с таким username не найден")
    if other.id == user.id:
        raise HTTPException(status_code=400, detail="Нельзя создать чат с самим собой")

    pair_key = f"{min(user.id, other.id)}:{max(user.id, other.id)}"
    chat = db.query(models.Chat).filter(models.Chat.pair_key == pair_key).first()

    if not chat:
        chat = _insert_private_chat(db, pair_key, user.id, other.id)

    is_contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.user_id == user.id,
            models.Contact.contact_user_id == other.id,
        )
        .first()
        is not None
    )

    return schemas.ChatResponse(
        id=chat.id,
        title=other.nickname,
        is_favorites=False,
        last_message=None,
        last_message_at=None,
        peer_username=other.username,
        is_contact=is_contact,
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
        media_url=msg.media_url,
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


def _insert_message(
    db: Session,
    user: models.User,
    chat_id: int,
    text: str | None,
    reply_to_id: int | None,
    media_url: str | None = None,
) -> models.Message:
    # В избранном chat_id не хранится — строка в chats просто не нужна
    msg = models.Message(
        chat_id=None if is_favorites(chat_id) else chat_id,
        sender_id=user.id,
        text=text,
        media_url=media_url,
        reply_to_id=reply_to_id,
        is_favorite=is_favorites(chat_id),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


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

    msg = _insert_message(db, user, chat_id, text, reply_to_id)
    return serialize_message(msg, user.nickname)


def create_image_message(
    db: Session,
    user: models.User,
    chat_id: int,
    media_url: str,
    caption: str | None = None,
    reply_to_id: int | None = None,
) -> schemas.MessageResponse:
    """Сообщение с картинкой: файл уже лежит на диске, в БД пишем только путь."""
    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")

    # Подпись необязательна: у сообщения только с картинкой text остаётся NULL
    text = caption.strip() if caption and caption.strip() else None
    msg = _insert_message(db, user, chat_id, text, reply_to_id, media_url=media_url)
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
