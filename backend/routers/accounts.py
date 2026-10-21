from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from datetime import date

import auth
import models
import schemas
import validation
from database import get_db

router = APIRouter(prefix="/api", tags=["accounts"])


@router.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    # На входе username без «@», в базе — с «@». Никнейм при регистрации
    # повторяет username, но потом его можно менять независимо.
    username = validation.normalize_username(user.username)
    nickname = username[1:]

    existing = db.query(models.User).filter(models.User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Этот username уже занят")

    new_user = models.User(
        username=username,
        nickname=nickname,
        password_hash=auth.get_password_hash(user.password),
    )
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        # Гонка: параллельная регистрация успела занять тот же username
        db.rollback()
        raise HTTPException(status_code=409, detail="Этот username уже занят")

    db.refresh(new_user)
    return new_user


@router.post("/login")
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    username = validation.normalize_username(credentials.username)
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user or not auth.verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный username или пароль")

    # sub хранит username для читаемости, а доступ к аккаунту привязан к user_id:
    # поэтому смена username не разлогинивает текущую сессию.
    token = auth.create_access_token({"sub": user.username, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": user.username,
        "nickname": user.nickname,
    }


@router.get("/users", response_model=list[schemas.UserResponse])
def get_users(
    q: str = "",
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.User).filter(models.User.id != current_user.id)
    term = q.strip().lstrip("@")
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                models.User.username.ilike(like),
                models.User.nickname.ilike(like),
            )
        )
    return query.order_by(models.User.nickname).limit(20).all()


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

    if "username" in data:
        username = validation.normalize_username(data["username"])
        if username != current_user.username:
            taken = (
                db.query(models.User)
                .filter(
                    models.User.username == username,
                    models.User.id != current_user.id,
                )
                .first()
            )
            if taken:
                raise HTTPException(status_code=409, detail="Этот username уже занят")
            current_user.username = username

    if "nickname" in data:
        current_user.nickname = validation.validate_nickname(data["nickname"])

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

    try:
        db.commit()
    except IntegrityError:
        # На случай гонки: username заняли между проверкой и сохранением
        db.rollback()
        raise HTTPException(status_code=409, detail="Этот username уже занят")

    db.refresh(current_user)
    return current_user
