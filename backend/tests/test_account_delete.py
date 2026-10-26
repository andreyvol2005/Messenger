"""Тесты удаления аккаунта.

Запуск:  .\.venv\Scripts\python.exe backend/tests/test_account_delete.py -v
Требуется запущенный сервер на http://localhost:8000 и PostgreSQL в контейнере messenger-pg.

Другой адрес сервера задаётся переменной окружения:
    $env:MESSENGER_TEST_BASE="http://localhost:8001"
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
import uuid

import websockets
from websockets.exceptions import ConnectionClosed

BASE = (os.getenv("MESSENGER_TEST_BASE") or "http://localhost:8000").rstrip("/")
WS = BASE.replace("https://", "wss://").replace("http://", "ws://")

CONFIRM = "УДАЛИТЬ АККАУНТ"


def api(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r, timeout=15) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def register_and_login(nickname_suffix: str = "") -> dict:
    # Уникальный хвост: тесты можно запускать повторно, в том числе после
    # успешного удаления аккаунта (войти под ним уже не получится).
    uname = f"test{nickname_suffix}_{uuid.uuid4().hex[:8]}"
    api("POST", "/api/register", {"username": uname, "password": "pw123456"})
    resp = api("POST", "/api/login", {"username": uname, "password": "pw123456"})
    return resp[1]


def delete_account(token: str, password: str = "pw123456", phrase: str = CONFIRM):
    return api(
        "POST",
        "/api/account/delete",
        {"password": password, "confirmation_phrase": phrase},
        token=token,
    )


def test_delete_account_flow():
    """Полный сценарий: регистрация → удаление → вход невозможен → данные в группе сохраняются."""
    # --- Регистрируем двух пользователей ---
    a = register_and_login("a")
    b = register_and_login("b")

    # --- Создаём личный чат и шлём сообщения ---
    chat = api("POST", "/api/chats", {"username": b["username"][1:]}, token=a["access_token"])[1]
    assert chat["id"] > 0

    api("POST", "/api/messages", {"chat_id": chat["id"], "text": "Привет, Боб!"}, token=a["access_token"])
    api("POST", "/api/messages", {"chat_id": chat["id"], "text": "Привет, Алиса!"}, token=b["access_token"])

    # --- Удаляем аккаунт Алисы ---
    status, body = delete_account(a["access_token"])
    assert status == 200
    assert body["status"] == "deletion_scheduled"
    assert body["user_id"] == a["user_id"]

    # --- Старый токен больше не работает ---
    try:
        api("GET", "/api/me", token=a["access_token"])
        assert False, "Ожидалась ошибка 401"
    except urllib.error.HTTPError as e:
        assert e.code == 401

    # --- Вход невозможен (такая же ошибка, как при неверном пароле) ---
    try:
        api("POST", "/api/login", {"username": a["username"][1:], "password": "pw123456"})
        assert False, "Ожидалась ошибка 401"
    except urllib.error.HTTPError as e:
        assert e.code == 401

    # --- Аккаунт не виден в списке пользователей ---
    users = api("GET", "/api/users", token=b["access_token"])[1]
    usernames = [u["username"] for u in users]
    assert a["username"] not in usernames

    # --- Боб по-прежнему видит чат, сообщения Алисы отображаются как «Удалённый пользователь» ---
    chats_list = api("GET", "/api/chats", token=b["access_token"])[1]["chats"]
    bob_chat = next(c for c in chats_list if c["id"] == chat["id"])
    assert bob_chat["title"] == "Удалённый пользователь"

    messages = api("GET", f"/api/messages/{chat['id']}", token=b["access_token"])[1]
    # Первое сообщение от Алисы — отправитель отображается как удалённый
    alice_msgs = [m for m in messages if m["sender_id"] == a["user_id"]]
    assert len(alice_msgs) == 1
    assert alice_msgs[0]["sender_nickname"] == "Удалённый пользователь"
    assert alice_msgs[0]["text"] == "Привет, Боб!"

    print("test_delete_account_flow: OK")


async def test_websocket_disconnected_on_delete():
    """При удалении аккаунта все WS-соединения пользователя разрываются."""
    a = register_and_login("ws")

    async with websockets.connect(f"{WS}/ws/{a['user_id']}?token={a['access_token']}") as sock:
        await asyncio.sleep(0.5)

        # Удаляем аккаунт — соединение должно закрыться, а не остаться висеть
        delete_account(a["access_token"])

        try:
            msg = await asyncio.wait_for(sock.recv(), timeout=5)
            raise AssertionError(f"WS не закрыт после удаления, получено: {msg}")
        except asyncio.TimeoutError:
            raise AssertionError("WS не закрыт после удаления (таймаут)")
        except ConnectionClosed:
            pass

    print("test_websocket_disconnected_on_delete: OK")


async def test_ws_rejects_deleted_user():
    """Удалённый пользователь не может установить WS-соединение по старому токену."""
    a = register_and_login("ws2")

    delete_account(a["access_token"])

    # Соединение должно быть либо отклонено при handshake, либо сразу закрыто.
    # Открытый сокет (в том числе молчащий) — ошибка.
    connected = False
    try:
        async with websockets.connect(f"{WS}/ws/{a['user_id']}?token={a['access_token']}") as sock:
            connected = True
            try:
                msg = await asyncio.wait_for(sock.recv(), timeout=2)
            except ConnectionClosed:
                connected = False
            else:
                raise AssertionError(f"Удалённый пользователь получил сообщение по WS: {msg}")
    except AssertionError:
        raise
    except Exception:
        # Handshake отклонён (403) — ожидаемо
        pass

    assert not connected, "WS-соединение для удалённого пользователя осталось открытым"
    print("test_ws_rejects_deleted_user: OK")


def test_wrong_confirmation_phrase():
    """Неверная контрольная фраза → 400, аккаунт не удалён."""
    a = register_and_login("phrase")

    try:
        delete_account(a["access_token"], phrase="НЕВЕРНАЯ ФРАЗА")
        assert False, "Ожидалась ошибка 400"
    except urllib.error.HTTPError as e:
        assert e.code == 400

    # Аккаунт всё ещё активен — можно войти
    api("POST", "/api/login", {"username": a["username"][1:], "password": "pw123456"})
    print("test_wrong_confirmation_phrase: OK")


def test_wrong_password():
    """Неверный пароль → 400, аккаунт не удалён."""
    a = register_and_login("pwd")

    try:
        delete_account(a["access_token"], password="wrongpassword")
        assert False, "Ожидалась ошибка 400"
    except urllib.error.HTTPError as e:
        assert e.code == 400

    # Аккаунт всё ещё активен — можно войти
    api("POST", "/api/login", {"username": a["username"][1:], "password": "pw123456"})
    print("test_wrong_password: OK")


def test_login_with_deleted_user_401():
    """Удалённый пользователь не может войти — 401 без раскрытия деталей."""
    a = register_and_login("login")

    delete_account(a["access_token"])

    # Ошибка та же, что и при неверном пароле
    try:
        api("POST", "/api/login", {"username": a["username"][1:], "password": "pw123456"})
        assert False
    except urllib.error.HTTPError as e:
        assert e.code == 401
        detail = json.loads(e.read().decode("utf-8"))["detail"]
        assert detail == "Неверный username или пароль"

    print("test_login_with_deleted_user_401: OK")


if __name__ == "__main__":
    test_delete_account_flow()
    test_wrong_confirmation_phrase()
    test_wrong_password()
    test_login_with_deleted_user_401()
    asyncio.run(test_websocket_disconnected_on_delete())
    asyncio.run(test_ws_rejects_deleted_user())
    print("\nВсе тесты прошли!")
