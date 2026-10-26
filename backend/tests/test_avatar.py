"""Тесты загрузки аватарок.

Запуск из корня репозитория:
    python -m pytest backend/tests/test_avatar.py -v

Тесты самодостаточны: поднимают SQLite в памяти и не требуют PostgreSQL/сервера.
"""
from __future__ import annotations

import sys
import uuid
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

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"avatar" * 10


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
    # Не пишем тестовые файлы в настоящую папку uploads/
    monkeypatch.setattr(media, "AVATARS_DIR", str(tmp_path / "avatars"))
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
        "/api/accounts/avatar",
        headers=auth(token),
        files={"file": ("avatar.png", content, kwargs.get("content_type", "image/png"))},
    )


def test_upload_avatar_saves_file_and_returns_user(client, tmp_path):
    user = register_and_login(client, "avatar_user")

    response = upload(client, user["access_token"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == user["user_id"]
    assert body["avatar_url"].startswith("/uploads/avatars/")
    assert body["avatar_url"].endswith(".png")

    filename = body["avatar_url"].rsplit("/", 1)[-1]
    assert (tmp_path / "avatars" / filename).is_file()

    # Обновлённый путь сохраняется в профиле и в ответе логина
    me = client.get("/api/me", headers=auth(user["access_token"]))
    assert me.status_code == 200
    assert me.json()["avatar_url"] == body["avatar_url"]

    login = client.post(
        "/api/login",
        json={"username": "avatar_user", "password": "pw123456"},
    )
    assert login.status_code == 200
    assert login.json()["avatar_url"] == body["avatar_url"]


def test_upload_avatar_replaces_old_file(client, tmp_path):
    user = register_and_login(client, "avatar_replace")

    first = upload(client, user["access_token"])
    assert first.status_code == 200, first.text
    old_url = first.json()["avatar_url"]
    old_path = tmp_path / "avatars" / old_url.rsplit("/", 1)[-1]
    assert old_path.is_file()

    second = upload(
        client,
        user["access_token"],
        PNG_BYTES + b"updated",
    )
    assert second.status_code == 200, second.text
    new_url = second.json()["avatar_url"]

    assert new_url != old_url
    assert not old_path.exists()
    assert (tmp_path / "avatars" / new_url.rsplit("/", 1)[-1]).is_file()


def test_upload_avatar_rejects_bad_type_and_size(client):
    user = register_and_login(client, "avatar_bad")

    not_image = client.post(
        "/api/accounts/avatar",
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
        b"\x89PNG\r\n\x1a\n" + b"x" * (media.MAX_AVATAR_SIZE + 1),
    )
    assert too_big.status_code == 413


def test_avatar_appears_in_contacts_and_chats(client):
    alice = register_and_login(client, "avatar_alice")
    bob = register_and_login(client, "avatar_bob")

    add = client.post(
        "/api/contacts",
        headers=auth(alice["access_token"]),
        json={"username": "avatar_bob"},
    )
    assert add.status_code == 201, add.text

    chat = client.post(
        "/api/chats",
        headers=auth(alice["access_token"]),
        json={"username": "avatar_bob"},
    )
    assert chat.status_code == 200, chat.text

    uploaded = upload(client, bob["access_token"])
    assert uploaded.status_code == 200, uploaded.text
    bob_avatar = uploaded.json()["avatar_url"]

    contacts = client.get("/api/contacts", headers=auth(alice["access_token"]))
    assert contacts.status_code == 200
    bob_contact = next(c for c in contacts.json() if c["id"] == bob["user_id"])
    assert bob_contact["avatar_url"] == bob_avatar

    chats = client.get("/api/chats", headers=auth(alice["access_token"]))
    assert chats.status_code == 200
    bob_chat = next(c for c in chats.json()["chats"] if c["id"] == chat.json()["id"])
    assert bob_chat["avatar_url"] == bob_avatar


def test_uploads_are_served_statically(client):
    name = f"test-{uuid.uuid4().hex}.png"
    path = Path(media.UPLOADS_ROOT) / "avatars" / name
    path.write_bytes(PNG_BYTES)
    try:
        response = client.get(f"/uploads/avatars/{name}")
        assert response.status_code == 200
        assert response.content == PNG_BYTES
    finally:
        path.unlink(missing_ok=True)


def test_avatar_update_is_published_over_websocket(client):
    alice = register_and_login(client, "avatar_ws_alice")
    bob = register_and_login(client, "avatar_ws_bob")

    chat = client.post(
        "/api/chats",
        headers=auth(alice["access_token"]),
        json={"username": "avatar_ws_bob"},
    )
    assert chat.status_code == 200, chat.text

    url = f"/ws/{alice['user_id']}?token={alice['access_token']}"
    with client.websocket_connect(url) as socket:
        uploaded = upload(client, bob["access_token"])
        assert uploaded.status_code == 200, uploaded.text

        event = socket.receive_json()
        assert event["type"] == "avatar_updated"
        assert event["user_id"] == bob["user_id"]
        assert event["avatar_url"] == uploaded.json()["avatar_url"]
