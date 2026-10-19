# Messenger

Мессенджер на FastAPI, PostgreSQL, HTML, CSS, JavaScript.

## Запуск

### Windows (PowerShell)

Нужны Python 3.10+ и Docker Desktop. PostgreSQL ставится в Docker, ставить
его отдельно не нужно.

```powershell
# 1. Разово: окружение, зависимости, PostgreSQL в контейнере, схема из init.sql
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

# 2. Запуск: поднимает базу и стартует сервер
powershell -ExecutionPolicy Bypass -File scripts\run.ps1
```

Открыть http://localhost:8000.

Скрипты идемпотентны — `setup.ps1` можно запускать повторно, он доделает
только недостающее и ничего не сломает. Схему он применяет только если в
базе ещё нет таблиц, так что данные не пропадут.

Другой порт: `scripts\run.ps1 -Port 8080`.

Если Docker Desktop не запущен, `run.ps1` скажет об этом и остановится.

### macOS / Linux

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

### PostgreSQL в Docker (любая ОС)

Если PostgreSQL ставить не хочется, базу можно поднять в контейнере.
Реквизиты ниже совпадают с умолчаниями в `backend/database.py`:

```bash
docker run -d --name messenger-pg \
  -e POSTGRES_USER=messenger_user \
  -e POSTGRES_PASSWORD=pass \
  -e POSTGRES_DB=messenger_db \
  -p 5432:5432 \
  postgres:16

# схема из init.sql
docker exec -i messenger-pg psql -U messenger_user -d messenger_db -v ON_ERROR_STOP=1 < init.sql
```

Контейнер останавливается вместе с Docker, данные лежат в нём же:
`docker stop messenger-pg` / `docker start messenger-pg`.

### Доступ с других устройств

По умолчанию uvicorn слушает только localhost, поэтому с телефона сайт не откроется.
Нужен `--host 0.0.0.0`:

```bash
cd backend && ../.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

`scripts\run.ps1` уже стартует с `--host 0.0.0.0`, так что с телефоном
в той же сети сайт откроется сразу.

Дальше открыть на любом устройстве в той же сети `http://<ip-мака>:8000`.
Свой IP можно узнать командой:

```bash
ipconfig getifaddr en0    # macOS, Wi-Fi
```

```powershell
ipconfig | Select-String "IPv4"    # Windows
```

IP меняется при переподключении к сети, поэтому адрес придётся уточнять.
Файрвол macOS может спросить разрешение на входящие соединения — нужно ответить «Разрешить».
В Windows firewall обычно пропускает Python при первом запуске; если страница
не открывается, разреши входящие соединения для `python.exe` в настройках
«Брандмауэр и защита сети → Параметры входящего подключения».
PostgreSQL при этом продолжает слушать только localhost: браузер ходит напрямую
в FastAPI, к базе он не подключается.

Сессия лежит в `localStorage` и привязана к адресу, поэтому на телефоне
и на ноутбуке это будут два независимых аккаунта — входи под разными никами.

## Структура

```
backend/
  main.py          сборка приложения: CORS, подключение роутеров, раздача фронта
  constants.py     FAVORITES_CHAT_ID и прочие константы
  services.py      бизнес-логика: чаты и сообщения
  events.py        рассылка событий по WebSocket
  auth.py          bcrypt, JWT, get_current_user
  database.py      подключение, SessionLocal, get_db
  models.py        ORM-модели
  schemas.py       схемы Pydantic
  routers/
    accounts.py    регистрация, вход, список пользователей
    chats.py       GET/POST /api/chats
    messages.py    сообщения и избранное
    ws.py          WebSocket: приём сообщений и переподключение

frontend/
  index.html       точка входа: уводит на нужную версию
  login.html       экран входа, общий для обеих версий
  shared/
    common.js      CONFIG, работа с API, сессия, Realtime, LoginPage
    base.css       базовые стили: кнопки, инпуты, экран входа
  desktop/         две панели рядом: список чатов и переписка
  mobile/          список чатов и переписка на отдельных полноэкранных страницах

scripts/
  setup.ps1        разовая настройка на Windows: .venv, зависимости, база, схема
  run.ps1          запуск на Windows: поднять базу и стартовать сервер
  db.ps1           бэкапы и пересоздание базы на Windows
  db.sh            то же самое для macOS / Linux
```

Роутеры только разбирают HTTP и вызывают `services.py`, вся работа с БД — там.
Роут, который тоже лезет в базу, — повод перенести логику в `services`.

## Мобильная версия

Версия выбирается по ширине окна, порог — 768px (`CONFIG.MOBILE_MAX_WIDTH`),
проверка через `matchMedia` в `Session.isMobile()`.

Мобильная версия состоит из отдельных страниц, поэтому работает кнопка «назад»
в браузере:

- `mobile/chats.html` — список чатов на весь экран;
- `mobile/chat.html?id=N` — переписка на весь экран, `-1` — избранное.

Заголовок чата берётся из `GET /api/chats` по этому `id`, а не передаётся в ссылке,
поэтому кириллица в нике не ломает URL. Если чата с таким `id` нет
(например, ссылка сохранена, а чат удалён), страница возвращает к списку.

Вёрстка рассчитана на телефон: `100dvh` вместо `100vh`, чтобы адресная строка
мобильного браузера не срезала низ, `env(safe-area-inset-*)` под вырез и
«домашнюю полоску» iPhone, у полей ввода `font-size: 16px`, иначе iOS зумит
страницу при фокусе.

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
Внутри самого «Избранного» звезда не рисуется: там всё уже в избранном.

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
## Бэкапы и пересоздание базы

Меняешь `init.sql`, а потом хочется применить новую схему, не потеряв людей и переписку.
Для этого есть `scripts/db.sh` — он сам сначала делает бэкап, потом пересоздаёт базу
и возвращает данные поверх свежей схемы.

```bash
./scripts/db.sh backup            # сохранить текущую базу
./scripts/db.sh list              # посмотреть бэкапы
./scripts/db.sh restore           # вернуть последний бэкап целиком (со схемой)
./scripts/db.sh reset             # бэкап → пересоздать по init.sql → вернуть данные
```

На Windows то же самое делает `scripts/db.ps1`. Он ходит в базу через контейнер,
поэтому `psql` на самой машине не нужен:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\db.ps1 backup
powershell -ExecutionPolicy Bypass -File scripts\db.ps1 list
powershell -ExecutionPolicy Bypass -File scripts\db.ps1 restore
powershell -ExecutionPolicy Bypass -File scripts\db.ps1 reset
```

`reset` — это то, что нужно при смене схемы. Бэкапы лежат в `backups/` (папка в `.gitignore`),
каждый сохраняется в двух видах: полный (схема + данные) и только данные.

Если схема изменилась несовместимо — колонки переименованы или удалены, — данные не лягут.
Тогда база останется пустой и целой, а бэкап целым; причина будет написана в вывод.
В этом случае возвращай полный бэкап (`restore`), он восстановит старую схему вместе с данными.

Создавать и удалять базу может не `messenger_user`, а суперпользователь. Скрипт ходит в `postgres`
через локальный сокет; если это не сработает, задай `ADMIN_URL`:

```bash
ADMIN_URL=postgresql://postgres@localhost:5432/postgres ./scripts/db.sh reset
```

В контейнере `POSTGRES_USER` — суперпользователь, поэтому `db.ps1` ходит в `postgres`
под `messenger_user` и отдельный `ADMIN_URL` ему не нужен.

### Про циклический внешний ключ

`chats.last_message_id` ссылается на `messages`, а `messages.chat_id` — на `chats`.
Из-за этого `pg_dump --data-only` не может залить данные сам, и скрипт на время загрузки
снимает одну сторону цикла, а потом возвращает ограничение и пересчитывает `last_message_id`.

По этой же причине у функции триггера `update_chat_last_message` закреплён
`SET search_path = public, pg_temp`: дамп выставляет пустой `search_path`,
и без этого UPDATE не нашёл бы таблицу `chats`.

## Сообщения в реальном времени

Опрос базы не используется. Сервер держит WebSocket-соединения и сам рассылает новое
сообщение всем участникам чата — `GET /api/chats` клиенту дёргать не приходится.

Отправка при этом идёт обычным `POST /api/messages`: так сообщение попадёт в базу,
даже если сокет по какой-то причине не подключён. Событие о нём уходит после сохранения,
из `routers/messages.py`.

Как это устроено на клиенте (`shared/common.js`):

- `Realtime.connect(handler)` открывает `ws://<хост>/ws/<user_id>?token=...`;
- при обрыве соединение поднимается заново с паузой от 1 до 15 секунд, после разлогина — нет;
- своё сообщение не дублируется: `Realtime.markSeen` вызывается в `API.sendMessage`
  по id из ответа, и событие с тем же id отбрасывается;
- список чатов перерисовывается не на каждое событие, а пачкой через `UI.debounce`.

Ограничение: соединения живут в памяти процесса, поэтому запускать uvicorn нужно
в одном воркере (`--workers 1`). С несколькими воркерами клиент, подключённый к одному,
не получит события, отправленные в другой.

## Публикация на GitHub

Репозиторий уже привязан к `https://github.com/andreyvol2005/Messenger.git`,
ветка — `main`.

### Разовая настройка

```bash
# кто автор коммитов (без этого git commit не сработает)
git config user.name "andrikck"
git config user.email "andrejvolodin35@gmail.com"
```

Авторизация: HTTPS отдаёт на GitHub Credential Manager, при первом пуше
откроется браузер, где нужно подтвердить вход. Токен создаётся сам:
GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens, доступ к репозиторию `Messenger`.

Если Git Credential Manager не настроен, альтернатива — SSH:

```bash
ssh-keygen -t ed25519 -C "andrejvolodin35@gmail.com"
cat ~/.ssh/id_ed25519.pub   # вставить в GitHub → Settings → SSH keys
git remote set-url origin git@github.com:andreyvol2005/Messenger.git
```

### Обычный цикл

```bash
git status                    # что изменилось
git add .                     # добавить все изменения в индекс
git commit -m "описание изменения"
git push origin main          # отправить на GitHub
```

Частые мелочи:

```bash
git diff                      # посмотреть правки до коммита
git commit -am "..."          # закоммитить всё, что уже отслеживается
git log --oneline -10         # история коммитов
git pull origin main          # забрать чужие изменения перед пушем
```

Если `git push` ругается на `non-fast-forward`, сначала `git pull --rebase origin main`,
потом `git push origin main`.

### Что не попадёт в репозиторий

`.gitignore` закрывает `.venv`, `__pycache__`, `backups/` и `.env`.
Файлы с данными и секретами в репозиторий не попадут, но проверь
`git status` перед `git add .` — лишнее лучше увидеть заранее.

### Через GitHub CLI (необязательно)

`gh` не установлен, но если понадобится:

```powershell
winget install --id GitHub.cli
gh auth login
gh repo view --web
```

`gh auth login` умеет и сам настроить `git` — тогда пуши пойдут без
браузера на каждый запрос.
