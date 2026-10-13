#!/usr/bin/env bash
#
# Работа с базой: бэкапы, восстановление, пересоздание со схемой.
#
#   ./scripts/db.sh backup            сохранить текущую базу
#   ./scripts/db.sh list              показать бэкапы
#   ./scripts/db.sh restore [файл]    восстановить из бэкапа (по умолчанию последний)
#   ./scripts/db.sh reset             пересоздать базу со свежей схемой init.sql
#                                     и вернуть данные из последнего бэкапа
#
# Путь к утилитам postgres и реквизиты можно переопределить через переменные окружения.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"

DB_USER="${DB_USER:-messenger_user}"
DB_PASSWORD="${DB_PASSWORD:-pass}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-messenger_db}"
ADMIN_DB="${ADMIN_DB:-postgres}"

# postgresql@16 из brew ставит утилиты не в общий PATH
if ! command -v pg_dump >/dev/null 2>&1; then
    for candidate in /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
        if [ -d "$candidate" ]; then
            PATH="$candidate:$PATH"
            export PATH
            break
        fi
    done
fi

# Пароль не должен светиться в выводе и в списке процессов
export PGPASSWORD="$DB_PASSWORD"
APP_URL="postgresql://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Создавать и удалять базу должен суперпользователь, а у DB_USER таких прав нет.
# По умолчанию идём в admin_db через локальный сокет — на macOS там работает
# ident-аутентификация. Если не сработает, задай ADMIN_URL целиком:
#   ADMIN_URL=postgresql://postgres@localhost:5432/postgres ./scripts/db.sh reset
admin_psql() {
    if [ -n "${ADMIN_URL:-}" ]; then
        psql "$ADMIN_URL" "$@"
    else
        psql -d "$ADMIN_DB" "$@"
    fi
}

for tool in pg_dump psql; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Ошибка: не найден $tool. Поставь PostgreSQL: brew install postgresql@16" >&2
        exit 1
    fi
done

LAST_BACKUP=""

db_exists() {
    admin_psql -t -A -c \
        "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';" | grep -q 1
}

counts() {
    if db_exists && psql "$APP_URL" -c "SELECT 1 FROM users" >/dev/null 2>&1; then
        psql "$APP_URL" -t -A -c "
            SELECT 'users=' || (SELECT count(*) FROM users)
                || ' chats=' || (SELECT count(*) FROM chats)
                || ' messages=' || (SELECT count(*) FROM messages);"
    else
        echo "users=0 chats=0 messages=0"
    fi
}

cmd_backup() {
    if ! db_exists; then
        echo "Ошибка: базы $DB_NAME нет." >&2
        exit 1
    fi
    mkdir -p "$BACKUP_DIR"

    local base full data
    base="$BACKUP_DIR/${DB_NAME}-$(date +%Y%m%d-%H%M%S)"
    full="${base}.sql.gz"
    data="${base}-data.sql.gz"

    echo "Сохраняю $APP_URL"
    # Полный дамп: схема + данные. Им же база восстанавливается целиком.
    pg_dump "$APP_URL" | gzip > "$full"
    # Дамп только данных: накладывается поверх изменённой схемы из init.sql.
    pg_dump --data-only "$APP_URL" | gzip > "$data"

    LAST_BACKUP="$full"
    echo "Готово:"
    echo "  полный: $full"
    echo "  данные: $data"
    counts
}

cmd_list() {
    if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
        echo "Бэкапов пока нет."
        return 0
    fi
    ls -lt "$BACKUP_DIR"
}

latest_backup() {
    ls -1t "$BACKUP_DIR/${DB_NAME}-"*.sql.gz 2>/dev/null | grep -v -- '-data\.sql\.gz$' | head -1 || true
}

# Активные сессии мешают удалить базу, а сервер почти всегда запущен
terminate_connections() {
    admin_psql -q -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null
}

drop_and_create() {
    terminate_connections
    admin_psql -q -c "DROP DATABASE IF EXISTS ${DB_NAME};"
    admin_psql -q -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
}

# chats.last_message_id -> messages.id и messages.chat_id -> chats.id образуют
# цикл, из-за чего pg_dump --data-only не может залить данные сам.
# На время загрузки снимаем одну сторону цикла и возвращаем её после.
drop_cycle_constraint() {
    psql "$APP_URL" -q -c \
        "ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_last_message_id_fkey;" 2>/dev/null || true
}

restore_cycle_constraint() {
    psql "$APP_URL" -q -c \
        "ALTER TABLE public.chats ADD CONSTRAINT chats_last_message_id_fkey
         FOREIGN KEY (last_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;" \
        || { echo "Не удалось вернуть внешний ключ last_message_id." >&2; return 1; }

    # Значение пересчитываем: в дампе оно могло устареть, а триггер при загрузке
    # данных не сработал, потому что сработал бы уже после её восстановления
    psql "$APP_URL" -q -c "
        UPDATE public.chats SET last_message_id = sub.id
        FROM (
            SELECT DISTINCT ON (chat_id) chat_id, id
            FROM public.messages WHERE chat_id IS NOT NULL
            ORDER BY chat_id, created_at DESC, id DESC
        ) sub
        WHERE public.chats.id = sub.chat_id;"
}

cmd_restore() {
    local file="${1:-}"
    if [ -z "$file" ]; then
        file="$(latest_backup)"
        if [ -z "$file" ]; then
            echo "Ошибка: бэкапов нет, восстанавливать нечего." >&2
            exit 1
        fi
    fi
    if [ ! -f "$file" ]; then
        echo "Ошибка: файла $file не найдено." >&2
        exit 1
    fi

    echo "Восстанавливаю из $file, текущие данные будут потеряны"
    drop_and_create
    gunzip -c "$file" | psql "$APP_URL" -q -v ON_ERROR_STOP=1
    echo "Готово."
    counts
}

cmd_reset() {
    local backup=""
    if db_exists; then
        echo "До пересоздания:"
        counts
        cmd_backup
        backup="$LAST_BACKUP"
    else
        echo "Базы $DB_NAME нет — просто создам её заново."
    fi

    echo "Пересоздаю базу со схемой из init.sql"
    drop_and_create
    psql "$APP_URL" -q -v ON_ERROR_STOP=1 -f "$PROJECT_DIR/init.sql"

    if [ -z "$backup" ]; then
        counts
        return 0
    fi

    local data="${backup%.sql.gz}-data.sql.gz"
    if [ ! -f "$data" ]; then
        echo "Рядом с бэкапом нет файла с данными: $backup"
        counts
        return 0
    fi

    # -1 держит всю загрузку в одной транзакции: если колонки в новой схеме
    # не совпали, не останется базы наполовину заполненной
    drop_cycle_constraint
    local err_log
    err_log="$(mktemp)"
    # stdout от psql (setval и прочее) не нужен, ошибку сохраняем для разбора
    if gunzip -c "$data" | psql "$APP_URL" -q -1 -v ON_ERROR_STOP=1 >/dev/null 2>"$err_log"; then
        echo "Данные из бэкапа возвращены поверх новой схемы."
    else
        echo "Данные не подошли к новой схеме — база осталась пустой и целой."
        echo "Причина (первая строка ошибки):"
        grep -m1 -i 'error' "$err_log" | sed 's/^/  /' || true
        echo "Полный бэкап цел здесь: $backup"
    fi
    rm -f "$err_log"

    # Ограничение возвращаем в любом случае, иначе база осталась бы без него
    restore_cycle_constraint || true
    counts
}

case "${1:-}" in
    backup)  cmd_backup ;;
    list)    cmd_list ;;
    restore) shift; cmd_restore "${1:-}" ;;
    reset)   cmd_reset ;;
    *)
        sed -n '3,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac