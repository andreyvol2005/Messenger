from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import events
import media
import models
import schemas
import services
from auth import get_current_user
from constants import FAVORITES_CHAT_ID
from database import get_db

router = APIRouter(prefix="/api/messages", tags=["messages"])


async def _read_image_upload(file: UploadFile) -> tuple[bytes, str]:
    """Читает картинку и проверяет формат по сигнатуре, а не по расширению."""
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Можно отправлять только изображения")

    data = await file.read(media.MAX_IMAGE_SIZE + 1)
    if len(data) > media.MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="Файл больше 5 МБ")
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")

    extension = media.detect_image_extension(data[:16])
    if extension is None:
        raise HTTPException(status_code=400, detail="Файл не является изображением")
    return data, extension


def _action_recipients(db: Session, user: models.User, chat_id: int) -> list[int]:
    if chat_id == FAVORITES_CHAT_ID:
        return [user.id]
    return services.chat_member_ids(db, chat_id)


@router.get("/{chat_id}", response_model=list[schemas.MessageResponse])
def get_messages(
    chat_id: int,
    # Верхняя граница не даёт одним запросом выгрузить весь чат.
    limit: int = Query(50, ge=1, le=100),
    before_id: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """История чата постранично: без before_id — последние сообщения, с ним — более старые."""
    return services.list_messages(db, current_user, chat_id, limit, before_id)


@router.post("", response_model=schemas.MessageResponse)
def send_message(
    payload: schemas.MessageCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    result = services.create_message(db, current_user, payload.chat_id, payload.text, payload.reply_to_id)

    # Рассылка идёт после ответа, иначе WebSocket-событие обгоняет HTTP-ответ:
    # клиент получил бы событие раньше, чем узнал id своего сообщения, и показал
    # бы его дважды. Получателей и само событие считаем здесь, в фоновую задачу
    # сессия базы не передаётся — к её выполнению она уже может быть закрыта.
    recipients = events.recipients_for(db, result, payload.chat_id)
    # Для канала sender_nickname — это название канала, а не имя владельца.
    event = events.build_event(result, payload.chat_id, result.sender_nickname or current_user.nickname)
    background_tasks.add_task(events.publish, recipients, event)

    return result


@router.post("/{message_id}/view", response_model=schemas.MessageViewResponse)
def view_message(
    message_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Отметить просмотр поста канала. Повторный вызов счётчик не увеличивает."""
    return services.view_message(db, current_user, message_id)


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
    data, extension = await _read_image_upload(file)

    # Диск и база синхронные: в пуле потоков они не останавливают event loop.
    def save():
        media_url = media.save_image(data, extension)
        try:
            result = services.create_image_message(db, current_user, chat_id, media_url, caption, reply_to_id)
        except Exception:
            # Сообщение не сохранилось — файл-сирота на диске не нужен
            media.delete_image(media_url)
            raise
        return result, events.recipients_for(db, result, chat_id)

    result, recipients = await run_in_threadpool(save)
    # Для канала sender_nickname — это название канала, а не имя владельца.
    event = events.build_event(result, chat_id, result.sender_nickname or current_user.nickname)
    background_tasks.add_task(events.publish, recipients, event)

    return result


@router.post("/forward", response_model=list[schemas.MessageResponse])
def forward_messages(
    payload: schemas.MessageForward,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Пересылает выбранные сообщения в один или несколько чатов."""
    results = services.forward_messages(
        db,
        current_user,
        payload.message_ids,
        payload.chat_ids,
        payload.keep_reply,
    )

    # Каждая копия — обычное новое сообщение в целевом чате. Событие шлём
    # и отправителю: он мог пересылать из другого открытого чата.
    for msg in results:
        recipients = _action_recipients(db, current_user, msg.chat_id)
        event = events.build_response_event("message", msg)
        background_tasks.add_task(events.publish, recipients, event)

    return results


@router.post("/batch-delete", response_model=list[schemas.MessageRemovedResponse])
def delete_message_batch(
    payload: schemas.MessageBatchDelete,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    results = services.delete_messages(db, current_user, payload.message_ids)
    for item in results:
        background_tasks.add_task(
            events.publish,
            _action_recipients(db, current_user, item.chat_id),
            events.build_delete_event(item),
        )
    return results


@router.patch("/{message_id}", response_model=schemas.MessageResponse)
async def edit_message(
    message_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Правка текста и/или замена картинки в своём сообщении."""
    content_type = (request.headers.get("content-type") or "").lower()

    text: str | None = None
    file = None
    if "application/json" in content_type:
        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Некорректный JSON")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Некорректный JSON")
        text = payload.get("text")
        if text is not None and not isinstance(text, str):
            raise HTTPException(status_code=422, detail="Текст должен быть строкой")
    elif content_type.startswith("multipart/form-data") or content_type.startswith("application/x-www-form-urlencoded"):
        form = await request.form()
        text = form.get("text")
        file = form.get("file")
        if text is not None and not isinstance(text, str):
            raise HTTPException(status_code=422, detail="Текст должен быть строкой")
        # Строка вместо файла — это не загрузка, считаем поле пустым
        if file is not None and not hasattr(file, "read"):
            file = None
    else:
        raise HTTPException(
            status_code=415,
            detail="Ожидается JSON или multipart/form-data",
        )

    upload = await _read_image_upload(file) if file is not None else None

    # Диск и база синхронные: в пуле потоков они не останавливают event loop.
    def save():
        new_media_url = media.save_image(*upload) if upload else None
        try:
            result = services.edit_message(
                db,
                current_user,
                message_id,
                text,
                new_media_url=new_media_url,
            )
        except Exception:
            if new_media_url:
                media.delete_image(new_media_url)
            raise
        return result, _action_recipients(db, current_user, result.chat_id)

    result, recipients = await run_in_threadpool(save)
    background_tasks.add_task(
        events.publish,
        recipients,
        events.build_response_event("message_edited", result),
    )
    return result


@router.delete("/{message_id}", response_model=schemas.MessageRemovedResponse)
def delete_message(
    message_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    results = services.delete_messages(db, current_user, [message_id])
    item = results[0]
    background_tasks.add_task(
        events.publish,
        _action_recipients(db, current_user, item.chat_id),
        events.build_delete_event(item),
    )
    return item
