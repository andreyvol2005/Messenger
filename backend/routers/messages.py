from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from sqlalchemy.orm import Session

import events
import media
import models
import schemas
import services
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


@router.post("/upload", response_model=schemas.MessageResponse)
async def upload_image(
    background_tasks: BackgroundTasks,
    chat_id: int = Form(...),
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    reply_to_id: int | None = Form(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Загрузка изображения: файл на диск, в messages — только относительный путь."""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Можно отправлять только изображения")

    # Читаем на байт больше лимита: файл целиком в память не тянем, но и
    # превышение замечаем сразу, не дожидаясь конца загрузки.
    data = await file.read(media.MAX_IMAGE_SIZE + 1)
    if len(data) > media.MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Файл больше 5 МБ")
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")

    extension = media.detect_image_extension(data[:16])
    if extension is None:
        raise HTTPException(status_code=400, detail="Файл не является изображением")

    media_url = media.save_image(data, extension)
    try:
        result = services.create_image_message(
            db, current_user, chat_id, media_url, caption, reply_to_id
        )
    except Exception:
        # Сообщение не сохранилось — файл-сирота на диске не нужен
        media.delete_image(media_url)
        raise

    recipients = events.recipients_for(db, result, chat_id)
    event = events.build_event(result, chat_id, current_user.nickname)
    background_tasks.add_task(events.publish, recipients, event)

    return result


@router.post("/{message_id}/favorite", response_model=schemas.MessageResponse)
def toggle_favorite(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.toggle_favorite(db, current_user, message_id)
