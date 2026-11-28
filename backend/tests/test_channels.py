"""Тесты каналов: создание, каталог, подписка, публикация и просмотры.

Запуск из корня репозитория:
    python -m pytest backend/tests/test_channels.py -v

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

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"channel-avatar" * 10


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
    monkeypatch.setattr(media, "GROUP_AVATARS_DIR", str(tmp_path / "group_avatars"))
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


def create_channel(client: TestClient, user: dict, name: str):
    return client.post(
        "/api/chats/channels",
        headers=auth(user["access_token"]),
        json={"name": name},
    )


def channel_catalog(client: TestClient, user: dict, query: str = ""):
    url = "/api/chats/channels"
    if query:
        url += f"?query={query}"
    return client.get(url, headers=auth(user["access_token"]))


def find_chat(client: TestClient, user: dict, chat_id: int):
    response = client.get("/api/chats", headers=auth(user["access_token"]))
    assert response.status_code == 200, response.text
    return next(
        (chat for chat in response.json()["chats"] if chat["id"] == chat_id),
        None,
    )


def send_post(client: TestClient, user: dict, chat_id: int, text: str):
    return client.post(
        "/api/messages",
        headers=auth(user["access_token"]),
        json={"chat_id": chat_id, "text": text},
    )


def history(client: TestClient, user: dict, chat_id: int):
    response = client.get(
        f"/api/messages/{chat_id}",
        headers=auth(user["access_token"]),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_channel_and_catalog(client):
    alice = register_and_login(client, "channel_alice")
    bob = register_and_login(client, "channel_bob")
    carol = register_and_login(client, "channel_carol")

    created = create_channel(client, alice, "Новости")
    assert created.status_code == 200, created.text
    channel = created.json()
    assert channel["title"] == "Новости"
    assert channel["chat_type"] == "channel"
    assert channel["members_count"] == 1
    assert channel["owner_id"] == alice["user_id"]
    assert channel["is_subscribed"] is True
    channel_id = channel["id"]

    # Название обязательно и ограничено по длине
    assert create_channel(client, alice, "   ").status_code == 400
    assert create_channel(client, alice, "я" * 51).status_code == 400

    # Канал виден в каталоге всем, даже без подписки
    catalog = channel_catalog(client, bob)
    assert catalog.status_code == 200, catalog.text
    found = next(item for item in catalog.json()["channels"] if item["id"] == channel_id)
    assert found["title"] == "Новости"
    assert found["is_subscribed"] is False
    assert found["members_count"] == 1

    # В общем списке чатов у неподписанного пользователя канала нет
    assert find_chat(client, bob, channel_id) is None
    assert find_chat(client, alice, channel_id)["chat_type"] == "channel"

    # Подписка добавляет канал в список чатов и идемпотентна
    subscribed = client.post(
        f"/api/chats/{channel_id}/subscribe",
        headers=auth(bob["access_token"]),
    )
    assert subscribed.status_code == 200, subscribed.text
    assert subscribed.json()["is_subscribed"] is True
    assert subscribed.json()["members_count"] == 2
    assert find_chat(client, bob, channel_id) is not None
    # В канале нет непрочитанных: активность считается просмотрами постов
    assert find_chat(client, bob, channel_id)["unread_count"] == 0

    again = client.post(
        f"/api/chats/{channel_id}/subscribe",
        headers=auth(bob["access_token"]),
    )
    assert again.status_code == 200, again.text
    assert again.json()["members_count"] == 2

    # Поиск по названию
    found = channel_catalog(client, carol, "новост")
    assert [item["id"] for item in found.json()["channels"]] == [channel_id]
    assert channel_catalog(client, carol, "несуществующий").json()["channels"] == []

    # Владелец не может отписаться от своего канала
    owner_unsubscribe = client.delete(
        f"/api/chats/{channel_id}/subscribe",
        headers=auth(alice["access_token"]),
    )
    assert owner_unsubscribe.status_code == 400

    unsubscribed = client.delete(
        f"/api/chats/{channel_id}/subscribe",
        headers=auth(bob["access_token"]),
    )
    assert unsubscribed.status_code == 200, unsubscribed.text
    assert unsubscribed.json()["is_subscribed"] is False
    assert unsubscribed.json()["members_count"] == 1
    assert find_chat(client, bob, channel_id) is None

    # Канал можно читать без подписки
    assert history(client, bob, channel_id) == []

    # Обычный чат через канальные маршруты недоступен
    private = client.post(
        "/api/chats",
        headers=auth(alice["access_token"]),
        json={"username": "channel_bob"},
    )
    assert private.status_code == 200, private.text
    not_channel = client.get(
        f"/api/chats/channels/{private.json()['id']}",
        headers=auth(alice["access_token"]),
    )
    assert not_channel.status_code == 400


def test_only_owner_posts_and_views_are_unique(client):
    alice = register_and_login(client, "channel_post_alice")
    bob = register_and_login(client, "channel_post_bob")
    carol = register_and_login(client, "channel_post_carol")

    channel = create_channel(client, alice, "Заметки").json()
    channel_id = channel["id"]
    client.post(
        f"/api/chats/{channel_id}/subscribe",
        headers=auth(bob["access_token"]),
    )

    # Публикует только владелец, даже если подписчик состоит в канале
    forbidden = send_post(client, bob, channel_id, "Я тоже хочу")
    assert forbidden.status_code == 403
    assert send_post(client, carol, channel_id, "И я").status_code == 403

    first = send_post(client, alice, channel_id, "Первый пост")
    assert first.status_code == 200, first.text
    post = first.json()
    assert post["sender_nickname"] == "Заметки"
    assert post["views_count"] == 1
    assert post["status"] == "sent"

    # Подписчик видит пост в списке чатов, но бейджа непрочитанного нет
    subscriber_chat = find_chat(client, bob, channel_id)
    assert subscriber_chat is not None
    assert subscriber_chat["unread_count"] == 0

    # Отметки доставки и прочтения в канале не поддерживаются
    for endpoint in ("delivered", "read"):
        receipt = client.post(
            f"/api/chats/{channel_id}/{endpoint}",
            headers=auth(bob["access_token"]),
            json={"message_id": post["id"]},
        )
        assert receipt.status_code == 400

    # В канале нельзя отвечать на посты
    reply = client.post(
        "/api/messages",
        headers=auth(alice["access_token"]),
        json={
            "chat_id": channel_id,
            "text": "Ответ",
            "reply_to_id": post["id"],
        },
    )
    assert reply.status_code == 400

    # Автор уже посмотрел свой пост
    history(client, alice, channel_id)
    assert history(client, alice, channel_id)[0]["views_count"] == 1

    # Каждый новый читатель увеличивает счётчик ровно один раз
    bob_history = history(client, bob, channel_id)
    assert bob_history[0]["views_count"] == 2
    assert history(client, bob, channel_id)[0]["views_count"] == 2

    # Неподписанный пользователь тоже может читать и попадает в просмотры
    carol_history = history(client, carol, channel_id)
    assert carol_history[0]["views_count"] == 3
    assert history(client, carol, channel_id)[0]["views_count"] == 3

    # Отметка просмотра идемпотентна и возвращает актуальный счётчик
    view = client.post(
        f"/api/messages/{post['id']}/view",
        headers=auth(bob["access_token"]),
    )
    assert view.status_code == 200, view.text
    assert view.json() == {"message_id": post["id"], "views_count": 3}

    # Второй пост не должен подхватывать просмотры первого
    second = send_post(client, alice, channel_id, "Второй пост")
    assert second.status_code == 200, second.text
    assert second.json()["views_count"] == 1

    posts = history(client, bob, channel_id)
    by_id = {item["id"]: item for item in posts}
    assert by_id[post["id"]]["views_count"] == 3
    assert by_id[second.json()["id"]]["views_count"] == 2

    # У обычного сообщения просмотров нет
    private = client.post(
        "/api/chats",
        headers=auth(alice["access_token"]),
        json={"username": "channel_post_bob"},
    )
    private_id = private.json()["id"]
    private_post = send_post(client, alice, private_id, "Личное")
    assert private_post.json()["views_count"] == 0
    not_channel_view = client.post(
        f"/api/messages/{private_post.json()['id']}/view",
        headers=auth(alice["access_token"]),
    )
    assert not_channel_view.status_code == 400


def test_channel_rename_and_avatar_are_owner_only(client):
    alice = register_and_login(client, "channel_edit_alice")
    bob = register_and_login(client, "channel_edit_bob")

    channel_id = create_channel(client, alice, "Старое имя").json()["id"]
    client.post(
        f"/api/chats/{channel_id}/subscribe",
        headers=auth(bob["access_token"]),
    )

    # Подписчик не управляет каналом
    forbidden = client.patch(
        f"/api/chats/{channel_id}",
        headers=auth(bob["access_token"]),
        json={"name": "Чужое имя"},
    )
    assert forbidden.status_code == 403

    renamed = client.patch(
        f"/api/chats/{channel_id}",
        headers=auth(alice["access_token"]),
        json={"name": "Новое имя"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "Новое имя"
    assert renamed.json()["chat_type"] == "channel"
    assert renamed.json()["members_count"] == 2

    blank = client.patch(
        f"/api/chats/{channel_id}",
        headers=auth(alice["access_token"]),
        json={"name": "  "},
    )
    assert blank.status_code == 400

    uploaded = client.patch(
        f"/api/chats/{channel_id}",
        headers=auth(alice["access_token"]),
        files={"file": ("channel.png", PNG_BYTES, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    avatar_url = uploaded.json()["avatar_url"]
    assert avatar_url.startswith("/uploads/group_avatars/")
    assert find_chat(client, bob, channel_id)["avatar_url"] == avatar_url

    # В каталоге видны новые название и аватар
    catalog = channel_catalog(client, bob).json()["channels"]
    found = next(item for item in catalog if item["id"] == channel_id)
    assert found["title"] == "Новое имя"
    assert found["avatar_url"] == avatar_url


def test_channel_posts_are_published_to_subscribers(client):
    alice = register_and_login(client, "channel_ws_alice")
    bob = register_and_login(client, "channel_ws_bob")

    channel_id = create_channel(client, alice, "Онлайн").json()["id"]
    client.post(
        f"/api/chats/{channel_id}/subscribe",
        headers=auth(bob["access_token"]),
    )

    url = f"/ws/{bob['user_id']}?token={bob['access_token']}"
    with client.websocket_connect(url) as socket:
        presence = socket.receive_json()
        assert presence["type"] == "presence"

        posted = send_post(client, alice, channel_id, "Свежий пост")
        assert posted.status_code == 200, posted.text

        event = socket.receive_json()
        assert event["type"] == "message"
        assert event["chat_id"] == channel_id
        assert event["sender_nickname"] == "Онлайн"
        assert event["views_count"] == 1
