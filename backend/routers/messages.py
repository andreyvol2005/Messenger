from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

import models
import schemas
import services
import events
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/messages", tags=["messages"])


@router.get("/{chat_id}", response_model=list[schemas.MessageResponse])
def get_messages(
    chat_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.list_messages(db, current_user, chat_id, limit)


@router.post("", response_model=schemas.MessageResponse)
def send_message(
    payload: schemas.MessageCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    result = services.create_message(
        db, current_user, payload.chat_id, payload.text, payload.reply_to_id
    )

    # Рассылка идёт после ответа, иначе WebSocket-событие обгоняет HTTP-ответ:
    # клиент получил бы событие раньше, чем узнал id своего сообщения, и показал
    # бы его дважды. Получателей и само событие считаем здесь, в фоновую задачу
    # сессия базы не передаётся — к её выполнению она уже может быть закрыта.
    recipients = events.recipients_for(db, result, payload.chat_id)
    event = events.build_event(result, payload.chat_id, current_user.nickname)
    background_tasks.add_task(events.publish, recipients, event)

    return result


@router.post("/{message_id}/favorite", response_model=schemas.MessageResponse)
def toggle_favorite(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.toggle_favorite(db, current_user, message_id)