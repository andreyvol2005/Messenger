-- 001. Разделяем логин и отображаемое имя.
--
-- В старой схеме users.nickname был одновременно логином. Теперь логин
-- хранится в users.username с ведущим «@», а nickname — отдельное имя.
-- Старым пользователям оставляем привычный логин: nickname "user" станет
-- username "@user". Если nickname нельзя использовать как username, выдаём
-- запасной вариант "@user_<id>".
--
-- Файл выполняется в одной транзакции из backend/migrate.py.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(31);

DO $$
DECLARE
    u RECORD;
    candidate TEXT;
    suffix INTEGER;
BEGIN
    FOR u IN
        SELECT id, nickname
        FROM users
        WHERE username IS NULL
        ORDER BY id
    LOOP
        candidate := '@' || COALESCE(u.nickname, '');

        -- Тот же набор символов, что проверяет backend/validation.py:
        -- латиница, кириллица, цифры и подчёркивание, не длиннее 30 символов.
        IF u.nickname IS NULL
           OR char_length(u.nickname) < 1
           OR char_length(u.nickname) > 30
           OR u.nickname !~ '^[A-Za-z0-9_А-Яа-яЁё]+$'
        THEN
            candidate := '@user_' || u.id;
        END IF;

        -- На случай, если старый UNIQUE на nickname уже снят и имена совпали.
        suffix := 0;
        WHILE EXISTS (
            SELECT 1
            FROM users
            WHERE username = candidate
              AND id <> u.id
        ) LOOP
            suffix := suffix + 1;
            candidate := '@user_' || u.id || '_' || suffix;
        END LOOP;

        UPDATE users SET username = candidate WHERE id = u.id;
    END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;

-- Уникальность username. Проверяем и constraint, и одноимённый индекс:
-- на базе, где колонку добавляли вручную, имя уже может быть занято.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relname = 'users_username_key'
          AND relkind IN ('i', 'I')
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
    END IF;
END $$;

-- Ограничения, которые есть в init.sql для новых баз.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_username_prefix'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_prefix
            CHECK (username LIKE '@%');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_username_not_empty'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_not_empty
            CHECK (char_length(username) >= 2);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_nickname_not_empty'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_nickname_not_empty
            CHECK (char_length(nickname) >= 1);
    END IF;
END $$;

-- В новой модели nickname больше не логин и может повторяться.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_nickname_key;

-- Старое поле было VARCHAR(50), новое — VARCHAR(30). В текущих данных
-- значения короткие; left() нужен только на случай старых длинных ников,
-- чтобы миграция не остановила деплой.
UPDATE users SET nickname = left(nickname, 30)
WHERE char_length(nickname) > 30;

ALTER TABLE users ALTER COLUMN nickname TYPE VARCHAR(30);
