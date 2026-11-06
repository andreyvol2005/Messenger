"""WebSocket не должен держать транзакцию, пока соединение открыто.

Иначе idle-in-transaction сессия держит AccessShareLock на таблицах и
блокирует миграции при деплое.
"""

from __future__ import annotations

import sys
import time
import uuid
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
    sessions = []

    def session_factory():
        db = testing_session()
        sessions.append(db)
        return db

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(ws_router, "SessionLocal", session_factory)
    app.dependency_overrides[get_db] = override_get_db
    events.manager.active.clear()

    try:
        yield TestClient(app), sessions
    finally:
        events.manager.active.clear()
        app.dependency_overrides.clear()


def register_and_login(http: TestClient, prefix: str) -> dict:
    username = f"tx_{prefix}_{uuid.uuid4().hex[:8]}"
    registered = http.post(
        "/api/register",
        json={"username": username, "password": "pw123456"},
    )
    assert registered.status_code == 200, registered.text

    logged_in = http.post(
        "/api/login",
        json={"username": username, "password": "pw123456"},
    )
    assert logged_in.status_code == 200, logged_in.text
    return logged_in.json()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_open_socket_leaves_no_active_transaction(client):
    http, sessions = client
    user = register_and_login(http, "idle")

    with http.websocket_connect(
        f"/ws/{user['user_id']}?token={user['access_token']}"
    ) as socket:
        # Собственное событие присутствия означает, что подключение прошло.
        assert socket.receive_json()["type"] == "presence"

        # Сессия сокета живёт, пока открыто соединение. Транзакций в ней быть
        # не должно: запросы к БД сделаны и отпустили блокировки.
        assert not [session for session in sessions if session.in_transaction()]


def wait_for_no_transactions(sessions, timeout: float = 2.0) -> None:
    """Даёт обработчику сокета время закрыть транзакцию после события."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not any(session.in_transaction() for session in sessions):
            return
        time.sleep(0.05)
    assert not [session for session in sessions if session.in_transaction()]


def test_typing_leaves_no_active_transaction(client):
    http, sessions = client
    alice = register_and_login(http, "alice")
    bob = register_and_login(http, "bob")

    chat_response = http.post(
        "/api/chats",
        headers=auth(alice["access_token"]),
        json={"username": bob["username"].lstrip("@")},
    )
    assert chat_response.status_code == 200, chat_response.text
    chat = chat_response.json()

    with http.websocket_connect(
        f"/ws/{alice['user_id']}?token={alice['access_token']}"
    ) as socket:
        assert socket.receive_json()["type"] == "presence"
        wait_for_no_transactions(sessions)

        # Событие уходит только Бобу, ответа Алисе нет — проверяем состояние
        # сессии после того, как обработчик его обработал.
        socket.send_json({"type": "typing", "chat_id": chat["id"]})
        wait_for_no_transactions(sessions)


def test_messages_still_work_after_transaction_release(client):
    """Избранное: сообщение идёт через тот же обработчик, но без второго сокета.

    Две тестовые WebSocket-сессии живут в разных потоках TestClient, поэтому
    проверять доставку между ними здесь не стоит — это особенность тестового
    клиента, а не сервера.
    """
    http, _ = client
    alice = register_and_login(http, "alice")

    with http.websocket_connect(
        f"/ws/{alice['user_id']}?token={alice['access_token']}"
    ) as socket:
        socket.receive_json()  # собственное присутствие

        # Два сообщения подряд: после первого сессия откатывается, и второе
        # должно по-прежнему отправляться.
        for text in ("первое", "второе"):
            socket.send_json({"chat_id": -1, "text": text})
            event = socket.receive_json()
            assert event["type"] == "message"
            assert event["text"] == text

    messages = http.get(
        "/api/messages/-1", headers=auth(alice["access_token"])
    ).json()
    assert [message["text"] for message in messages] == ["первое", "второе"]
