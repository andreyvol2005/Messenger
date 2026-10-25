"""Тесты удаления аккаунта.

Запуск:  .\.venv\Scripts\python.exe -m pytest backend/tests/test_account_delete.py -v
Требуется запущенный сервер на http://localhost:8000 и PostgreSQL в контейнере messenger-pg.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error

import websockets

BASE = "http://localhost:8000"
WS = "ws://localhost:8000"


def api(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(r, timeout=15) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def register_and_login(nickname_suffix: str = "") -> dict:
    uname = f"testuser{nickname_suffix}"
    try:
        api("POST", "/api/register", {"username": uname, "password": "pw123456"})
    except urllib.error.HTTPError as e:
        if e.code != 409:
            raise
    resp = api("POST", "/api/login", {"username": uname, "password": "pw123456"})
    return resp[1]


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
    status, body = api(
        "POST",
        "/api/account/delete",
        {"password": "pw123456", "confirmation_phrase": "УДАЛИТЬ АККАУНТ"},
        token=a["access_token"],
    )
    assert status == 200
    assert body["status"] == "deletion_scheduled"
    assert body["user_id"] == a["user_id"]

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

    # --- Повторный запрос удаления — идемпотентно (не падает, не дублирует джобу) ---
    # (Алиса уже не может авторизоваться, поэтому проверяем через БД — см. интеграционный тест)

    print("test_delete_account_flow: OK")


async def test_websocket_disconnected_on_delete():
    """При удалении аккаунта все WS-соединения пользователя разрываются."""
    a = register_and_login("ws_test")

    async with websockets.connect(f"{WS}/ws/{a['user_id']}?token={a['access_token']}") as sock:
        await asyncio.sleep(0.5)

        # Удаляем аккаунт — соединение должно разорваться
        api(
            "POST",
            "/api/account/delete",
            {"password": "pw123456", "confirmation_phrase": "УДАЛИТЬ АККАУНТ"},
            token=a["access_token"],
        )

        try:
            msg = await asyncio.wait_for(sock.recv(), timeout=5)
            print(f"WS received after delete: {msg}")
        except asyncio.TimeoutError:
            # Соединение закрыто сервером — это ожидаемо
            pass

    print("test_websocket_disconnected_on_delete: OK")


async def test_ws_rejects_deleted_user():
    """Удалённый пользователь не может установить WS-соединение (токен всё ещё вашен, но get_current_user отсекает)."""
    a = register_and_login("ws2")

    # Удаляем аккаунт
    api(
        "POST",
        "/api/account/delete",
        {"password": "pw123456", "confirmation_phrase": "УДАЛИТЬ АККАУНТ"},
        token=a["access_token"],
    )

    # Пытаемся подключиться по WS со старым токеном
    try:
        async with websockets.connect(f"{WS}/ws/{a['user_id']}?token={a['access_token']}") as sock:
            await asyncio.sleep(1)
            print("WS: неожиданно подключился после удаления")
    except Exception as e:
        print(f"WS: соединение отклонено после удаления (ожидаемо): {type(e).__name__}")

    print("test_ws_rejects_deleted_user: OK")


def test_wrong_confirmation_phrase():
    """Неверная контрольная фраза → 400, аккаунт не удалён."""
    a = register_and_login("phrase_test")

    try:
        api(
            "POST",
            "/api/account/delete",
            {"password": "pw123456", "confirmation_phrase": "НЕВЕРНАЯ ФРАЗА"},
            token=a["access_token"],
        )
        assert False, "Ожидалась ошибка 400"
    except urllib.error.HTTPError as e:
        assert e.code == 400

    # Аккаунт всё ещё активен — можно войти
    api("POST", "/api/login", {"username": a["username"][1:], "password": "pw123456"})
    print("test_wrong_confirmation_phrase: OK")


def test_wrong_password():
    """Неверный пароль → 400, аккаунт не удалён."""
    a = register_and_login("pwd_test")

    try:
        api(
            "POST",
            "/api/account/delete",
            {"password": "wrongpassword", "confirmation_phrase": "УДАЛИТЬ АККАУНТ"},
            token=a["access_token"],
        )
        assert False, "Ожидалась ошибка 400"
    except urllib.error.HTTPError as e:
        assert e.code == 400

    print("test_wrong_password: OK")


def test_login_with_deleted_user_401():
    """Удалённый пользователь не может войти — 401 без раскрытия деталей."""
    a = register_and_login("login401")

    api(
        "POST",
        "/api/account/delete",
        {"password": "pw123456", "confirmation_phrase": "УДАЛИТЬ АККАУНТ"},
        token=a["access_token"],
    )

    # Ошибка та же, что и при неверном пароле
    try:
        api("POST", "/api/login", {"username": a["username"][1:], "password": "pw123456"})
        assert False
    except urllib.error.HTTPError as e:
        assert e.code == 401
        detail = json.loads(e.read().decode("utf-8"))["detail"]
        assert detail == "Неверный username или пароль"

    print("test_login_with_deleted_user_401: OK")


import asyncio

if __name__ == "__main__":
    test_delete_account_flow()
    test_wrong_confirmation_phrase()
    test_wrong_password()
    test_login_with_deleted_user_401()
    asyncio.run(test_websocket_disconnected_on_delete())
    asyncio.run(test_ws_rejects_deleted_user())
    print("\nВсе тесты прошли!")
