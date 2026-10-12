# Messenger

Мессенджер на FastAPI, PostgreSQL, HTML, CSS, JavaScript.

## Запуск

```bash
# 1. Зависимости
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 2. PostgreSQL: роль и база (от пользователя postgres)
psql -d postgres -c "CREATE ROLE messenger_user LOGIN PASSWORD 'pass';"
psql -d postgres -c "CREATE DATABASE messenger_db OWNER messenger_user;"

# 3. Схема. init.sql — единственный источник правды, таблицы создаются только тут
psql "postgresql://messenger_user:pass@localhost:5432/messenger_db" -f init.sql

# 4. Сервер (раздаёт и API, и фронтенд с /)
cd backend && ../.venv/bin/uvicorn main:app --reload
```

Открыть http://localhost:8000.

### Переменные окружения

`SECRET_KEY`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` — все необязательны,
значения по умолчанию зашиты в `backend/database.py` и `backend/auth.py`.
Для `SECRET_KEY` в продакшене задайте свой, иначе токены можно подделать.

## «Избранное»

Виртуальная папка в стиле Telegram, а не отдельный чат:

- в `chats` и `chat_members` для неё нет ни одной строки;
- сообщения лежат с `chat_id = NULL` и `is_favorite = true`;
- клиент обращается к ней как к чату `-1`, бэкенд переводит это в `chat_id = NULL`;
- папка приватна — видны только сообщения, добавленные самим пользователем.

Обычное сообщение тоже можно перенести в избранное, поставив ему флаг
`POST /api/messages/{id}/favorite`. Флаг ставится только на свои сообщения.

## API

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/register` | регистрация по никнейму и паролю |
| POST | `/api/login` | вход по никнейму и паролю, возвращает JWT |
| GET | `/api/users` | список остальных пользователей |
| GET | `/api/chats` | чаты пользователя, «Избранное» первым |
| POST | `/api/chats` | создать/открыть личный чат по никнейму собеседника |
| GET | `/api/messages/{chat_id}` | история сообщений (`chat_id = -1` — избранное) |
| POST | `/api/messages` | отправить сообщение |
| POST | `/api/messages/{id}/favorite` | переключить избранное |
| WS | `/ws/{user_id}?token=...` | real-time, рассылает только участникам чата |

Всё, кроме `register` и `login`, требует заголовок `Authorization: Bearer <token>`.

## Аккаунт

Отдельного логина нет: никнейм одновременно логин и отображаемое имя.
В `users` колонка `username` удалена, `nickname` — `UNIQUE NOT NULL`.
При регистрации и входе никнейм обрезается от пробелов, регистр сохраняется,
то есть `Андрей` и `андрей` — это два разных аккаунта.

Лишние поля в теле запроса игнорируются: отправка
`{"username": "...", "nickname": "...", "password": "..."}` создаст аккаунт
с никнеймом из `nickname`.

## Личные чаты

Кнопка `＋` рядом с выходом спрашивает ник и создаёт чат с этим пользователем
(`POST /api/chats`). Если такой чат уже есть, возвращается он же — второй не создаётся.

В `chats` для этого есть колонка `pair_key` вида `"1:2"` — два id участников по возрастанию.
`UNIQUE` на ней не даёт базе завести два чата между одной парой людей, даже если
запросы придут одновременно. У групповых чатов `pair_key` равен `NULL`,
а несколько `NULL` в `UNIQUE` не конфликтуют.

Список чатов сортируется по времени последнего сообщения, чаты без сообщений — по дате создания.