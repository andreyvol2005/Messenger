from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date

import auth
import models
import schemas
from database import get_db

router = APIRouter(prefix="/api", tags=["accounts"])


@router.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    nickname = user.nickname.strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="Nickname is empty")

    # Проверяем, занят ли никнейм
    existing = db.query(models.User).filter(models.User.nickname == nickname).first()
    if existing:
        raise HTTPException(status_code=400, detail="Nickname already taken")

    new_user = models.User(
        nickname=nickname,
        password_hash=auth.get_password_hash(user.password)
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.post("/login")
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.nickname == credentials.nickname.strip()).first()
    if not user or not auth.verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid nickname or password")

    token = auth.create_access_token({"sub": user.nickname, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "nickname": user.nickname
    }


@router.get("/users", response_model=list[schemas.UserResponse])
def get_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return db.query(models.User).filter(models.User.id != current_user.id).all()


@router.get("/me", response_model=schemas.ProfileResponse)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    # current_user уже загружен из базы зависимостью get_current_user
    return current_user


@router.patch("/me", response_model=schemas.ProfileResponse)
def update_me(
    payload: schemas.ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # exclude_unset: PATCH не должен затирать поля, которых нет в запросе
    data = payload.model_dump(exclude_unset=True)

    if "bio" in data:
        bio = (data["bio"] or "").strip()
        if len(bio) > 150:
            raise HTTPException(status_code=400, detail="Информация о себе длиннее 150 символов")
        current_user.bio = bio or None

    if "birth_date" in data:
        birth_date = data["birth_date"]
        if birth_date and birth_date > date.today():
            raise HTTPException(status_code=400, detail="Дата рождения не может быть в будущем")
        current_user.birth_date = birth_date

    db.commit()
    db.refresh(current_user)
    return current_user
