from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
import services
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api", tags=["contacts"])


@router.get("/contacts", response_model=list[schemas.UserResponse])
def get_contacts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.list_contacts(db, current_user)


@router.post("/contacts", response_model=schemas.UserResponse, status_code=201)
def add_contact(
    payload: schemas.ContactCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return services.add_contact(db, current_user, payload.username)
