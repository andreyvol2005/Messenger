"""Тесты загрузки обоев чата.

Запуск из корня репозитория:
    python -m pytest backend/tests/test_wallpaper.py -v

Обои — клиентская настройка: сервер только сохраняет файл и возвращает URL,
поэтому тесты проверяют файл на диске и отсутствие изменений в профиле.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import media  # noqa: E402
import routers.ws as ws_router  # noqa: E402
from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"wallpaper" * 10


@pytest.fixture()
def client(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    # WS-обработчик создаёт сессию сам, минуя Depends(get_db)
    monkeypatch.setattr(ws_router, "SessionLocal", testing_session)
    # Не пишем тестовые обои в настоящую папку uploads/
    monkeypatch.setattr(media, "WALLPAPERS_DIR", str(tmp_path / "wallpapers"))
    app.dependency_overrides[get_db] = override_get_db

    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def register_and_login(client: TestClient, username: str) -> dict:
    response = client.post(
        "/api/register",
        json={"username": username, "password": "pw123456"},
    )
    assert response.status_code == 200, response.text

    response = client.post(
        "/api/login",
        json={"username": username, "password": "pw123456"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def upload(client: TestClient, token: str, content: bytes = PNG_BYTES, **kwargs):
    return client.post(
        "/api/accounts/wallpaper",
        headers=auth(token),
        files={
            "file": (
                "wallpaper.png",
                content,
                kwargs.get("content_type", "image/png"),
            )
        },
    )


def test_upload_wallpaper_saves_file_and_returns_url(client, tmp_path):
    user = register_and_login(client, "wallpaper_user")
    before = client.get("/api/me", headers=auth(user["access_token"]))
    assert before.status_code == 200

    response = upload(client, user["access_token"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["url"].startswith("/uploads/wallpapers/")
    assert body["url"].endswith(".png")

    filename = body["url"].rsplit("/", 1)[-1]
    assert (tmp_path / "wallpapers" / filename).is_file()

    # База не меняется: профиль остаётся прежним, поля обоев в нём нет
    me = client.get("/api/me", headers=auth(user["access_token"]))
    assert me.status_code == 200
    profile = me.json()
    assert profile == before.json()
    assert "wallpaper" not in profile
    assert "wallpaper_url" not in profile


def test_upload_wallpaper_requires_auth(client):
    response = client.post(
        "/api/accounts/wallpaper",
        files={"file": ("wallpaper.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 401


def test_upload_wallpaper_rejects_bad_type_and_size(client):
    user = register_and_login(client, "wallpaper_bad")

    not_image = client.post(
        "/api/accounts/wallpaper",
        headers=auth(user["access_token"]),
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert not_image.status_code == 400

    # content-type подделан, но содержимое не картинка
    spoofed = upload(
        client,
        user["access_token"],
        b"not an image at all",
        content_type="image/png",
    )
    assert spoofed.status_code == 400

    too_big = upload(
        client,
        user["access_token"],
        b"\x89PNG\r\n\x1a\n" + b"x" * (media.MAX_WALLPAPER_SIZE + 1),
    )
    assert too_big.status_code == 413


def test_upload_wallpaper_accepts_webp(client, tmp_path):
    user = register_and_login(client, "wallpaper_webp")
    webp = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"data"

    response = upload(client, user["access_token"], webp, content_type="image/webp")
    assert response.status_code == 200, response.text
    url = response.json()["url"]
    assert url.endswith(".webp")
    assert (tmp_path / "wallpapers" / url.rsplit("/", 1)[-1]).is_file()


def test_each_upload_gets_its_own_file(client, tmp_path):
    user = register_and_login(client, "wallpaper_many")

    first = upload(client, user["access_token"])
    second = upload(client, user["access_token"], PNG_BYTES + b"second")
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["url"] != second.json()["url"]

    first_path = tmp_path / "wallpapers" / first.json()["url"].rsplit("/", 1)[-1]
    second_path = tmp_path / "wallpapers" / second.json()["url"].rsplit("/", 1)[-1]
    assert first_path.is_file()
    assert second_path.is_file()
