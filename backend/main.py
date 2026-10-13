import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routers import accounts, chats, messages, ws

# Схема создаётся через init.sql — он же единственный источник правды

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
app.include_router(messages.router)
app.include_router(ws.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Server is running"}


# ==========================================
# Раздача фронтенда (должно быть В КОНЦЕ!)
# ==========================================
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")