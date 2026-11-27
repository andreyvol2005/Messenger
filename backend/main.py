import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import media
import perf
from jobs import worker_loop
from routers import accounts, chats, contacts, messages, presence, ws

# Схема создаётся через init.sql — он же единственный источник правды

# Папки должны существовать до app.mount: StaticFiles не создаёт их сам
media.ensure_upload_dirs()

app = FastAPI(title="Messenger API")

# Заголовок Server-Timing и лог медленных запросов (см. perf.py)
app.add_middleware(perf.TimingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts.router)
app.include_router(chats.router)
app.include_router(contacts.router)
app.include_router(messages.router)
app.include_router(presence.router)
app.include_router(ws.router)

# Фоновый воркер очистки данных удалённых аккаунтов (S3, Redis, индекс, push).
# Рядом с ним — монитор задержек event loop.
_background_tasks: list[asyncio.Task] = []


@app.on_event("startup")
async def _startup():
    _background_tasks.append(asyncio.create_task(worker_loop()))
    _background_tasks.append(asyncio.create_task(perf.monitor_event_loop()))


@app.on_event("shutdown")
async def _shutdown():
    for task in _background_tasks:
        task.cancel()
    for task in _background_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
    _background_tasks.clear()


@app.get("/api/health")
async def health():
    # async: ответ не ждёт свободного потока, поэтому время ответа показывает
    # чистую отзывчивость event loop. loop_lag — насколько он опаздывает.
    return {
        "status": "ok",
        "message": "Server is running",
        "loop_lag_ms": perf.loop_lag,
    }


# Загруженные картинки. Монтируется до раздачи фронтенда с "/", иначе
# catch-all перехватил бы /uploads/* первым.
app.mount(
    "/uploads",
    StaticFiles(directory=media.UPLOADS_ROOT),
    name="uploads",
)


# ==========================================
# Раздача фронтенда (должно быть В КОНЦЕ!)
# ==========================================
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
