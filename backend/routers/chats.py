from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
import services
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/chats", tags=["chats"])


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
    return services.create_or_get_chat(db, current_user, payload.nickname)