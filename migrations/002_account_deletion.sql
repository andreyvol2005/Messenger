-- 002. Схема безвозвратного удаления аккаунта.
--
-- init.sql создаёт эти объекты для новых баз, но базы, заведённые до появления
-- функции удаления аккаунта, оставались без них: `users.deleted_at` и таблицы
-- `account_deletion_jobs` не было, а `password_hash` был NOT NULL. Из-за этого
-- после выката кода удаления логин падал с 500 (column users.deleted_at does
-- not exist), а фоновый воркер не мог забрать задачу.
--
-- Все операции идемпотентны: на свежей базе из init.sql они ничего не меняют.
-- Файл выполняется в одной транзакции из backend/migrate.py.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_reason TEXT DEFAULT NULL;

-- При удалении аккаунта хеш пароля стирается (становится NULL), чтобы вход
-- был невозможен даже при утечке старого токена.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Индекс только на активных пользователях: частые запросы фильтруют deleted_at IS NULL.
CREATE INDEX IF NOT EXISTS ix_users_active ON users(id) WHERE deleted_at IS NULL;
-- Индекс на удалённых: для аудита и регламентного удаления бэкапов.
CREATE INDEX IF NOT EXISTS ix_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Outbox фоновой очистки (S3, Redis, поисковый индекс, push).
CREATE TABLE IF NOT EXISTS account_deletion_jobs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending | done | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error TEXT DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Только необработанные джобы — воркеры берут их через FOR UPDATE SKIP LOCKED.
CREATE INDEX IF NOT EXISTS ix_account_deletion_jobs_pending
    ON account_deletion_jobs(user_id, status) WHERE status = 'pending';
