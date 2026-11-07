from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

import events
import media
import models
import schemas
import services
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _publish_receipt(
    background_tasks: BackgroundTasks,
    db: Session,
    chat_id: int,
    user_id: int,
) -> None:
    """Сообщает собеседникам, что мы получили или прочитали их сообщения.

    Каждому получателю отправляем минимум по остальным участникам: в личном
    чате это отметка собеседника, в группе — «доставлено/прочитано всеми».
    """
    members = (
        db.query(models.ChatMember)
        .filter(models.ChatMember.chat_id == chat_id)
        .all()
    )
    for recipient in members:
        if recipient.user_id == user_id:
            continue
        others = [m for m in members if m.user_id != recipient.user_id]
        if not others:
            continue
        delivered = min((m.last_delivered_message_id or 0) for m in others)
        read = min((m.last_read_message_id or 0) for m in others)
        event = events.build_receipt_event(chat_id, user_id, delivered, read)
        background_tasks.add_task(events.publish, [recipient.user_id], event)


@router.get("", response_model=schemas.ChatListResponse)
def get_chats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.list_chats(db, current_user)


@router.post("", response_model=schemas.ChatResponse)
def create_chat(
    payload: schemas.ChatCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.create_or_get_chat(db, current_user, payload.username)


@router.post("/group", response_model=schemas.ChatResponse)
def create_group_chat(
    payload: schemas.GroupChatCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Создать групповой чат: название плюс список id участников."""
    chat = services.create_group_chat(
        db, current_user, payload.name, payload.user_ids
    )
    background_tasks.add_task(
        events.publish,
        services.chat_member_ids(db, chat.id),
        events.build_chat_event(chat.id),
    )
    return chat


@router.get(
    "/{chat_id}/members",
    response_model=list[schemas.ChatMemberResponse],
)
def get_group_members(
    chat_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.list_group_members(db, current_user, chat_id)


@router.post(
    "/{chat_id}/members",
    response_model=schemas.ChatMemberResponse,
)
def add_group_member(
    chat_id: int,
    payload: schemas.ChatMemberAdd,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    member = services.add_group_member(
        db, current_user, chat_id, payload.user_id
    )
    background_tasks.add_task(
        events.publish,
        services.chat_member_ids(db, chat_id),
        events.build_chat_event(chat_id),
    )
    return member


@router.delete("/{chat_id}/members/{user_id}", status_code=204)
def remove_group_member(
    chat_id: int,
    user_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Получателей считаем до удаления: выбывший участник тоже должен
    # получить событие и убрать группу из своего списка чатов.
    recipients = services.chat_member_ids(db, chat_id)
    services.remove_group_member(db, current_user, chat_id, user_id)
    background_tasks.add_task(
        events.publish,
        recipients,
        events.build_chat_event(chat_id),
    )
    return Response(status_code=204)


@router.patch("/{chat_id}", response_model=schemas.ChatResponse)
async def update_group_chat(
    chat_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Изменить название и/или аватар группы.

    Поддерживаются оба формата:
      * `application/json` — `{"name": "Название"}`;
      * `multipart/form-data` — поля `name` и `file` (или `avatar`).
    """
    name: str | None = None
    file = None
    content_type = (request.headers.get("content-type") or "").lower()

    if "application/json" in content_type:
        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Некорректный JSON")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Некорректный JSON")
        name = payload.get("name")
    elif content_type.startswith("multipart/form-data") or content_type.startswith(
        "application/x-www-form-urlencoded"
    ):
        form = await request.form()
        name = form.get("name")
        file = form.get("file") or form.get("avatar")
        # Строка вместо файла — это не загрузка, считаем поле пустым
        if file is not None and not hasattr(file, "read"):
            file = None
    else:
        raise HTTPException(
            status_code=415,
            detail="Ожидается JSON или multipart/form-data",
        )

    if name is not None and not isinstance(name, str):
        raise HTTPException(status_code=422, detail="Название должно быть строкой")

    avatar_data: bytes | None = None
    avatar_extension: str | None = None
    if file is not None:
        if file.content_type and not file.content_type.startswith("image/"):
            raise HTTPException(
                status_code=400,
                detail="Можно загружать только изображения",
            )
        avatar_data = await file.read(media.MAX_GROUP_AVATAR_SIZE + 1)
        if len(avatar_data) > media.MAX_GROUP_AVATAR_SIZE:
            raise HTTPException(status_code=413, detail="Файл больше 5 МБ")
        if not avatar_data:
            raise HTTPException(status_code=400, detail="Пустой файл")
        avatar_extension = media.detect_image_extension(avatar_data[:16])
        if avatar_extension is None:
            raise HTTPException(
                status_code=400,
                detail="Файл не является изображением",
            )

    chat = services.update_group_chat(
        db,
        current_user,
        chat_id,
        name=name,
        avatar_data=avatar_data,
        avatar_extension=avatar_extension,
    )
    background_tasks.add_task(
        events.publish,
        services.chat_member_ids(db, chat_id),
        events.build_chat_event(chat_id),
    )
    return chat


@router.post("/{chat_id}/delivered", response_model=schemas.ReceiptResponse)
def mark_delivered(
    chat_id: int,
    payload: schemas.ReceiptUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    member = services.update_message_receipt(
        db, current_user, chat_id, payload.message_id, mark_read=False
    )
    _publish_receipt(background_tasks, db, chat_id, current_user.id)
    return member


@router.post("/{chat_id}/read", response_model=schemas.ReceiptResponse)
def mark_read(
    chat_id: int,
    payload: schemas.ReceiptUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    member = services.update_message_receipt(
        db, current_user, chat_id, payload.message_id, mark_read=True
    )
    _publish_receipt(background_tasks, db, chat_id, current_user.id)
    return member
