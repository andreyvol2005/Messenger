"""Тесты групповых чатов.

Запуск из корня репозитория:
    python -m pytest backend/tests/test_groups.py -v

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

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"group-avatar" * 10


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


def create_group(client: TestClient, user: dict, name: str, user_ids: list[int]):
    return client.post(
        "/api/chats/group",
        headers=auth(user["access_token"]),
        json={"name": name, "user_ids": user_ids},
    )


def find_chat(client: TestClient, user: dict, chat_id: int):
    response = client.get("/api/chats", headers=auth(user["access_token"]))
    assert response.status_code == 200, response.text
    return next(
        (chat for chat in response.json()["chats"] if chat["id"] == chat_id),
        None,
    )


def test_create_group_and_list_it_for_members(client):
    alice = register_and_login(client, "group_alice")
    bob = register_and_login(client, "group_bob")
    carol = register_and_login(client, "group_carol")

    response = create_group(
        client,
        alice,
        "Друзья",
        [bob["user_id"], carol["user_id"]],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "Друзья"
    assert body["chat_type"] == "group"
    assert body["members_count"] == 3
    assert body["avatar_url"] is None

    # Группа видна всем участникам, а не только создателю
    for user in (alice, bob, carol):
        chat = find_chat(client, user, body["id"])
        assert chat is not None
        assert chat["title"] == "Друзья"
        assert chat["chat_type"] == "group"
        assert chat["members_count"] == 3
        assert chat["avatar_url"] is None

    members = client.get(
        f"/api/chats/{body['id']}/members",
        headers=auth(bob["access_token"]),
    )
    assert members.status_code == 200, members.text
    member_rows = members.json()
    assert {row["id"] for row in member_rows} == {
        alice["user_id"],
        bob["user_id"],
        carol["user_id"],
    }
    assert all(row["username"].startswith("@") for row in member_rows)


def test_create_group_validates_name_and_members(client):
    alice = register_and_login(client, "group_invalid_alice")
    bob = register_and_login(client, "group_invalid_bob")

    no_members = create_group(client, alice, "Пустая", [])
    assert no_members.status_code == 400

    only_self = create_group(client, alice, "Один", [alice["user_id"]])
    assert only_self.status_code == 400

    unknown = create_group(client, alice, "Призрак", [bob["user_id"], 999999])
    assert unknown.status_code == 404

    blank = create_group(client, alice, "   ", [bob["user_id"]])
    assert blank.status_code == 400

    too_long = create_group(client, alice, "я" * 51, [bob["user_id"]])
    assert too_long.status_code == 400


def test_any_member_can_add_and_remove_members(client):
    alice = register_and_login(client, "group_add_alice")
    bob = register_and_login(client, "group_add_bob")
    carol = register_and_login(client, "group_add_carol")
    dave = register_and_login(client, "group_add_dave")

    created = create_group(client, alice, "Команда", [bob["user_id"]])
    assert created.status_code == 200, created.text
    chat_id = created.json()["id"]

    # Посторонний не видит состав и не может его менять
    forbidden = client.get(
        f"/api/chats/{chat_id}/members",
        headers=auth(carol["access_token"]),
    )
    assert forbidden.status_code == 403

    # Добавлять может любой участник, не только создатель
    added = client.post(
        f"/api/chats/{chat_id}/members",
        headers=auth(bob["access_token"]),
        json={"user_id": carol["user_id"]},
    )
    assert added.status_code == 200, added.text
    assert added.json()["id"] == carol["user_id"]

    duplicate = client.post(
        f"/api/chats/{chat_id}/members",
        headers=auth(alice["access_token"]),
        json={"user_id": carol["user_id"]},
    )
    assert duplicate.status_code == 409

    members = client.get(
        f"/api/chats/{chat_id}/members",
        headers=auth(carol["access_token"]),
    )
    assert members.status_code == 200
    assert len(members.json()) == 3

    # Удалить участника тоже может любой участник
    removed = client.delete(
        f"/api/chats/{chat_id}/members/{carol['user_id']}",
        headers=auth(bob["access_token"]),
    )
    assert removed.status_code == 204
    assert find_chat(client, carol, chat_id) is None
    assert find_chat(client, alice, chat_id)["members_count"] == 2

    # Повторное удаление — 404
    removed_again = client.delete(
        f"/api/chats/{chat_id}/members/{carol['user_id']}",
        headers=auth(alice["access_token"]),
    )
    assert removed_again.status_code == 404

    # Выйти из группы можно самостоятельно
    left = client.delete(
        f"/api/chats/{chat_id}/members/{bob['user_id']}",
        headers=auth(bob["access_token"]),
    )
    assert left.status_code == 204
    assert find_chat(client, bob, chat_id) is None
    assert find_chat(client, dave, chat_id) is None


def test_group_rename_and_access_rules(client):
    alice = register_and_login(client, "group_rename_alice")
    bob = register_and_login(client, "group_rename_bob")
    outsider = register_and_login(client, "group_rename_outsider")

    created = create_group(client, alice, "Старое имя", [bob["user_id"]])
    assert created.status_code == 200, created.text
    chat_id = created.json()["id"]

    renamed = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(bob["access_token"]),
        json={"name": "Новое имя"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "Новое имя"
    assert renamed.json()["members_count"] == 2
    assert find_chat(client, alice, chat_id)["title"] == "Новое имя"

    blank = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        json={"name": "  "},
    )
    assert blank.status_code == 400

    too_long = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        json={"name": "я" * 51},
    )
    assert too_long.status_code == 400

    nothing = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        json={},
    )
    assert nothing.status_code == 400

    forbidden = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(outsider["access_token"]),
        json={"name": "Чужая группа"},
    )
    assert forbidden.status_code == 403

    # Личный чат нельзя переименовать как группу
    private = client.post(
        "/api/chats",
        headers=auth(alice["access_token"]),
        json={"username": "group_rename_bob"},
    )
    assert private.status_code == 200, private.text
    private_patch = client.patch(
        f"/api/chats/{private.json()['id']}",
        headers=auth(alice["access_token"]),
        json={"name": "Не группа"},
    )
    assert private_patch.status_code == 400


def test_group_avatar_upload_and_replace(client, tmp_path):
    alice = register_and_login(client, "group_avatar_alice")
    bob = register_and_login(client, "group_avatar_bob")

    created = create_group(client, alice, "С аватаром", [bob["user_id"]])
    chat_id = created.json()["id"]

    uploaded = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(bob["access_token"]),
        files={"file": ("group.png", PNG_BYTES, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    first_url = uploaded.json()["avatar_url"]
    assert first_url.startswith("/uploads/group_avatars/")
    assert first_url.endswith(".png")

    first_path = tmp_path / "group_avatars" / first_url.rsplit("/", 1)[-1]
    assert first_path.is_file()
    assert find_chat(client, alice, chat_id)["avatar_url"] == first_url

    # Новый файл заменяет старый, старый удаляется после коммита
    replaced = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        files={"file": ("new.png", PNG_BYTES + b"new", "image/png")},
    )
    assert replaced.status_code == 200, replaced.text
    second_url = replaced.json()["avatar_url"]
    assert second_url != first_url
    assert not first_path.exists()
    assert (tmp_path / "group_avatars" / second_url.rsplit("/", 1)[-1]).is_file()

    # Название и файл можно передать одним запросом
    both = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        data={"name": "Обновлённая"},
        files={"file": ("third.png", PNG_BYTES + b"third", "image/png")},
    )
    assert both.status_code == 200, both.text
    assert both.json()["title"] == "Обновлённая"
    assert both.json()["avatar_url"].startswith("/uploads/group_avatars/")

    # Не картинка и слишком большой файл отклоняются, аватар не меняется
    previous_url = both.json()["avatar_url"]
    not_image = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert not_image.status_code == 400

    spoofed = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        files={"file": ("fake.png", b"not an image", "image/png")},
    )
    assert spoofed.status_code == 400

    too_big = client.patch(
        f"/api/chats/{chat_id}",
        headers=auth(alice["access_token"]),
        files={
            "file": (
                "big.png",
                b"\x89PNG\r\n\x1a\n" + b"x" * (media.MAX_GROUP_AVATAR_SIZE + 1),
                "image/png",
            )
        },
    )
    assert too_big.status_code == 413
    assert find_chat(client, alice, chat_id)["avatar_url"] == previous_url


def test_group_changes_are_published_over_websocket(client):
    alice = register_and_login(client, "group_ws_alice")
    bob = register_and_login(client, "group_ws_bob")
    carol = register_and_login(client, "group_ws_carol")

    url = f"/ws/{alice['user_id']}?token={alice['access_token']}"
    with client.websocket_connect(url) as socket:
        presence = socket.receive_json()
        assert presence["type"] == "presence"

        created = create_group(client, alice, "Онлайн", [bob["user_id"]])
        assert created.status_code == 200, created.text
        chat_id = created.json()["id"]

        event = socket.receive_json()
        assert event == {"type": "chat_updated", "chat_id": chat_id}

        renamed = client.patch(
            f"/api/chats/{chat_id}",
            headers=auth(alice["access_token"]),
            json={"name": "Переименована"},
        )
        assert renamed.status_code == 200, renamed.text
        assert socket.receive_json()["type"] == "chat_updated"

        added = client.post(
            f"/api/chats/{chat_id}/members",
            headers=auth(alice["access_token"]),
            json={"user_id": carol["user_id"]},
        )
        assert added.status_code == 200, added.text
        assert socket.receive_json()["type"] == "chat_updated"

        removed = client.delete(
            f"/api/chats/{chat_id}/members/{carol['user_id']}",
            headers=auth(alice["access_token"]),
        )
        assert removed.status_code == 204
        assert socket.receive_json()["type"] == "chat_updated"


def test_group_messages_are_visible_to_members_only(client):
    alice = register_and_login(client, "group_msg_alice")
    bob = register_and_login(client, "group_msg_bob")
    outsider = register_and_login(client, "group_msg_outsider")

    created = create_group(client, alice, "Переписка", [bob["user_id"]])
    assert created.status_code == 200, created.text
    chat_id = created.json()["id"]

    sent = client.post(
        "/api/messages",
        headers=auth(alice["access_token"]),
        json={"chat_id": chat_id, "text": "Всем привет"},
    )
    assert sent.status_code == 200, sent.text

    history = client.get(
        f"/api/messages/{chat_id}",
        headers=auth(bob["access_token"]),
    )
    assert history.status_code == 200, history.text
    assert [message["text"] for message in history.json()] == ["Всем привет"]

    # Посторонний не может ни читать, ни писать в группу
    denied_read = client.get(
        f"/api/messages/{chat_id}",
        headers=auth(outsider["access_token"]),
    )
    assert denied_read.status_code == 403
    denied_write = client.post(
        "/api/messages",
        headers=auth(outsider["access_token"]),
        json={"chat_id": chat_id, "text": "Чужое сообщение"},
    )
    assert denied_write.status_code == 403

    # Удалённый участник теряет доступ к переписке
    removed = client.delete(
        f"/api/chats/{chat_id}/members/{bob['user_id']}",
        headers=auth(alice["access_token"]),
    )
    assert removed.status_code == 204
    after_removal = client.get(
        f"/api/messages/{chat_id}",
        headers=auth(bob["access_token"]),
    )
    assert after_removal.status_code == 403


def test_private_chat_still_works_after_group_changes(client):
    alice = register_and_login(client, "group_private_alice")
    bob = register_and_login(client, "group_private_bob")

    created = client.post(
        "/api/chats",
        headers=auth(alice["access_token"]),
        json={"username": "group_private_bob"},
    )
    assert created.status_code == 200, created.text
    chat_id = created.json()["id"]

    chat = find_chat(client, bob, chat_id)
    assert chat["chat_type"] == "private"
    assert chat["members_count"] is None
    assert chat["avatar_url"] is None
    assert chat["peer_username"] == "@group_private_alice"

    sent = client.post(
        "/api/messages",
        headers=auth(alice["access_token"]),
        json={"chat_id": chat_id, "text": "Привет"},
    )
    assert sent.status_code == 200, sent.text

    messages = client.get(
        f"/api/messages/{chat_id}",
        headers=auth(bob["access_token"]),
    )
    assert messages.status_code == 200, messages.text
    assert [message["text"] for message in messages.json()] == ["Привет"]

    # Групповые ручки не должны ломать личный чат
    members = client.get(
        f"/api/chats/{chat_id}/members",
        headers=auth(alice["access_token"]),
    )
    assert members.status_code == 400
