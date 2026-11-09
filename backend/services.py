"""Бизнес-логика чатов, сообщений и контактов. Роутеры только разбирают HTTP и зовут сюда."""
from datetime import datetime, timezone
from typing import List

from fastapi import HTTPException
from sqlalchemy import and_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

import auth
import media
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
    # Учётные данные и персональные данные стираем сразу, не дожидаясь
    # фоновой очистки: после ответа их уже нельзя вернуть.
    user.password_hash = None
    user.bio = None
    user.birth_date = None
    user.avatar_url = None
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

def _unread_counts(db: Session, user_id: int) -> dict[int, int]:
    """Сколько входящих сообщений пользователь ещё не прочитал в каждом чате.

    Считаем не по времени, а по id: last_read_message_id — максимальный id,
    который клиент уже отметил прочитанным. Свои сообщения и удалённые не
    учитываются.
    """
    rows = (
        db.query(models.Message.chat_id, func.count(models.Message.id))
        .join(
            models.ChatMember,
            and_(
                models.ChatMember.chat_id == models.Message.chat_id,
                models.ChatMember.user_id == user_id,
            ),
        )
        .filter(
            models.Message.sender_id != user_id,
            models.Message.is_deleted.isnot(True),
            models.Message.id
            > func.coalesce(models.ChatMember.last_read_message_id, 0),
        )
        .group_by(models.Message.chat_id)
        .all()
    )
    return {chat_id: count for chat_id, count in rows}


def list_chats(db: Session, user: models.User) -> schemas.ChatListResponse:
    # «Избранное» — папка с копиями и заметками: настоящей строки в chats нет.
    last_favorite = (
        db.query(models.Message)
        .filter(
            models.Message.chat_id.is_(None),
            models.Message.sender_id == user.id,
        )
        .order_by(models.Message.created_at.desc(), models.Message.id.desc())
        .first()
    )
    chats = [
        schemas.ChatResponse(
            id=FAVORITES_CHAT_ID,
            title=FAVORITES_TITLE,
            is_favorites=True,
            last_message=(
                _message_preview(
                    last_favorite.text,
                    last_favorite.media_url,
                    last_favorite.is_deleted,
                )
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
    unread_by_chat = _unread_counts(db, user.id)

    last_msg = aliased(models.Message)
    rows = (
        db.query(
            models.Chat,
            last_msg.text,
            last_msg.media_url,
            last_msg.created_at,
            last_msg.is_deleted,
        )
        .join(models.ChatMember, models.ChatMember.chat_id == models.Chat.id)
        .outerjoin(last_msg, models.Chat.last_message_id == last_msg.id)
        .filter(models.ChatMember.user_id == user.id)
        .order_by(func.coalesce(last_msg.created_at, models.Chat.created_at).desc())
        .all()
    )
    group_ids = [chat.id for chat, *_ in rows if chat.type == "group"]
    group_counts = _group_member_counts(db, group_ids)

    for chat, last_text, last_media, last_at, last_deleted in rows:
        title = chat.name
        peer_id = None
        peer_username = None
        avatar_url = None
        is_contact = False
        if chat.type == "private":
            peer = _other_user(db, chat.id, user.id)
            if peer:
                # Удалённый собеседник отображается как «Удалённый пользователь»
                title = peer.nickname
                peer_id = peer.id
                peer_username = peer.username
                avatar_url = peer.avatar_url
                is_contact = peer.id in contact_ids
            else:
                title = chat.name or "Личный чат"
        else:
            # У группы нет собеседника: название и аватар хранятся в chats
            title = chat.name or "Группа"
            avatar_url = chat.avatar_url
        chats.append(
            schemas.ChatResponse(
                id=chat.id,
                title=title or "Без названия",
                is_favorites=False,
                last_message=_message_preview(last_text, last_media, bool(last_deleted)),
                last_message_at=last_at,
                peer_id=peer_id,
                peer_username=peer_username,
                avatar_url=avatar_url,
                is_contact=is_contact,
                unread_count=unread_by_chat.get(chat.id, 0),
                chat_type=chat.type,
                members_count=(
                    group_counts.get(chat.id)
                    if chat.type == "group"
                    else None
                ),
            )
        )

    return schemas.ChatListResponse(chats=chats)


def _group_member_counts(db: Session, chat_ids: List[int]) -> dict[int, int]:
    """Число участников для каждого группового чата одним запросом."""
    if not chat_ids:
        return {}
    rows = (
        db.query(models.ChatMember.chat_id, func.count(models.ChatMember.user_id))
        .filter(models.ChatMember.chat_id.in_(chat_ids))
        .group_by(models.ChatMember.chat_id)
        .all()
    )
    return {chat_id: count for chat_id, count in rows}


def _message_preview(
    text: str | None, media_url: str | None, is_deleted: bool = False
) -> str | None:
    """Превью для списка чатов: у сообщения только с картинкой текста нет."""
    if is_deleted:
        return "Сообщение удалено"
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
        peer_id=other.id,
        peer_username=other.username,
        avatar_url=other.avatar_url,
        is_contact=is_contact,
        chat_type="private",
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
# Групповые чаты
# ==========================================

def _get_chat(db: Session, chat_id: int) -> models.Chat:
    chat = db.query(models.Chat).filter(models.Chat.id == chat_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    return chat


def _require_group_member(
    db: Session, user: models.User, chat_id: int
) -> models.Chat:
    """Групповой чат, в котором текущий пользователь состоит участником.

    Ролей нет: любого участника достаточно и для смены названия/аватара,
    и для добавления или удаления других участников.
    """
    chat = _get_chat(db, chat_id)
    if chat.type != "group":
        raise HTTPException(status_code=400, detail="Это не групповой чат")
    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="Нет доступа к этому чату")
    return chat


def _group_chat_response(db: Session, chat: models.Chat) -> schemas.ChatResponse:
    count = (
        db.query(func.count(models.ChatMember.user_id))
        .filter(models.ChatMember.chat_id == chat.id)
        .scalar()
    ) or 0
    return schemas.ChatResponse(
        id=chat.id,
        title=chat.name or "Группа",
        avatar_url=chat.avatar_url,
        chat_type="group",
        members_count=count,
    )


def _serialize_member(user: models.User) -> schemas.ChatMemberResponse:
    return schemas.ChatMemberResponse(
        id=user.id,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        username=user.username,
    )


def create_group_chat(
    db: Session, user: models.User, name: str, user_ids: List[int]
) -> schemas.ChatResponse:
    """Создаёт группу, добавляя в неё автора и выбранных пользователей."""
    title = validation.validate_chat_name(name)

    # Себя добавляем сами; дубликаты в запросе не создают лишних строк.
    member_ids = {int(member_id) for member_id in user_ids if int(member_id) != user.id}
    if not member_ids:
        raise HTTPException(
            status_code=400,
            detail="Выберите хотя бы одного участника",
        )

    users = (
        db.query(models.User)
        .filter(
            models.User.id.in_(member_ids),
            models.User.deleted_at.is_(None),
        )
        .all()
    )
    found_ids = {member.id for member in users}
    if found_ids != member_ids:
        raise HTTPException(
            status_code=404,
            detail="Один из выбранных пользователей не найден",
        )

    chat = models.Chat(type="group", name=title)
    db.add(chat)
    try:
        db.flush()
        db.add_all([
            models.ChatMember(chat_id=chat.id, user_id=member_id)
            for member_id in sorted(member_ids | {user.id})
        ])
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(chat)
    return _group_chat_response(db, chat)


def list_group_members(
    db: Session, user: models.User, chat_id: int
) -> List[schemas.ChatMemberResponse]:
    _require_group_member(db, user, chat_id)
    members = (
        db.query(models.User)
        .join(models.ChatMember, models.ChatMember.user_id == models.User.id)
        .filter(models.ChatMember.chat_id == chat_id)
        .order_by(models.User.nickname)
        .all()
    )
    return [_serialize_member(member) for member in members]


def add_group_member(
    db: Session, user: models.User, chat_id: int, user_id: int
) -> schemas.ChatMemberResponse:
    _require_group_member(db, user, chat_id)

    target = (
        db.query(models.User)
        .filter(
            models.User.id == user_id,
            models.User.deleted_at.is_(None),
        )
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    existing = (
        db.query(models.ChatMember)
        .filter(
            models.ChatMember.chat_id == chat_id,
            models.ChatMember.user_id == user_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Пользователь уже состоит в группе",
        )

    db.add(models.ChatMember(chat_id=chat_id, user_id=user_id))
    try:
        db.commit()
    except IntegrityError:
        # Гонка: параллельный запрос успел добавить того же участника
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Пользователь уже состоит в группе",
        )

    return _serialize_member(target)


def remove_group_member(
    db: Session, user: models.User, chat_id: int, user_id: int
) -> None:
    _require_group_member(db, user, chat_id)

    member = (
        db.query(models.ChatMember)
        .filter(
            models.ChatMember.chat_id == chat_id,
            models.ChatMember.user_id == user_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Участник не найден")

    db.delete(member)
    db.commit()


def update_group_chat(
    db: Session,
    user: models.User,
    chat_id: int,
    name: str | None = None,
    avatar_data: bytes | None = None,
    avatar_extension: str | None = None,
) -> schemas.ChatResponse:
    """Меняет название и/или аватар группы. Доступно любому участнику."""
    chat = _require_group_member(db, user, chat_id)

    if name is None and avatar_data is None:
        raise HTTPException(status_code=400, detail="Нечего обновлять")

    if name is not None:
        chat.name = validation.validate_chat_name(name)

    old_avatar_url = chat.avatar_url
    new_avatar_url = None
    if avatar_data is not None:
        new_avatar_url = media.save_group_avatar(avatar_data, avatar_extension or ".png")
        chat.avatar_url = new_avatar_url

    try:
        db.commit()
    except Exception:
        db.rollback()
        # Файл уже записан, а строка в БД — нет: удаляем сироту.
        if new_avatar_url:
            media.delete_group_avatar(new_avatar_url)
        raise

    db.refresh(chat)
    # Старый файл удаляем только после успешного коммита
    if old_avatar_url and old_avatar_url != chat.avatar_url:
        media.delete_group_avatar(old_avatar_url)

    return _group_chat_response(db, chat)


# ==========================================
# Сообщения
# ==========================================

def _receipt_bounds(db: Session, chat_id: int, user_id: int) -> tuple[int, int]:
    """До какого сообщения дошли остальные участники чата.

    Для личного чата это один собеседник, для группового — минимум по всем:
    сообщение считается доставленным/прочитанным, когда его получили все.
    """
    rows = (
        db.query(
            models.ChatMember.last_delivered_message_id,
            models.ChatMember.last_read_message_id,
        )
        .filter(
            models.ChatMember.chat_id == chat_id,
            models.ChatMember.user_id != user_id,
        )
        .all()
    )
    if not rows:
        return 0, 0
    delivered = min((row[0] or 0) for row in rows)
    read = min((row[1] or 0) for row in rows)
    return delivered, read


def _message_status(
    msg: models.Message, user_id: int, delivered_to: int, read_by: int
) -> str:
    # Галочки есть только у своих сообщений, но статус считаем для всех:
    # так ответ API одинаково понятен и на случай будущих групповых чатов.
    if msg.sender_id != user_id:
        return "sent"
    if msg.id <= read_by:
        return "read"
    if msg.id <= delivered_to:
        return "delivered"
    return "sent"


def serialize_message(
    msg: models.Message,
    nickname: str | None,
    status: str = "sent",
    view_chat_id: int | None = None,
) -> schemas.MessageResponse:
    # В базе у «Избранного» chat_id = NULL, а клиент работает с -1.
    chat_id = view_chat_id if view_chat_id is not None else msg.chat_id
    if chat_id is None:
        chat_id = FAVORITES_CHAT_ID

    deleted = bool(msg.is_deleted)
    return schemas.MessageResponse(
        id=msg.id,
        chat_id=chat_id,
        sender_id=msg.sender_id,
        sender_nickname=nickname,
        # У заглушки не должно быть ни текста, ни картинки, ни цитаты.
        text=None if deleted else msg.text,
        media_url=None if deleted else msg.media_url,
        created_at=msg.created_at,
        reply_to_id=None if deleted else msg.reply_to_id,
        reply_to_nickname=None if deleted else msg.reply_to_nickname,
        reply_to_text=None if deleted else msg.reply_to_text,
        edited_at=msg.edited_at,
        forwarded_from_nickname=None if deleted else msg.forwarded_from_nickname,
        is_deleted=deleted,
        status=status,
    )


def _message_sender_nickname(db: Session, msg: models.Message) -> str | None:
    row = (
        db.query(models.User.nickname)
        .filter(models.User.id == msg.sender_id)
        .first()
    )
    return row[0] if row else None


def _serialize_for_user(
    db: Session,
    user: models.User,
    msg: models.Message,
    view_chat_id: int | None = None,
) -> schemas.MessageResponse:
    """Сериализация действия пользователя: ник, чат и актуальные галочки."""
    nickname = (
        user.nickname
        if msg.sender_id == user.id
        else _message_sender_nickname(db, msg)
    )
    chat_id = view_chat_id if view_chat_id is not None else msg.chat_id
    status = "sent"
    if chat_id not in (None, FAVORITES_CHAT_ID):
        delivered_to, read_by = _receipt_bounds(db, chat_id, user.id)
        status = _message_status(msg, user.id, delivered_to, read_by)
    return serialize_message(msg, nickname, status, view_chat_id=chat_id)


def list_messages(
    db: Session, user: models.User, chat_id: int, limit: int = 50
) -> List[schemas.MessageResponse]:
    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")

    query = db.query(models.Message, models.User.nickname).join(
        models.User, models.User.id == models.Message.sender_id
    )
    if is_favorites(chat_id):
        # «Избранное» приватно: заметки и копии принадлежат только владельцу
        query = query.filter(
            models.Message.chat_id.is_(None),
            models.Message.sender_id == user.id,
        )
    else:
        # Удалённые сообщения остаются в ленте заглушками
        query = query.filter(models.Message.chat_id == chat_id)

    rows = query.order_by(
        models.Message.created_at.desc(), models.Message.id.desc()
    ).limit(limit).all()
    rows.reverse()  # в чате сообщения идут снизу вверх

    delivered_to, read_by = (0, 0)
    if not is_favorites(chat_id):
        delivered_to, read_by = _receipt_bounds(db, chat_id, user.id)

    return [
        serialize_message(
            msg,
            nickname,
            _message_status(msg, user.id, delivered_to, read_by),
            view_chat_id=chat_id,
        )
        for msg, nickname in rows
    ]


def _reply_snapshot(
    db: Session,
    user: models.User,
    chat_id: int,
    reply_to_id: int | None,
) -> tuple[str | None, str | None]:
    """Проверяет оригинал и сохраняет снимок цитаты.

    Ответ разрешён и на удалённое сообщение: в цитате тогда будет заглушка.
    """
    if reply_to_id is None:
        return None, None

    row = (
        db.query(models.Message, models.User.nickname)
        .join(models.User, models.User.id == models.Message.sender_id)
        .filter(models.Message.id == reply_to_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Сообщение для ответа не найдено")

    target, nickname = row
    if is_favorites(chat_id):
        # В «Избранном» можно отвечать только на свои заметки и копии
        if target.chat_id is not None or target.sender_id != user.id:
            raise HTTPException(
                status_code=404,
                detail="Сообщение для ответа не найдено",
            )
    elif target.chat_id != chat_id:
        raise HTTPException(
            status_code=400,
            detail="Нельзя ответить на сообщение из другого чата",
        )

    if target.is_deleted:
        preview = "Сообщение удалено"
    elif target.text:
        preview = target.text
    elif target.media_url:
        preview = "📷 Изображение"
    else:
        preview = ""
    return nickname, preview


def _insert_message(
    db: Session,
    user: models.User,
    chat_id: int,
    text: str | None,
    reply_to_id: int | None,
    media_url: str | None = None,
    reply_to_nickname: str | None = None,
    reply_to_text: str | None = None,
    forwarded_from_nickname: str | None = None,
) -> models.Message:
    # В избранном chat_id не хранится — строка в chats просто не нужна
    msg = models.Message(
        chat_id=None if is_favorites(chat_id) else chat_id,
        sender_id=user.id,
        text=text,
        media_url=media_url,
        reply_to_id=reply_to_id,
        reply_to_nickname=reply_to_nickname,
        reply_to_text=reply_to_text,
        forwarded_from_nickname=forwarded_from_nickname,
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

    reply_nickname, reply_text = _reply_snapshot(db, user, chat_id, reply_to_id)
    msg = _insert_message(
        db,
        user,
        chat_id,
        text,
        reply_to_id,
        reply_to_nickname=reply_nickname,
        reply_to_text=reply_text,
    )
    return serialize_message(msg, user.nickname, view_chat_id=chat_id)


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
    reply_nickname, reply_text = _reply_snapshot(db, user, chat_id, reply_to_id)
    msg = _insert_message(
        db,
        user,
        chat_id,
        text,
        reply_to_id,
        media_url=media_url,
        reply_to_nickname=reply_nickname,
        reply_to_text=reply_text,
    )
    return serialize_message(msg, user.nickname, view_chat_id=chat_id)


def _get_message(db: Session, message_id: int) -> models.Message:
    msg = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


def _require_own_message(
    db: Session, user: models.User, msg: models.Message
) -> None:
    if msg.sender_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Можно изменять и удалять только свои сообщения",
        )
    if msg.chat_id is not None and not can_access_chat(db, user, msg.chat_id):
        raise HTTPException(status_code=403, detail="Нет доступа к этому чату")


def edit_message(
    db: Session,
    user: models.User,
    message_id: int,
    text: str | None,
    new_media_url: str | None = None,
) -> schemas.MessageResponse:
    """Правит текст/подпись и при необходимости заменяет картинку."""
    msg = _get_message(db, message_id)
    _require_own_message(db, user, msg)
    if msg.is_deleted:
        raise HTTPException(status_code=400, detail="Удалённое сообщение нельзя изменить")

    normalized_text = text.strip() if text and text.strip() else None
    resulting_media = new_media_url or msg.media_url
    if not normalized_text and not resulting_media:
        raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")

    msg.text = normalized_text
    if new_media_url:
        # Старый файл не удаляем: на него могут ссылаться пересланные копии.
        msg.media_url = new_media_url
    msg.edited_at = datetime.utcnow()
    db.commit()
    db.refresh(msg)

    return _serialize_for_user(db, user, msg)


def delete_messages(
    db: Session, user: models.User, message_ids: List[int]
) -> List[schemas.MessageRemovedResponse]:
    """Удаляет свои сообщения: заглушка в чате или копия из «Избранного»."""
    ids: List[int] = []
    for raw_id in message_ids:
        message_id = int(raw_id)
        if message_id not in ids:
            ids.append(message_id)
    if not ids:
        raise HTTPException(status_code=400, detail="Не выбрано ни одного сообщения")

    rows = (
        db.query(models.Message)
        .filter(models.Message.id.in_(ids))
        .all()
    )
    by_id = {msg.id: msg for msg in rows}
    if len(by_id) != len(ids):
        raise HTTPException(status_code=404, detail="Сообщение не найдено")

    ordered = [by_id[message_id] for message_id in ids]
    for msg in ordered:
        _require_own_message(db, user, msg)
        if msg.is_deleted:
            raise HTTPException(
                status_code=400,
                detail="Сообщение уже удалено",
            )

    results: List[schemas.MessageRemovedResponse] = []
    for msg in ordered:
        # Все ответы на удалённый оригинал должны показать заглушку в цитате.
        db.query(models.Message).filter(
            models.Message.reply_to_id == msg.id
        ).update(
            {models.Message.reply_to_text: "Сообщение удалено"},
            synchronize_session=False,
        )

        if msg.chat_id is None:
            # В «Избранном» копия исчезает без заглушки. Ссылку на неё
            # обнуляем вручную: SQLite в тестах не применяет ON DELETE SET NULL.
            db.query(models.Message).filter(
                models.Message.reply_to_id == msg.id
            ).update(
                {models.Message.reply_to_id: None},
                synchronize_session=False,
            )
            message_id = msg.id
            db.delete(msg)
            results.append(
                schemas.MessageRemovedResponse(
                    id=message_id,
                    chat_id=FAVORITES_CHAT_ID,
                    removed=True,
                    message=None,
                )
            )
            continue

        msg.is_deleted = True
        msg.text = None
        msg.media_url = None
        results.append(
            schemas.MessageRemovedResponse(
                id=msg.id,
                chat_id=msg.chat_id,
                removed=False,
                message=_serialize_for_user(db, user, msg),
            )
        )

    db.commit()
    return results


def _unique_positive_ids(values: List[int], label: str) -> List[int]:
    result: List[int] = []
    for raw in values:
        value = int(raw)
        if value not in result:
            result.append(value)
    if not result:
        raise HTTPException(status_code=400, detail=f"Не выбрано: {label}")
    return result


def forward_messages(
    db: Session,
    user: models.User,
    message_ids: List[int],
    chat_ids: List[int],
    keep_reply: bool = False,
) -> List[schemas.MessageResponse]:
    """Пересылает каждое сообщение в каждый выбранный чат (N × M копий)."""
    ids = _unique_positive_ids(message_ids, "сообщения")
    targets = _unique_positive_ids(chat_ids, "чаты")

    for target in targets:
        if not can_access_chat(db, user, target):
            raise HTTPException(status_code=403, detail="Нет доступа к одному из чатов")

    rows = (
        db.query(models.Message, models.User.nickname)
        .join(models.User, models.User.id == models.Message.sender_id)
        .filter(models.Message.id.in_(ids))
        .all()
    )
    by_id = {msg.id: (msg, nickname) for msg, nickname in rows}
    if len(by_id) != len(ids):
        raise HTTPException(status_code=404, detail="Сообщение не найдено")

    ordered = [by_id[message_id] for message_id in ids]
    for source, _nickname in ordered:
        if source.is_deleted:
            raise HTTPException(
                status_code=400,
                detail="Удалённое сообщение нельзя переслать",
            )
        if source.chat_id is None:
            if source.sender_id != user.id:
                raise HTTPException(status_code=403, detail="Нет доступа к сообщению")
        elif not can_access_chat(db, user, source.chat_id):
            raise HTTPException(status_code=403, detail="Нет доступа к сообщению")

    created: List[tuple[models.Message, int]] = []
    for target in targets:
        for source, nickname in ordered:
            # forwarded_from_nickname — немедленный отправитель оригинала,
            # даже если тот сам был переслан раньше.
            msg = models.Message(
                chat_id=None if is_favorites(target) else target,
                sender_id=user.id,
                text=source.text,
                media_url=source.media_url,
                reply_to_id=None,
                reply_to_nickname=source.reply_to_nickname if keep_reply else None,
                reply_to_text=source.reply_to_text if keep_reply else None,
                forwarded_from_nickname=nickname,
            )
            db.add(msg)
            created.append((msg, target))

    try:
        db.flush()
        responses = [
            serialize_message(
                msg,
                user.nickname,
                "sent",
                view_chat_id=target,
            )
            for msg, target in created
        ]
        db.commit()
    except Exception:
        db.rollback()
        raise
    return responses


def update_message_receipt(
    db: Session,
    user: models.User,
    chat_id: int,
    message_id: int,
    mark_read: bool,
) -> models.ChatMember:
    """Продвигает отметку доставки/прочтения участника чата.

    Отметки только растут: запоздавший запрос за старое сообщение не откатит
    прогресс, достигнутый, например, при открытии чата.
    """
    member = (
        db.query(models.ChatMember)
        .filter(
            models.ChatMember.chat_id == chat_id,
            models.ChatMember.user_id == user.id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=403, detail="No access to this chat")

    message = (
        db.query(models.Message.id)
        .filter(
            models.Message.id == message_id,
            models.Message.chat_id == chat_id,
            models.Message.is_deleted == False,
        )
        .first()
    )
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # GREATEST в самом UPDATE защищает от гонки двух вкладок: меньшая отметка
    # никогда не перезапишет большую.
    delivered = func.greatest(
        func.coalesce(models.ChatMember.last_delivered_message_id, 0), message_id
    )
    values = {models.ChatMember.last_delivered_message_id: delivered}
    if mark_read:
        values[models.ChatMember.last_read_message_id] = func.greatest(
            func.coalesce(models.ChatMember.last_read_message_id, 0), message_id
        )

    db.query(models.ChatMember).filter(
        models.ChatMember.chat_id == chat_id,
        models.ChatMember.user_id == user.id,
    ).update(values, synchronize_session=False)
    db.commit()

    return (
        db.query(models.ChatMember)
        .filter(
            models.ChatMember.chat_id == chat_id,
            models.ChatMember.user_id == user.id,
        )
        .one()
    )
