"""Тесты действий с сообщениями: ответы, правка, удаление, пересылка.

Запуск из корня репозитория:
    python -m pytest backend/tests/test_messages.py -v

Как и остальные тесты, поднимают SQLite в памяти и не требуют PostgreSQL.
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

import events  # noqa: E402
import media  # noqa: E402
import routers.ws as ws_router  # noqa: E402
from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"message-image" * 10
FAVORITES_CHAT_ID = -1


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
    # Не пишем тестовые картинки в настоящую папку uploads/
    monkeypatch.setattr(media, "IMAGES_DIR", str(tmp_path / "images"))
    app.dependency_overrides[get_db] = override_get_db
    events.manager.active.clear()

    try:
        yield TestClient(app)
    finally:
        events.manager.active.clear()
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


def create_chat(client: TestClient, user: dict, peer: dict) -> int:
    response = client.post(
        "/api/chats",
        headers=auth(user["access_token"]),
        json={"username": peer["username"].lstrip("@")},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def send(
    client: TestClient,
    user: dict,
    chat_id: int,
    text: str,
    reply_to_id: int | None = None,
):
    payload = {"chat_id": chat_id, "text": text}
    if reply_to_id is not None:
        payload["reply_to_id"] = reply_to_id
    response = client.post(
        "/api/messages",
        headers=auth(user["access_token"]),
        json=payload,
    )
    assert response.status_code == 200, response.text
    return response.json()


def history(client: TestClient, user: dict, chat_id: int) -> list[dict]:
    response = client.get(
        f"/api/messages/{chat_id}",
        headers=auth(user["access_token"]),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_reply_saves_quote_snapshot_and_allows_deleted_target(client):
    alice = register_and_login(client, "msg_reply_alice")
    bob = register_and_login(client, "msg_reply_bob")
    carol = register_and_login(client, "msg_reply_carol")
    chat_id = create_chat(client, alice, bob)

    original = send(client, bob, chat_id, "Оригинальный текст")
    reply = send(client, alice, chat_id, "Мой ответ", original["id"])

    assert reply["reply_to_id"] == original["id"]
    assert reply["reply_to_nickname"] == bob["nickname"]
    assert reply["reply_to_text"] == "Оригинальный текст"

    rows = history(client, alice, chat_id)
    assert [row["id"] for row in rows] == [original["id"], reply["id"]]

    # Ссылка на сообщение из другого чата не принимается
    other_chat = create_chat(client, alice, carol)
    wrong_chat = client.post(
        "/api/messages",
        headers=auth(alice["access_token"]),
        json={
            "chat_id": other_chat,
            "text": "Ответ не туда",
            "reply_to_id": original["id"],
        },
    )
    assert wrong_chat.status_code == 400

    # Удалённый оригинал остаётся доступен как цитата-заглушка
    removed = client.delete(
        f"/api/messages/{original['id']}",
        headers=auth(bob["access_token"]),
    )
    assert removed.status_code == 200, removed.text

    rows = history(client, alice, chat_id)
    existing_reply = next(row for row in rows if row["id"] == reply["id"])
    assert existing_reply["reply_to_text"] == "Сообщение удалено"

    reply_to_tombstone = send(
        client, alice, chat_id, "Ответ на удалённое", original["id"]
    )
    assert reply_to_tombstone["reply_to_text"] == "Сообщение удалено"
    assert reply_to_tombstone["reply_to_nickname"] == bob["nickname"]


def test_edit_own_text_and_reject_foreign_or_empty(client):
    alice = register_and_login(client, "msg_edit_alice")
    bob = register_and_login(client, "msg_edit_bob")
    chat_id = create_chat(client, alice, bob)

    message = send(client, alice, chat_id, "Старый текст")
    edited = client.patch(
        f"/api/messages/{message['id']}",
        headers=auth(alice["access_token"]),
        json={"text": "  Новый текст  "},
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["text"] == "Новый текст"
    assert body["edited_at"] is not None
    assert body["media_url"] is None

    foreign = client.patch(
        f"/api/messages/{message['id']}",
        headers=auth(bob["access_token"]),
        json={"text": "Чужая правка"},
    )
    assert foreign.status_code == 403

    empty = client.patch(
        f"/api/messages/{message['id']}",
        headers=auth(alice["access_token"]),
        json={"text": "   "},
    )
    assert empty.status_code == 400
    assert history(client, alice, chat_id)[0]["text"] == "Новый текст"

    removed = client.delete(
        f"/api/messages/{message['id']}",
        headers=auth(alice["access_token"]),
    )
    assert removed.status_code == 200, removed.text
    too_late = client.patch(
        f"/api/messages/{message['id']}",
        headers=auth(alice["access_token"]),
        json={"text": "После удаления"},
    )
    assert too_late.status_code == 400


def test_edit_replaces_image_but_keeps_old_file_for_forwards(client, tmp_path):
    alice = register_and_login(client, "msg_image_alice")
    bob = register_and_login(client, "msg_image_bob")
    chat_id = create_chat(client, alice, bob)

    uploaded = client.post(
        "/api/messages/upload",
        headers=auth(alice["access_token"]),
        data={"chat_id": str(chat_id), "caption": "Старая подпись"},
        files={"file": ("old.png", PNG_BYTES, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    message = uploaded.json()
    old_url = message["media_url"]
    old_path = tmp_path / "images" / old_url.rsplit("/", 1)[-1]
    assert old_path.is_file()

    edited = client.patch(
        f"/api/messages/{message['id']}",
        headers=auth(alice["access_token"]),
        data={"text": "Новая подпись"},
        files={
            "file": ("new.png", PNG_BYTES + b"new", "image/png"),
        },
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["text"] == "Новая подпись"
    assert body["edited_at"] is not None
    assert body["media_url"] != old_url

    new_path = tmp_path / "images" / body["media_url"].rsplit("/", 1)[-1]
    assert new_path.is_file()
    # Старый файл не удаляем: на него могут ссылаться пересланные копии
    assert old_path.is_file()

    # У сообщения с картинкой можно очистить подпись, оставив изображение
    cleared = client.patch(
        f"/api/messages/{message['id']}",
        headers=auth(alice["access_token"]),
        json={"text": "   "},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["text"] is None
    assert cleared.json()["media_url"] == body["media_url"]


def test_delete_creates_tombstone_and_batch_is_atomic(client):
    alice = register_and_login(client, "msg_delete_alice")
    bob = register_and_login(client, "msg_delete_bob")
    chat_id = create_chat(client, alice, bob)

    own = send(client, alice, chat_id, "Своё сообщение")
    foreign = send(client, bob, chat_id, "Чужое сообщение")

    denied = client.delete(
        f"/api/messages/{foreign['id']}",
        headers=auth(alice["access_token"]),
    )
    assert denied.status_code == 403

    # В пакете есть чужое сообщение — не удаляется ничего
    denied_batch = client.post(
        "/api/messages/batch-delete",
        headers=auth(alice["access_token"]),
        json={"message_ids": [own["id"], foreign["id"]]},
    )
    assert denied_batch.status_code == 403
    rows = history(client, alice, chat_id)
    assert all(not row["is_deleted"] for row in rows)

    deleted = client.delete(
        f"/api/messages/{own['id']}",
        headers=auth(alice["access_token"]),
    )
    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert body["removed"] is False
    assert body["message"]["is_deleted"] is True
    assert body["message"]["text"] is None

    rows = history(client, alice, chat_id)
    tombstone = next(row for row in rows if row["id"] == own["id"])
    assert tombstone["is_deleted"] is True
    assert tombstone["text"] is None
    assert tombstone["sender_nickname"] == alice["nickname"]
    assert tombstone["created_at"]

    repeated = client.delete(
        f"/api/messages/{own['id']}",
        headers=auth(alice["access_token"]),
    )
    assert repeated.status_code == 400

    first = send(client, alice, chat_id, "Первое")
    second = send(client, alice, chat_id, "Второе")
    batch = client.post(
        "/api/messages/batch-delete",
        headers=auth(alice["access_token"]),
        json={"message_ids": [first["id"], second["id"]]},
    )
    assert batch.status_code == 200, batch.text
    batch_body = batch.json()
    assert len(batch_body) == 2
    assert all(item["removed"] is False for item in batch_body)
    assert all(item["message"]["is_deleted"] for item in batch_body)


def test_favorites_store_notes_and_replies_without_star_api(client):
    alice = register_and_login(client, "msg_fav_alice")
    bob = register_and_login(client, "msg_fav_bob")

    note = send(client, alice, FAVORITES_CHAT_ID, "Личная заметка")
    assert note["chat_id"] == FAVORITES_CHAT_ID
    assert "is_favorite" not in note

    reply = send(
        client,
        alice,
        FAVORITES_CHAT_ID,
        "Ответ на заметку",
        note["id"],
    )
    assert reply["reply_to_text"] == "Личная заметка"
    assert reply["chat_id"] == FAVORITES_CHAT_ID

    assert [row["id"] for row in history(client, alice, FAVORITES_CHAT_ID)] == [
        note["id"],
        reply["id"],
    ]
    # Папка приватная: чужой пользователь видит только своё (пусто)
    assert history(client, bob, FAVORITES_CHAT_ID) == []

    # Старая звёздная ручка удалена: POST по этому пути не обслуживается
    old_api = client.post(
        f"/api/messages/{note['id']}/favorite",
        headers=auth(alice["access_token"]),
    )
    assert old_api.status_code in (404, 405)

    # Копия/заметка в «Избранном» удаляется физически, без заглушки
    removed = client.delete(
        f"/api/messages/{note['id']}",
        headers=auth(alice["access_token"]),
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["removed"] is True
    assert removed.json()["message"] is None

    rows = history(client, alice, FAVORITES_CHAT_ID)
    assert [row["id"] for row in rows] == [reply["id"]]
    assert rows[0]["reply_to_id"] is None
    assert rows[0]["reply_to_text"] == "Сообщение удалено"


def test_forward_creates_n_times_m_copies_and_can_keep_reply(client):
    alice = register_and_login(client, "msg_forward_alice")
    bob = register_and_login(client, "msg_forward_bob")
    carol = register_and_login(client, "msg_forward_carol")
    dave = register_and_login(client, "msg_forward_dave")

    chat_ab = create_chat(client, alice, bob)
    chat_bc = create_chat(client, bob, carol)

    bob_message = send(client, bob, chat_ab, "От Боба")
    alice_reply = send(client, alice, chat_ab, "Ответ Алисы", bob_message["id"])

    # Чужой чат в качестве цели недоступен
    denied_target = client.post(
        "/api/messages/forward",
        headers=auth(alice["access_token"]),
        json={
            "message_ids": [bob_message["id"]],
            "chat_ids": [chat_bc],
            "keep_reply": False,
        },
    )
    assert denied_target.status_code == 403

    # Чужое исходное сообщение нельзя переслать
    denied_source = client.post(
        "/api/messages/forward",
        headers=auth(dave["access_token"]),
        json={
            "message_ids": [bob_message["id"]],
            "chat_ids": [FAVORITES_CHAT_ID],
            "keep_reply": False,
        },
    )
    assert denied_source.status_code == 403

    forwarded = client.post(
        "/api/messages/forward",
        headers=auth(alice["access_token"]),
        json={
            "message_ids": [bob_message["id"], alice_reply["id"]],
            "chat_ids": [chat_ab, FAVORITES_CHAT_ID],
            "keep_reply": False,
        },
    )
    assert forwarded.status_code == 200, forwarded.text
    copies = forwarded.json()
    assert len(copies) == 4  # 2 сообщения × 2 чата

    assert sum(item["chat_id"] == chat_ab for item in copies) == 2
    assert sum(item["chat_id"] == FAVORITES_CHAT_ID for item in copies) == 2
    assert all(item["sender_id"] == alice["user_id"] for item in copies)

    bob_copy = next(
        item for item in copies if item["text"] == "От Боба" and item["chat_id"] == chat_ab
    )
    reply_copy = next(
        item
        for item in copies
        if item["text"] == "Ответ Алисы" and item["chat_id"] == chat_ab
    )
    # Подпись — немедленный отправитель оригинала, а не первый автор
    assert bob_copy["forwarded_from_nickname"] == bob["nickname"]
    assert reply_copy["forwarded_from_nickname"] == alice["nickname"]
    # По умолчанию цитата не сохраняется
    assert reply_copy["reply_to_id"] is None
    assert reply_copy["reply_to_text"] is None

    keep = client.post(
        "/api/messages/forward",
        headers=auth(alice["access_token"]),
        json={
            "message_ids": [alice_reply["id"]],
            "chat_ids": [FAVORITES_CHAT_ID],
            "keep_reply": True,
        },
    )
    assert keep.status_code == 200, keep.text
    kept = keep.json()
    assert len(kept) == 1
    assert kept[0]["reply_to_id"] is None
    assert kept[0]["reply_to_nickname"] == bob["nickname"]
    assert kept[0]["reply_to_text"] == "От Боба"

    # В «Избранном» теперь лежат три пересланные копии
    favorites = history(client, alice, FAVORITES_CHAT_ID)
    assert len(favorites) == 3
    assert all(row["forwarded_from_nickname"] for row in favorites)

    # Удалённое сообщение пересылать нельзя
    deleted = client.delete(
        f"/api/messages/{bob_message['id']}",
        headers=auth(bob["access_token"]),
    )
    assert deleted.status_code == 200, deleted.text
    denied_deleted = client.post(
        "/api/messages/forward",
        headers=auth(alice["access_token"]),
        json={
            "message_ids": [bob_message["id"]],
            "chat_ids": [chat_ab],
            "keep_reply": False,
        },
    )
    assert denied_deleted.status_code == 400
