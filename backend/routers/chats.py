from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

import events
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
