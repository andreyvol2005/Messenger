"""Бизнес-логика чатов, сообщений и контактов. Роутеры только разбирают HTTP и зовут сюда."""

from datetime import datetime, timezone

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
    """Доступ к чату.

    Каналы публичные: читать посты может любой активный пользователь, даже
    без подписки. Писать в канал по-прежнему может только владелец — это
    проверяется отдельно при создании сообщения.
    """
    if user.deleted_at is not None:
        return False
    if is_favorites(chat_id):
        return True

    chat = db.query(models.Chat.type).filter(models.Chat.id == chat_id).first()
    if chat is not None and chat.type == "channel":
        return True

    member = (
        db.query(models.ChatMember)
        .filter(models.ChatMember.chat_id == chat_id, models.ChatMember.user_id == user.id)
        .first()
    )
    return member is not None


def is_channel_chat(db: Session, chat_id: int) -> bool:
    """True, если chat_id — канал. Для «Избранного» и несуществующих чатов False."""
    if is_favorites(chat_id):
        return False
    row = db.query(models.Chat.type).filter(models.Chat.id == chat_id).first()
    return bool(row and row.type == "channel")


def chat_member_ids(db: Session, chat_id: int) -> list[int]:
    return [row.user_id for row in db.query(models.ChatMember).filter(models.ChatMember.chat_id == chat_id).all()]


# ==========================================
# Контакты
# ==========================================


def list_contacts(db: Session, user: models.User) -> list[models.User]:
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
        db.query(models.User).filter(models.User.username == stored_username, models.User.deleted_at.is_(None)).first()
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
            models.Message.id > func.coalesce(models.ChatMember.last_read_message_id, 0),
        )
        .group_by(models.Message.chat_id)
        .all()
    )
    return dict(rows)


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
        for row in db.query(models.Contact.contact_user_id).filter(models.Contact.user_id == user.id).all()
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
    # У групп и каналов число строк в chat_members — это участники/подписчики.
    counted_ids = [chat.id for chat, *_ in rows if chat.type in ("group", "channel")]
    member_counts = _chat_member_counts(db, counted_ids)
    private_ids = [chat.id for chat, *_ in rows if chat.type == "private"]
    peers = _private_peers(db, private_ids, user.id)

    for chat, last_text, last_media, last_at, last_deleted in rows:
        title = chat.name
        peer_id = None
        peer_username = None
        avatar_url = None
        is_contact = False
        if chat.type == "private":
            peer = peers.get(chat.id)
            if peer:
                # Удалённый собеседник отображается как «Удалённый пользователь»
                title = peer.nickname
                peer_id = peer.id
                peer_username = peer.username
                avatar_url = peer.avatar_url
                is_contact = peer.id in contact_ids
            else:
                title = chat.name or "Личный чат"
        elif chat.type == "channel":
            # Канал публичный, но в общем списке он есть только у подписчиков.
            title = chat.name or "Канал"
            avatar_url = chat.avatar_url
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
                # В канале нет отметок о прочтении: там считаются просмотры
                # постов, поэтому бейдж непрочитанного не показываем.
                unread_count=0 if chat.type == "channel" else unread_by_chat.get(chat.id, 0),
                chat_type=chat.type,
                members_count=(member_counts.get(chat.id) if chat.type in ("group", "channel") else None),
                owner_id=chat.owner_id,
                is_subscribed=(chat.type == "channel"),
            )
        )

    return schemas.ChatListResponse(chats=chats)


def _chat_member_counts(db: Session, chat_ids: list[int]) -> dict[int, int]:
    """Число участников группы или подписчиков канала одним запросом."""
    if not chat_ids:
        return {}
    rows = (
        db.query(models.ChatMember.chat_id, func.count(models.ChatMember.user_id))
        .filter(models.ChatMember.chat_id.in_(chat_ids))
        .group_by(models.ChatMember.chat_id)
        .all()
    )
    return dict(rows)


def _private_peers(db: Session, chat_ids: list[int], user_id: int) -> dict[int, models.User]:
    """Собеседник в каждом личном чате одним запросом, а не запросом на чат."""
    if not chat_ids:
        return {}
    rows = (
        db.query(models.ChatMember.chat_id, models.User)
        .join(models.User, models.User.id == models.ChatMember.user_id)
        .filter(models.ChatMember.chat_id.in_(chat_ids), models.User.id != user_id)
        .all()
    )
    return dict(rows)


def _message_preview(text: str | None, media_url: str | None, is_deleted: bool = False) -> str | None:
    """Превью для списка чатов: у сообщения только с картинкой текста нет."""
    if is_deleted:
        return "Сообщение удалено"
    if text:
        return text
    if media_url:
        return "📷 Изображение"
    return None


def create_or_get_chat(db: Session, user: models.User, username: str) -> schemas.ChatResponse:
    """Создаёт личный чат с пользователем или возвращает уже существующий."""
    # Нельзя создать чат с удалённым пользователем.
    stored_username = validation.normalize_username(username)
    other = (
        db.query(models.User).filter(models.User.username == stored_username, models.User.deleted_at.is_(None)).first()
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
        db.add_all(
            [
                models.ChatMember(chat_id=chat.id, user_id=first_id),
                models.ChatMember(chat_id=chat.id, user_id=second_id),
            ]
        )
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


def _require_group_member(db: Session, user: models.User, chat_id: int) -> models.Chat:
    """Групповой чат, в котором текущий пользователь состоит участником.

    Любого участника достаточно для смены названия/аватара и добавления
    людей. Удалять других может только владелец (см. remove_group_member).
    """
    chat = _get_chat(db, chat_id)
    if chat.type != "group":
        raise HTTPException(status_code=400, detail="Это не групповой чат")
    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="Нет доступа к этому чату")
    return chat


def _group_chat_response(db: Session, chat: models.Chat) -> schemas.ChatResponse:
    count = (db.query(func.count(models.ChatMember.user_id)).filter(models.ChatMember.chat_id == chat.id).scalar()) or 0
    return schemas.ChatResponse(
        id=chat.id,
        title=chat.name or "Группа",
        avatar_url=chat.avatar_url,
        chat_type="group",
        members_count=count,
        owner_id=chat.owner_id,
    )


def _serialize_member(user: models.User) -> schemas.ChatMemberResponse:
    return schemas.ChatMemberResponse(
        id=user.id,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        username=user.username,
    )


def create_group_chat(db: Session, user: models.User, name: str, user_ids: list[int]) -> schemas.ChatResponse:
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

    chat = models.Chat(type="group", name=title, owner_id=user.id)
    db.add(chat)
    try:
        db.flush()
        db.add_all(
            [models.ChatMember(chat_id=chat.id, user_id=member_id) for member_id in sorted(member_ids | {user.id})]
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(chat)
    return _group_chat_response(db, chat)


def list_group_members(db: Session, user: models.User, chat_id: int) -> list[schemas.ChatMemberResponse]:
    _require_group_member(db, user, chat_id)
    members = (
        db.query(models.User)
        .join(models.ChatMember, models.ChatMember.user_id == models.User.id)
        .filter(models.ChatMember.chat_id == chat_id)
        .order_by(models.User.nickname)
        .all()
    )
    return [_serialize_member(member) for member in members]


def add_group_member(db: Session, user: models.User, chat_id: int, user_id: int) -> schemas.ChatMemberResponse:
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


def _ensure_group_owner(db: Session, chat: models.Chat) -> int | None:
    """Владелец группы; если его нет или он больше не активный участник,
    группа переходит к активному участнику с наименьшим id."""
    active_members = (
        db.query(models.ChatMember.user_id)
        .join(models.User, models.User.id == models.ChatMember.user_id)
        .filter(models.ChatMember.chat_id == chat.id, models.User.deleted_at.is_(None))
    )
    if chat.owner_id is not None and active_members.filter(models.ChatMember.user_id == chat.owner_id).first():
        return chat.owner_id
    successor = active_members.order_by(models.ChatMember.user_id).first()
    chat.owner_id = successor[0] if successor else None
    return chat.owner_id


def remove_group_member(db: Session, user: models.User, chat_id: int, user_id: int) -> None:
    """Выйти из группы может любой участник, удалить другого — только владелец."""
    chat = _require_group_member(db, user, chat_id)
    if user_id != user.id and _ensure_group_owner(db, chat) != user.id:
        raise HTTPException(
            status_code=403,
            detail="Удалять участников может только владелец группы",
        )

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
    if chat.owner_id == user_id:
        # Владелец вышел — группа не должна остаться без управления.
        db.flush()
        chat.owner_id = None
        _ensure_group_owner(db, chat)
    db.commit()


def _apply_chat_update(
    db: Session,
    chat: models.Chat,
    name: str | None,
    avatar_data: bytes | None,
    avatar_extension: str | None,
    name_validator,
) -> None:
    """Общая часть смены названия и аватара для группы и канала."""
    if name is None and avatar_data is None:
        raise HTTPException(status_code=400, detail="Нечего обновлять")

    if name is not None:
        chat.name = name_validator(name)

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
    _apply_chat_update(
        db,
        chat,
        name,
        avatar_data,
        avatar_extension,
        validation.validate_chat_name,
    )
    return _group_chat_response(db, chat)


def update_chat(
    db: Session,
    user: models.User,
    chat_id: int,
    name: str | None = None,
    avatar_data: bytes | None = None,
    avatar_extension: str | None = None,
) -> schemas.ChatResponse:
    """PATCH /api/chats/{id}: группу меняет участник, канал — только владелец."""
    chat = _get_chat(db, chat_id)
    if chat.type == "channel":
        _require_channel_owner(db, user, chat_id)
        _apply_chat_update(
            db,
            chat,
            name,
            avatar_data,
            avatar_extension,
            validation.validate_channel_name,
        )
        return _channel_response(db, chat, user)
    if chat.type == "group":
        return update_group_chat(db, user, chat_id, name, avatar_data, avatar_extension)
    raise HTTPException(status_code=400, detail="Это не групповой чат и не канал")


# ==========================================
# Каналы
# ==========================================


def _channel_response(db: Session, chat: models.Chat, user: models.User) -> schemas.ChatResponse:
    count = (db.query(func.count(models.ChatMember.user_id)).filter(models.ChatMember.chat_id == chat.id).scalar()) or 0
    subscribed = (
        db.query(models.ChatMember)
        .filter(
            models.ChatMember.chat_id == chat.id,
            models.ChatMember.user_id == user.id,
        )
        .first()
        is not None
    )
    return schemas.ChatResponse(
        id=chat.id,
        title=chat.name or "Канал",
        avatar_url=chat.avatar_url,
        chat_type="channel",
        members_count=count,
        owner_id=chat.owner_id,
        is_subscribed=subscribed,
    )


def _require_channel_owner(db: Session, user: models.User, chat_id: int) -> models.Chat:
    chat = _get_chat(db, chat_id)
    if chat.type != "channel":
        raise HTTPException(status_code=400, detail="Это не канал")
    if chat.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Управлять каналом может только владелец")
    return chat


def create_channel(db: Session, user: models.User, name: str) -> schemas.ChatResponse:
    """Создаёт канал. Автор сразу становится владельцем и первым подписчиком."""
    title = validation.validate_channel_name(name)
    chat = models.Chat(type="channel", name=title, owner_id=user.id)
    db.add(chat)
    try:
        db.flush()
        db.add(models.ChatMember(chat_id=chat.id, user_id=user.id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(chat)
    return _channel_response(db, chat, user)


def list_channels(
    db: Session,
    user: models.User,
    query: str | None = None,
) -> schemas.ChannelListResponse:
    """Каталог публичных каналов. Подписка не требуется, чтобы их увидеть."""
    channels_query = db.query(models.Chat).filter(models.Chat.type == "channel")
    channels = channels_query.order_by(
        models.Chat.created_at.desc(),
        models.Chat.id.desc(),
    ).all()
    if query and query.strip():
        # SQLite в тестах не умеет lower() для кириллицы, поэтому поиск
        # без учёта регистра делаем в Python — каналов в каталоге немного.
        needle = query.strip().casefold()
        channels = [chat for chat in channels if needle in (chat.name or "").casefold()]
    channels = channels[:200]

    channel_ids = [chat.id for chat in channels]
    counts = _chat_member_counts(db, channel_ids)
    subscribed_ids = {
        row.chat_id
        for row in db.query(models.ChatMember.chat_id).filter(
            models.ChatMember.user_id == user.id,
            models.ChatMember.chat_id.in_(channel_ids),
        )
    }

    return schemas.ChannelListResponse(
        channels=[
            schemas.ChatResponse(
                id=chat.id,
                title=chat.name or "Канал",
                avatar_url=chat.avatar_url,
                chat_type="channel",
                members_count=counts.get(chat.id, 0),
                owner_id=chat.owner_id,
                is_subscribed=chat.id in subscribed_ids,
            )
            for chat in channels
        ]
    )


def get_channel(db: Session, user: models.User, chat_id: int) -> schemas.ChatResponse:
    chat = _get_chat(db, chat_id)
    if chat.type != "channel":
        raise HTTPException(status_code=400, detail="Это не канал")
    return _channel_response(db, chat, user)


def subscribe_channel(db: Session, user: models.User, chat_id: int) -> schemas.ChatResponse:
    """Подписка идемпотентна: повторный запрос не создаёт вторую строку."""
    chat = _get_chat(db, chat_id)
    if chat.type != "channel":
        raise HTTPException(status_code=400, detail="Это не канал")

    existing = (
        db.query(models.ChatMember)
        .filter(
            models.ChatMember.chat_id == chat_id,
            models.ChatMember.user_id == user.id,
        )
        .first()
    )
    if existing is None:
        db.add(models.ChatMember(chat_id=chat_id, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            # Параллельный запрос уже подписал пользователя.
            db.rollback()
    return _channel_response(db, chat, user)


def unsubscribe_channel(db: Session, user: models.User, chat_id: int) -> schemas.ChatResponse:
    """Отписка. Владелец остаётся подписчиком, иначе канал потеряет автора."""
    chat = _get_chat(db, chat_id)
    if chat.type != "channel":
        raise HTTPException(status_code=400, detail="Это не канал")
    if chat.owner_id == user.id:
        raise HTTPException(status_code=400, detail="Владелец не может отписаться от своего канала")

    member = (
        db.query(models.ChatMember)
        .filter(
            models.ChatMember.chat_id == chat_id,
            models.ChatMember.user_id == user.id,
        )
        .first()
    )
    if member is not None:
        db.delete(member)
        db.commit()
    return _channel_response(db, chat, user)


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


def _message_status(msg: models.Message, user_id: int, delivered_to: int, read_by: int) -> str:
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
    views_count: int = 0,
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
        views_count=views_count,
    )


def _message_sender_nickname(db: Session, msg: models.Message) -> str | None:
    row = db.query(models.User.nickname).filter(models.User.id == msg.sender_id).first()
    return row[0] if row else None


def _channel_title(db: Session, chat_id: int | None) -> str | None:
    """Название канала для подписи поста; None для обычных чатов."""
    if chat_id is None or is_favorites(chat_id):
        return None
    row = db.query(models.Chat.name, models.Chat.type).filter(models.Chat.id == chat_id).first()
    if row is not None and row.type == "channel":
        return row.name or "Канал"
    return None


def _view_counts(db: Session, message_ids: list[int]) -> dict[int, int]:
    if not message_ids:
        return {}
    rows = (
        db.query(models.MessageView.message_id, func.count(models.MessageView.user_id))
        .filter(models.MessageView.message_id.in_(message_ids))
        .group_by(models.MessageView.message_id)
        .all()
    )
    return dict(rows)


def record_message_views(
    db: Session,
    user: models.User,
    message_ids: list[int],
    commit: bool = True,
) -> None:
    """Запоминает уникальные просмотры постов канала текущим пользователем.

    Повторная загрузка истории или открытие канала с другого устройства не
    увеличивает счётчик: первичный ключ (message_id, user_id) не даёт дублей.
    `commit=False` нужен, когда просмотры добавляются в общую транзакцию
    вместе с другими изменениями.
    """
    ids = sorted({int(message_id) for message_id in message_ids})
    if not ids:
        return

    existing = {
        row.message_id
        for row in db.query(models.MessageView.message_id).filter(
            models.MessageView.user_id == user.id,
            models.MessageView.message_id.in_(ids),
        )
    }
    new_views = [
        models.MessageView(message_id=message_id, user_id=user.id) for message_id in ids if message_id not in existing
    ]
    if not new_views:
        return

    db.add_all(new_views)
    if not commit:
        db.flush()
        return
    try:
        db.commit()
    except IntegrityError:
        # Параллельный запрос уже записал часть просмотров.
        db.rollback()


def _serialize_for_user(
    db: Session,
    user: models.User,
    msg: models.Message,
    view_chat_id: int | None = None,
) -> schemas.MessageResponse:
    """Сериализация действия пользователя: ник, чат и актуальные галочки."""
    chat_id = view_chat_id if view_chat_id is not None else msg.chat_id
    channel_title = _channel_title(db, chat_id)
    if channel_title is not None:
        # В канале вместо автора показывается название канала.
        nickname = channel_title
        status = "sent"
        views_count = _view_counts(db, [msg.id]).get(msg.id, 0)
    else:
        nickname = user.nickname if msg.sender_id == user.id else _message_sender_nickname(db, msg)
        status = "sent"
        if chat_id not in (None, FAVORITES_CHAT_ID):
            delivered_to, read_by = _receipt_bounds(db, chat_id, user.id)
            status = _message_status(msg, user.id, delivered_to, read_by)
        views_count = 0
    return serialize_message(
        msg,
        nickname,
        status,
        view_chat_id=chat_id,
        views_count=views_count,
    )


def list_messages(
    db: Session,
    user: models.User,
    chat_id: int,
    limit: int = 50,
    before_id: int | None = None,
) -> list[schemas.MessageResponse]:
    """Страница истории: последние `limit` сообщений, а с `before_id` — те, что старше него."""
    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")

    query = db.query(models.Message, models.User.nickname).join(models.User, models.User.id == models.Message.sender_id)
    if is_favorites(chat_id):
        # «Избранное» приватно: заметки и копии принадлежат только владельцу
        query = query.filter(
            models.Message.chat_id.is_(None),
            models.Message.sender_id == user.id,
        )
    else:
        # Удалённые сообщения остаются в ленте заглушками
        query = query.filter(models.Message.chat_id == chat_id)

    if before_id is not None:
        query = query.filter(models.Message.id < before_id)

    # id растёт вместе со временем отправки, поэтому курсор по id даёт
    # стабильные страницы даже при одинаковом created_at.
    rows = query.order_by(models.Message.id.desc()).limit(limit).all()
    rows.reverse()  # в чате сообщения идут снизу вверх

    channel_title = _channel_title(db, chat_id)
    if channel_title is not None:
        # Загрузка истории канала и есть просмотр: записываем уникальные
        # просмотры для всех показанных постов, включая автора.
        visible_ids = [msg.id for msg, _nickname in rows if not msg.is_deleted]
        record_message_views(db, user, visible_ids)
        counts = _view_counts(db, visible_ids)
        return [
            serialize_message(
                msg,
                channel_title,
                "sent",
                view_chat_id=chat_id,
                views_count=counts.get(msg.id, 0),
            )
            for msg, _nickname in rows
        ]

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
    # В PostgreSQL last_message_id обновляет триггер, но приложение не должно
    # зависеть только от него: та же логика нужна и на SQLite, и в старых базах,
    # где триггер мог не создаться. Для «Избранного» строки в chats нет.
    db.flush()
    if not is_favorites(chat_id):
        db.query(models.Chat).filter(models.Chat.id == chat_id).update(
            {models.Chat.last_message_id: msg.id},
            synchronize_session=False,
        )
    db.commit()
    db.refresh(msg)
    return msg


def _require_post_access(db: Session, user: models.User, chat_id: int) -> str | None:
    """Проверяет право писать в чат и возвращает название канала, если это канал.

    В обычный чат пишут участники, в канал — только владелец. Публичные
    каналы при этом остаются доступными для чтения всем.
    """
    if is_favorites(chat_id):
        return None

    chat = _get_chat(db, chat_id)
    if chat.type == "channel":
        if chat.owner_id != user.id:
            raise HTTPException(
                status_code=403,
                detail="Публиковать посты в канале может только владелец",
            )
        return chat.name or "Канал"

    if not can_access_chat(db, user, chat_id):
        raise HTTPException(status_code=403, detail="No access to this chat")
    return None


def create_message(
    db: Session,
    user: models.User,
    chat_id: int,
    text: str,
    reply_to_id: int | None = None,
) -> schemas.MessageResponse:
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Message text is empty")

    channel_title = _require_post_access(db, user, chat_id)
    if channel_title is not None and reply_to_id is not None:
        raise HTTPException(status_code=400, detail="В канале нельзя отвечать на посты")

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
    if channel_title is not None:
        # Автор входит в число уникальных просмотревших.
        record_message_views(db, user, [msg.id])
    return serialize_message(
        msg,
        channel_title or user.nickname,
        view_chat_id=chat_id,
        views_count=1 if channel_title is not None else 0,
    )


def create_image_message(
    db: Session,
    user: models.User,
    chat_id: int,
    media_url: str,
    caption: str | None = None,
    reply_to_id: int | None = None,
) -> schemas.MessageResponse:
    """Сообщение с картинкой: файл уже лежит на диске, в БД пишем только путь."""
    channel_title = _require_post_access(db, user, chat_id)
    if channel_title is not None and reply_to_id is not None:
        raise HTTPException(status_code=400, detail="В канале нельзя отвечать на посты")

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
    if channel_title is not None:
        record_message_views(db, user, [msg.id])
    return serialize_message(
        msg,
        channel_title or user.nickname,
        view_chat_id=chat_id,
        views_count=1 if channel_title is not None else 0,
    )


def _get_message(db: Session, message_id: int) -> models.Message:
    msg = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


def view_message(db: Session, user: models.User, message_id: int) -> schemas.MessageViewResponse:
    """Отмечает просмотр поста канала и возвращает актуальный счётчик.

    Нужен для постов, пришедших по WebSocket: история записывает просмотры
    сама, а только что показанный пост отмечается этим запросом.
    """
    msg = _get_message(db, message_id)
    if msg.chat_id is None or msg.is_deleted:
        raise HTTPException(status_code=400, detail="Это не пост канала")
    if not is_channel_chat(db, msg.chat_id):
        raise HTTPException(status_code=400, detail="Это не пост канала")
    if not can_access_chat(db, user, msg.chat_id):
        raise HTTPException(status_code=403, detail="Нет доступа к каналу")

    record_message_views(db, user, [msg.id])
    count = _view_counts(db, [msg.id]).get(msg.id, 0)
    return schemas.MessageViewResponse(message_id=msg.id, views_count=count)


def _require_own_message(db: Session, user: models.User, msg: models.Message) -> None:
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
    if msg.forwarded_from_nickname is not None:
        raise HTTPException(
            status_code=400,
            detail="Пересланное сообщение нельзя изменить",
        )

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


def delete_messages(db: Session, user: models.User, message_ids: list[int]) -> list[schemas.MessageRemovedResponse]:
    """Удаляет свои сообщения: заглушка в чате или копия из «Избранного»."""
    ids: list[int] = []
    for raw_id in message_ids:
        message_id = int(raw_id)
        if message_id not in ids:
            ids.append(message_id)
    if not ids:
        raise HTTPException(status_code=400, detail="Не выбрано ни одного сообщения")

    rows = db.query(models.Message).filter(models.Message.id.in_(ids)).all()
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

    results: list[schemas.MessageRemovedResponse] = []
    for msg in ordered:
        # Все ответы на удалённый оригинал должны показать заглушку в цитате.
        db.query(models.Message).filter(models.Message.reply_to_id == msg.id).update(
            {models.Message.reply_to_text: "Сообщение удалено"},
            synchronize_session=False,
        )

        if msg.chat_id is None:
            # В «Избранном» копия исчезает без заглушки. Ссылку на неё
            # обнуляем вручную: SQLite в тестах не применяет ON DELETE SET NULL.
            db.query(models.Message).filter(models.Message.reply_to_id == msg.id).update(
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


def _unique_positive_ids(values: list[int], label: str) -> list[int]:
    result: list[int] = []
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
    message_ids: list[int],
    chat_ids: list[int],
    keep_reply: bool = False,
) -> list[schemas.MessageResponse]:
    """Пересылает каждое сообщение в каждый выбранный чат (N × M копий)."""
    ids = _unique_positive_ids(message_ids, "сообщения")
    targets = _unique_positive_ids(chat_ids, "чаты")

    # Для канала это ещё и проверка, что пересылает владелец: подписчик
    # не должен получить право публиковать чужие посты.
    target_titles = {target: _require_post_access(db, user, target) for target in targets}

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

    created: list[tuple[models.Message, int]] = []
    for target in targets:
        for source, nickname in ordered:
            # forwarded_from_nickname — немедленный отправитель оригинала,
            # даже если тот сам был переслан раньше. Для поста канала
            # подписываем источник названием канала, а не именем владельца.
            source_label = _channel_title(db, source.chat_id) or nickname
            msg = models.Message(
                chat_id=None if is_favorites(target) else target,
                sender_id=user.id,
                text=source.text,
                media_url=source.media_url,
                reply_to_id=None,
                reply_to_nickname=source.reply_to_nickname if keep_reply else None,
                reply_to_text=source.reply_to_text if keep_reply else None,
                forwarded_from_nickname=source_label,
            )
            db.add(msg)
            created.append((msg, target))

    try:
        db.flush()
        channel_messages = [(msg, target) for msg, target in created if target_titles[target] is not None]
        if channel_messages:
            # Автор тоже входит в число просмотревших свои посты.
            record_message_views(
                db,
                user,
                [msg.id for msg, _target in channel_messages],
                commit=False,
            )
        counts = _view_counts(db, [msg.id for msg, _target in channel_messages])
        responses = [
            serialize_message(
                msg,
                target_titles[target] or user.nickname,
                "sent",
                view_chat_id=target,
                views_count=counts.get(msg.id, 0),
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
    if is_channel_chat(db, chat_id):
        # В канале нет переписки и галочек: активность читателей считается
        # уникальными просмотрами постов, а не доставкой и прочтением.
        raise HTTPException(status_code=400, detail="В канале нет отметок о прочтении")

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
    delivered = func.greatest(func.coalesce(models.ChatMember.last_delivered_message_id, 0), message_id)
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
