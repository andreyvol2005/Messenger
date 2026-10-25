"""Фоновый обработчик задач на физическое удаление данных аккаунта.

Работает как отдельный цикл в главном процессе (или отдельном потоке/процессе
при развёртывании). Поскольку в проекте нет Celery/Redis, реализовано
простое опросное получение джоб из таблицы account_deletion_jobs через
FOR UPDATE SKIP LOCKED — несколько воркеров могут работать параллельно.

Принцип: at-least-once + идемпотентность. Повторное удаление одного и того же
ресурса (файла в S3, ключа в Redis, документа в индексе) не является ошибкой.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from sqlalchemy import select
from database import SessionLocal, engine
import models

logger = logging.getLogger("jobs")

MAX_ATTEMPTS = 5
POLL_INTERVAL_SEC = 5

# ---------------------------------------------------------------------------
# Заглушки внешних систем. Заменить на реальные клиенты при подключении S3,
# Redis, поискового индекса, push-сервиса.
# ---------------------------------------------------------------------------

async def _delete_s3_media(user_id: int) -> None:
    """Удаляет медиафайлы пользователя из S3 / локального хранилища."""
    # await s3.delete_objects(Bucket=BUCKET, Prefix=f"users/{user_id}/")
    logger.info("S3: медиа пользователя %d помечены на удаление", user_id)


async def _clear_redis_cache(user_id: int) -> None:
    """Стирает ключи кэша пользователя из Redis."""
    # await redis.delete(*await redis.keys(f"user:{user_id}:*"))
    logger.info("Redis: кэш пользователя %d очищен", user_id)


async def _remove_from_search_index(user_id: int) -> None:
    """Удаляет документы пользователя из поискового индекса."""
    # await search_index.delete_documents(user_id=user_id)
    logger.info("Поисковый индекс: документы пользователя %d удалены", user_id)


async def _revoke_push_tokens(user_id: int) -> None:
    """Отзывает push-токены и устройства пользователя."""
    # await push_service.revoke_all_for_user(user_id)
    logger.info("Push: токены пользователя %d отозваны", user_id)


async def _revoke_sessions(user_id: int) -> None:
    """Отзывает все активные серверные сессии (если таблица sessions появится)."""
    logger.info("Сессии пользователя %d отозваны", user_id)


# Реестр шагов очистки — порядок важен: сначала отзываем доступ, потом данные.
_CLEANUP_STEPS: list[Callable[[int], asyncio.Future]] = [
    _revoke_sessions,
    _revoke_push_tokens,
    _delete_s3_media,
    _clear_redis_cache,
    _remove_from_search_index,
]


# ---------------------------------------------------------------------------
# Работа с джобами
# ---------------------------------------------------------------------------

async def claim_pending_job(db) -> models.AccountDeletionJob | None:
    """Забрать одну необработанную джобу (FOR UPDATE SKIP LOCKED)."""
    result = db.execute(
        select(models.AccountDeletionJob)
        .where(models.AccountDeletionJob.status == "pending")
        .order_by(models.AccountDeletionJob.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def process_job_once(db) -> bool:
    """Обработать одну джобу. Вернуть True, если работа была."""
    job = await claim_pending_job(db)
    if job is None:
        return False

    try:
        for step in _CLEANUP_STEPS:
            await step(job.user_id)

        job.status = "done"
        job.attempts += 1
        logger.info("Джоба удаления пользователя %d выполнена", job.user_id)
    except Exception as exc:  # noqa: BLE001
        job.attempts += 1
        job.last_error = str(exc)[:1000]
        if job.attempts >= MAX_ATTEMPTS:
            job.status = "failed"  # dead-letter — требует ручного разбора
            logger.error(
                "Джоба удаления пользователя %d перешла в failed после %d попыток: %s",
                job.user_id, job.attempts, job.last_error,
            )
        else:
            job.status = "pending"  # повторим при следующем проходе
            logger.warning(
                "Джоба удаления пользователя %d落ちла, попытка %d/%d: %s",
                job.user_id, job.attempts, MAX_ATTEMPTS, job.last_error,
            )

    db.add(job)
    db.commit()
    return True


async def process_jobs_once() -> bool:
    """Обработать не более одной джобы. Для использования в цикле воркера."""
    db = SessionLocal()
    try:
        return await process_job_once(db)
    finally:
        db.close()


async def worker_loop(stop_event: asyncio.Event | None = None) -> None:
    """Главный цикл воркера. Обрабатывает джобы, пока не будет установлен stop_event."""
    stop_event = stop_event or asyncio.Event()
    while not stop_event.is_set():
        try:
            worked = await process_jobs_once()
            if not worked:
                # Нет работы — спим, чтобы не нагружать БД пустыми запросами.
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SEC)
                except asyncio.TimeoutError:
                    pass
        except Exception:  # noqa: BLE001
            logger.exception("Ошибка в цикле воркера удаления")
            await asyncio.sleep(POLL_INTERVAL_SEC)
