"""Диагностика скорости сервера.

Здесь две вещи:

* TimingMiddleware добавляет к каждому HTTP-ответу заголовок
  `Server-Timing: app;dur=<мс>`. В DevTools (вкладка Network → Timing) видно,
  сколько запрос провёл в приложении, а сколько — в сети и очереди. Медленные
  запросы пишутся в лог.
* monitor_event_loop раз в полсекунды проверяет, насколько event loop опоздал
  проснуться. Если кто-то держит loop синхронной работой, задержка вырастет,
  и это будет видно в логе и в /api/health.
"""

from __future__ import annotations

import asyncio
import logging
import time

logger = logging.getLogger("perf")

# Запросы дольше этого порога попадают в лог
SLOW_REQUEST_MS = 300
# Опоздание event loop больше этого порога попадает в лог
LOOP_LAG_WARN_MS = 100
LOOP_CHECK_INTERVAL_SEC = 0.5

# Последнее и максимальное с запуска опоздание loop — отдаются в /api/health
loop_lag = {"last_ms": 0.0, "max_ms": 0.0}


class TimingMiddleware:
    """Чистый ASGI-middleware: не буферизует ответ и не трогает WebSocket."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()

        async def send_with_timing(message):
            if message["type"] == "http.response.start":
                duration_ms = (time.perf_counter() - start) * 1000
                headers = list(message.get("headers", []))
                headers.append((b"server-timing", f"app;dur={duration_ms:.1f}".encode()))
                message = {**message, "headers": headers}
                if duration_ms > SLOW_REQUEST_MS:
                    logger.warning(
                        "Медленный запрос: %s %s — %.0f мс",
                        scope.get("method"),
                        scope.get("path"),
                        duration_ms,
                    )
            await send(message)

        await self.app(scope, receive, send_with_timing)


async def monitor_event_loop() -> None:
    """Следит, не блокирует ли кто-то event loop синхронной работой."""
    while True:
        expected = time.perf_counter() + LOOP_CHECK_INTERVAL_SEC
        await asyncio.sleep(LOOP_CHECK_INTERVAL_SEC)
        lag_ms = max(0.0, (time.perf_counter() - expected) * 1000)
        loop_lag["last_ms"] = round(lag_ms, 1)
        loop_lag["max_ms"] = max(loop_lag["max_ms"], round(lag_ms, 1))
        if lag_ms > LOOP_LAG_WARN_MS:
            logger.warning("Event loop заблокирован на %.0f мс", lag_ms)
