"""Текущее присутствие пользователей.

Список нужен при загрузке страницы: WebSocket сообщает только об изменениях,
а кто был в сети до подключения — клиент узнаёт здесь.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import events
import models
import schemas
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api", tags=["presence"])


@router.get("/presence", response_model=schemas.PresenceResponse)
def get_presence(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return schemas.PresenceResponse(
        online=events.online_related_ids(db, current_user.id),
        last_seen=events.visible_last_seen(db, current_user.id),
    )
