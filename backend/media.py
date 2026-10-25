"""Хранение загруженных изображений на диске.

В базе лежит только относительный путь (`/uploads/images/<uuid>.<ext>`),
поэтому переезд на другой домен или CDN не требует правки сообщений.
"""
import os
import uuid

# backend/media.py -> корень проекта
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_ROOT = os.path.join(PROJECT_ROOT, "uploads")
IMAGES_DIR = os.path.join(UPLOADS_ROOT, "images")
IMAGES_URL_PREFIX = "/uploads/images"

MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 МБ

# content-type от клиента легко подделать, поэтому формат определяем по первым
# байтам файла, а имя генерируем сами: в filename могло прийти что угодно,
# вроде "../../app.py".
_SIGNATURES = (
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
    (b"BM", ".bmp"),
)


def ensure_images_dir() -> None:
    os.makedirs(IMAGES_DIR, exist_ok=True)


def detect_image_extension(head: bytes) -> str | None:
    """Возвращает расширение, если начало файла похоже на известный формат."""
    for signature, extension in _SIGNATURES:
        if head.startswith(signature):
            return extension
    # WEBP: контейнер RIFF, тип WEBP лежит на смещении 8
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    return None


def save_image(data: bytes, extension: str) -> str:
    """Пишет файл под случайным именем и возвращает URL для media_url."""
    ensure_images_dir()
    filename = f"{uuid.uuid4().hex}{extension}"
    with open(os.path.join(IMAGES_DIR, filename), "wb") as file:
        file.write(data)
    return f"{IMAGES_URL_PREFIX}/{filename}"


def delete_image(media_url: str) -> None:
    """Удаляет файл, если сообщение сохранить не удалось."""
    if not media_url.startswith(IMAGES_URL_PREFIX + "/"):
        return
    # basename отсекает любые попытки выйти за пределы папки
    path = os.path.join(IMAGES_DIR, os.path.basename(media_url))
    try:
        os.remove(path)
    except OSError:
        pass
