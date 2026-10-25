import os
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import accounts, chats, contacts, messages, ws
from jobs import worker_loop
import media

# Схема создаётся через init.sql — он же единственный источник правды

# Папка должна существовать до app.mount: StaticFiles не создаёт её сам
media.ensure_images_dir()

app = FastAPI(title="Messenger API")

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
app.include_router(ws.router)

# Фоновый воркер очистки данных удалённых аккаунтов (S3, Redis, индекс, push).
_worker_task: asyncio.Task | None = None


@app.on_event("startup")
async def _startup():
    global _worker_task
    _worker_task = asyncio.create_task(worker_loop())


@app.on_event("shutdown")
async def _shutdown():
    global _worker_task
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass


@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Server is running"}


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