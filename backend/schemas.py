from datetime import date, datetime, timezone
from typing import Annotated

from pydantic import AfterValidator, BaseModel


def as_utc(value: datetime | None) -> datetime | None:
    """Время в базе хранится в UTC без пояса (datetime.utcnow). Без явного
    пояса браузер принял бы его за местное и сдвинул часы на разницу с UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


UtcDatetime = Annotated[datetime, AfterValidator(as_utc)]


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
    bio: str | None = None
    avatar_url: str | None = None
    theme: str = "dark"
    created_at: UtcDatetime

    class Config:
        from_attributes = True  # позволяет читать данные из SQLAlchemy-объектов


class ProfileResponse(BaseModel):
    # Свой профиль: к данным UserResponse добавлена дата рождения
    id: int
    username: str
    nickname: str
    bio: str | None = None
    birth_date: date | None = None
    avatar_url: str | None = None
    theme: str = "dark"
    created_at: UtcDatetime

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    # Все поля необязательные: PATCH меняет только то, что пришло в запросе
    username: str | None = None
    nickname: str | None = None
    bio: str | None = None
    birth_date: date | None = None
    theme: str | None = None


class WallpaperResponse(BaseModel):
    # Обои — клиентская настройка, поэтому сервер возвращает только URL файла.
    url: str


class AccountDeleteRequest(BaseModel):
    """Запрос на безвозвратное удаление аккаунта."""

    password: str
    confirmation_phrase: str
    two_fa_token: str | None = None


class ContactCreate(BaseModel):
    username: str


class ChatCreate(BaseModel):
    username: str


class GroupChatCreate(BaseModel):
    name: str
    user_ids: list[int] = []


class ChatMemberAdd(BaseModel):
    user_id: int


class ChatMemberResponse(BaseModel):
    id: int
    nickname: str
    avatar_url: str | None = None
    # Не обязателен по контракту, но удобен интерфейсу для подписи @username
    username: str | None = None


class ChatResponse(BaseModel):
    # -1 у виртуального чата «Избранное», настоящей строки в chats у него нет
    id: int
    title: str
    is_favorites: bool = False
    last_message: str | None = None
    last_message_at: UtcDatetime | None = None
    # Только для личных чатов: собеседник, его аватар и признак того,
    # что он уже в контактах. peer_id нужен для индикатора «в сети».
    peer_id: int | None = None
    peer_username: str | None = None
    avatar_url: str | None = None
    is_contact: bool = False
    # Входящие сообщения, которые пользователь ещё не прочитал (бейдж в списке)
    unread_count: int = 0
    # "private" | "group": интерфейсу нужно отличать группу от личного чата,
    # даже если у группы ещё нет ни одного сообщения.
    chat_type: str = "private"
    # Число участников — только у группового чата
    members_count: int | None = None
    # Владелец группы: интерфейс показывает кнопку «Удалить» только ему
    owner_id: int | None = None


class ChatListResponse(BaseModel):
    chats: list[ChatResponse]


class MessageCreate(BaseModel):
    chat_id: int
    text: str
    reply_to_id: int | None = None


class MessageResponse(BaseModel):
    id: int
    # У «Избранного» клиентский id -1, даже если в базе chat_id = NULL
    chat_id: int | None = None
    sender_id: int
    sender_nickname: str | None = None
    text: str | None
    # Относительный путь вида /uploads/images/<uuid>.jpg; None у текстовых сообщений
    media_url: str | None = None
    created_at: UtcDatetime
    reply_to_id: int | None = None
    # Снимок цитаты на момент ответа
    reply_to_nickname: str | None = None
    reply_to_text: str | None = None
    edited_at: UtcDatetime | None = None
    # Кто отправил оригинал: подпись «Переслано от …»
    forwarded_from_nickname: str | None = None
    # Удалённое сообщение: клиент рисует заглушку вместо текста и картинки
    is_deleted: bool = False
    # sent | delivered | read. Показывается только у своих сообщений
    status: str = "sent"


class MessageBatchDelete(BaseModel):
    message_ids: list[int]


class MessageForward(BaseModel):
    message_ids: list[int]
    chat_ids: list[int]
    # Сохранять ли снимок ответной цитаты в пересланной копии
    keep_reply: bool = False


class MessageRemovedResponse(BaseModel):
    """Результат удаления: заглушка в чате или физическое удаление копии."""

    id: int
    # Клиентский id чата: -1 для «Избранного»
    chat_id: int
    # True — строку убрали из «Избранного»; False — в чате осталась заглушка
    removed: bool
    message: MessageResponse | None = None


class ReceiptUpdate(BaseModel):
    message_id: int


class PresenceResponse(BaseModel):
    # id связанных пользователей, у которых сейчас есть открытый WebSocket
    online: list[int]
    # Время последней активности связанных пользователей. Ключи — id,
    # значения — ISO-время; для тех, кто ещё ни разу не подключался, пары нет.
    last_seen: dict[int, datetime] = {}


class ReceiptResponse(BaseModel):
    chat_id: int
    user_id: int
    last_delivered_message_id: int | None = None
    last_read_message_id: int | None = None

    class Config:
        from_attributes = True
