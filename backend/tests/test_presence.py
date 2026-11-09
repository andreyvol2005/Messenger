"""Тесты индикатора присутствия.

Запуск из корня репозитория:
    python -m pytest backend/tests/test_presence.py -v

Тесты самодостаточны: поднимают SQLite в памяти и не требуют PostgreSQL.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import events  # noqa: E402
import routers.ws as ws_router  # noqa: E402
from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
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
    app.dependency_overrides[get_db] = override_get_db
    events.manager.active.clear()

    try:
        yield TestClient(app)
    finally:
        events.manager.active.clear()
        app.dependency_overrides.clear()


class FakeSocket:
    async def accept(self):
        pass

    async def close(self):
        pass


def test_multiple_tabs_are_one_online_user():
    """0 → 1 сокет — вход, 1 → 0 — выход; вторая вкладка ничего не меняет."""

    async def scenario():
        manager = events.ConnectionManager()
        first = FakeSocket()
        second = FakeSocket()

        assert await manager.connect(first, 1) is True
        assert await manager.connect(second, 1) is False
        assert manager.is_online(1) is True

        assert manager.disconnect(1, first) is False
        assert manager.is_online(1) is True

        assert manager.disconnect(1, second) is True
        assert manager.is_online(1) is False

    asyncio.run(scenario())


def register_and_login(client: TestClient, prefix: str) -> dict:
    username = f"pres_{prefix}_{uuid.uuid4().hex[:6]}"
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


def assert_presence(event: dict, user_id: int, online: bool):
    assert event["type"] == "presence"
    assert event["user_id"] == user_id
    assert event["online"] is online
    # Время последней активности должно быть ISO-строкой, которую понимает
    # и Python, и браузер.
    assert datetime.fromisoformat(event["last_seen_at"]) is not None


def test_presence_event_and_snapshot(client):
    alice = register_and_login(client, "alice")
    bob = register_and_login(client, "bob")

    # Личный чат делает пользователей связанными
    chat_response = client.post(
        "/api/chats",
        json={"username": bob["username"].lstrip("@")},
        headers=auth(alice["access_token"]),
    )
    assert chat_response.status_code == 200, chat_response.text
    chat = chat_response.json()
    assert chat["peer_id"] == bob["user_id"]

    chats = client.get("/api/chats", headers=auth(bob["access_token"])).json()["chats"]
    assert any(item["peer_id"] == alice["user_id"] for item in chats)

    with client.websocket_connect(
        f"/ws/{bob['user_id']}?token={bob['access_token']}"
    ) as bob_socket:
        # Своё подключение тоже приходит событием
        assert_presence(bob_socket.receive_json(), bob["user_id"], True)

        with client.websocket_connect(
            f"/ws/{alice['user_id']}?token={alice['access_token']}"
        ):
            assert_presence(bob_socket.receive_json(), alice["user_id"], True)

            snapshot = client.get(
                "/api/presence", headers=auth(bob["access_token"])
            )
            assert snapshot.status_code == 200
            data = snapshot.json()
            assert set(data["online"]) == {alice["user_id"], bob["user_id"]}
            # Оба уже подключались, поэтому время последней активности известно
            assert set(data["last_seen"]) == {
                str(alice["user_id"]),
                str(bob["user_id"]),
            }

        # Сокет Алисы закрылся — Боб получает офлайн и время последней активности
        assert_presence(bob_socket.receive_json(), alice["user_id"], False)

        snapshot = client.get(
            "/api/presence", headers=auth(bob["access_token"])
        ).json()
        assert alice["user_id"] not in snapshot["online"]
        assert str(alice["user_id"]) in snapshot["last_seen"]


def test_typing_only_for_chat_members(client):
    alice = register_and_login(client, "type_a")
    bob = register_and_login(client, "type_b")
    stranger = register_and_login(client, "type_c")

    chat = client.post(
        "/api/chats",
        json={"username": bob["username"].lstrip("@")},
        headers=auth(alice["access_token"]),
    ).json()
    # Чат, в котором Алисы нет: её typing туда попасть не должен
    foreign_chat = client.post(
        "/api/chats",
        json={"username": stranger["username"].lstrip("@")},
        headers=auth(bob["access_token"]),
    ).json()

    with client.websocket_connect(
        f"/ws/{bob['user_id']}?token={bob['access_token']}"
    ) as bob_socket:
        bob_socket.receive_json()  # собственное online-событие

        with client.websocket_connect(
            f"/ws/{alice['user_id']}?token={alice['access_token']}"
        ) as alice_socket:
            assert bob_socket.receive_json()["user_id"] == alice["user_id"]

            # Сначала чужой чат — событие должно быть проигнорировано,
            # иначе следующим Боб получил бы typing с чужим chat_id.
            alice_socket.send_json({
                "type": "typing",
                "chat_id": foreign_chat["id"],
            })
            alice_socket.send_json({"type": "typing", "chat_id": chat["id"]})
            # Обычное сообщение заставляет TestClient отдать Бобу уже
            # поставленные в очередь события; порядок при этом сохраняется.
            alice_socket.send_json({"chat_id": chat["id"], "text": "привет"})

            event = bob_socket.receive_json()
            assert event == {
                "type": "typing",
                "chat_id": chat["id"],
                "user_id": alice["user_id"],
                "nickname": alice["nickname"],
            }


def test_presence_snapshot_uses_own_contacts(client):
    """Снимок показывает контакты, которые сохранил сам пользователь."""
    alice = register_and_login(client, "own_a")
    bob = register_and_login(client, "own_b")

    response = client.post(
        "/api/contacts",
        json={"username": bob["username"].lstrip("@")},
        headers=auth(alice["access_token"]),
    )
    assert response.status_code == 201, response.text

    with client.websocket_connect(
        f"/ws/{bob['user_id']}?token={bob['access_token']}"
    ) as bob_socket:
        bob_socket.receive_json()  # собственное online-событие

        alice_snapshot = client.get(
            "/api/presence", headers=auth(alice["access_token"])
        ).json()["online"]
        assert bob["user_id"] in alice_snapshot

        # Боб не сохранял Алису и общего чата нет — её статус ему не виден
        with client.websocket_connect(
            f"/ws/{alice['user_id']}?token={alice['access_token']}"
        ):
            bob_snapshot = client.get(
                "/api/presence", headers=auth(bob["access_token"])
            ).json()["online"]
            assert alice["user_id"] not in bob_snapshot


def test_presence_only_for_related_users(client):
    alice = register_and_login(client, "rel_a")
    bob = register_and_login(client, "rel_b")
    stranger = register_and_login(client, "rel_c")

    chat = client.post(
        "/api/chats",
        json={"username": bob["username"].lstrip("@")},
        headers=auth(alice["access_token"]),
    ).json()

    with client.websocket_connect(
        f"/ws/{bob['user_id']}?token={bob['access_token']}"
    ) as bob_socket:
        bob_socket.receive_json()  # собственное online-событие

        with client.websocket_connect(
            f"/ws/{alice['user_id']}?token={alice['access_token']}"
        ) as alice_socket:
            assert bob_socket.receive_json()["user_id"] == alice["user_id"]

            with client.websocket_connect(
                f"/ws/{stranger['user_id']}?token={stranger['access_token']}"
            ):
                # Чужой пользователь не появился в снимке
                snapshot = client.get(
                    "/api/presence", headers=auth(bob["access_token"])
                ).json()["online"]
                assert stranger["user_id"] not in snapshot
                assert set(snapshot) == {alice["user_id"], bob["user_id"]}

                # И не прислал событие: следующим Боб получает сообщение,
                # а не presence от постороннего.
                sent = client.post(
                    "/api/messages",
                    json={"chat_id": chat["id"], "text": "привет"},
                    headers=auth(alice["access_token"]),
                )
                assert sent.status_code == 200, sent.text
                event = bob_socket.receive_json()
                assert event["type"] == "message"
                assert event["text"] == "привет"
