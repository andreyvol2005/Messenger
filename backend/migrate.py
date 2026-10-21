"""Применяет SQL-миграции из каталога migrations/.

Каждый файл выполняется один раз, в отдельной транзакции. Учёт уже
применённых миграций лежит в таблице schema_migrations. Запуск:

    backend/venv/bin/python backend/migrate.py

Скрипт использует те же переменные окружения, что и backend/database.py.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "migrations"

# Произвольный постоянный ключ: два мигратора не должны работать одновременно.
LOCK_ID = 1297302354


def connect():
    return psycopg2.connect(
        dbname=os.getenv("DB_NAME", "messenger_db"),
        user=os.getenv("DB_USER", "messenger_user"),
        password=os.getenv("DB_PASSWORD", "pass"),
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
    )


def main() -> int:
    if not MIGRATIONS_DIR.is_dir():
        print(f"Каталог миграций не найден: {MIGRATIONS_DIR}", file=sys.stderr)
        return 1

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print("Миграций нет.")
        return 0

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                # Блокировка на время транзакции: параллельный деплой подождёт.
                cur.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_ID,))

                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        version TEXT PRIMARY KEY,
                        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )

                cur.execute("SELECT to_regclass('public.users')")
                if cur.fetchone()[0] is None:
                    print(
                        "В базе нет таблицы users. Для новой базы примените init.sql.",
                        file=sys.stderr,
                    )
                    return 1

                cur.execute("SELECT version FROM schema_migrations")
                applied = {row[0] for row in cur.fetchall()}
                pending = [path for path in files if path.name not in applied]

                if not pending:
                    print("Все миграции уже применены.")
                    return 0

                for path in pending:
                    print(f"Применяю {path.name}...")
                    cur.execute(path.read_text(encoding="utf-8"))
                    cur.execute(
                        "INSERT INTO schema_migrations (version) VALUES (%s)",
                        (path.name,),
                    )
                    print(f"Готово: {path.name}")

        print("Миграции применены.")
        return 0
    except psycopg2.Error as error:
        print(f"Ошибка миграции: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
