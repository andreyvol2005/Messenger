-- ====================================================
-- 0. Роль и база (выполнять от пользователя postgres)
-- ====================================================
-- CREATE ROLE messenger_user LOGIN PASSWORD 'pass';
-- CREATE DATABASE messenger_db OWNER messenger_user;

-- ====================================================
-- 1. Пользователи
-- ====================================================
-- username — уникальный логин, хранится с ведущим «@» (до 15 символов без него).
-- nickname — неуникальное отображаемое имя до 15 символов.
-- UNIQUE в PostgreSQL регистрозависимый, поэтому Ivan и ivan — разные аккаунты.
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(16) UNIQUE NOT NULL,
    nickname VARCHAR(15) NOT NULL,
    password_hash TEXT NOT NULL,
    bio VARCHAR(150) DEFAULT NULL,
    birth_date DATE DEFAULT NULL,
    avatar_url TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- На уровне базы дополнительно держим префикс и непустые значения.
    -- Набор символов проверяет backend/validation.py.
    CONSTRAINT users_username_prefix CHECK (username LIKE '@%'),
    CONSTRAINT users_username_not_empty CHECK (char_length(username) >= 2),
    CONSTRAINT users_nickname_not_empty CHECK (char_length(nickname) >= 1)
);

-- ====================================================
-- 2. Чаты
-- ====================================================
-- pair_key для личного чата хранит "min_id:max_id" его участников.
-- UNIQUE не даёт создать второй чат между той же парой людей.
-- У групповых чатов он NULL, а несколько NULL в UNIQUE не конфликтуют.
CREATE TABLE chats (
    id SERIAL PRIMARY KEY,
    type VARCHAR(10) NOT NULL CHECK (type IN ('private', 'group')),
    name VARCHAR(50) DEFAULT NULL,
    pair_key VARCHAR(32) UNIQUE DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================
-- 3. Участники чатов
-- ====================================================
CREATE TABLE chat_members (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (chat_id, user_id)
);

-- ====================================================
-- 4. Сообщения
-- ====================================================
-- chat_id NULL означает, что сообщение лежит в «Избранном»:
-- это виртуальная папка без строки в chats, а не отдельный чат.
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT DEFAULT NULL,
    media_url TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE
);

-- last_message_id ссылается на messages, поэтому добавляем после её создания
ALTER TABLE chats ADD COLUMN last_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;

-- ====================================================
-- 5. Контакты
-- ====================================================
CREATE TABLE contacts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, contact_user_id)
);

-- ====================================================
-- Индексы
-- ====================================================
CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);
CREATE INDEX idx_contacts_user ON contacts(user_id);
-- Частичный индекс: обычный idx_messages_chat_created избранное не покрывает
CREATE INDEX idx_messages_favorites ON messages(created_at DESC) WHERE is_favorite;

-- ====================================================
-- Триггер последнего сообщения
-- ====================================================
-- При chat_id IS NULL (сообщение в «Избранном») UPDATE не совпадёт ни с одной
-- строкой, поэтому папка в chats.last_message_id не попадёт.
--
-- search_path закреплён за функцией: pg_dump при загрузке данных выставляет пустой
-- search_path, и без этого UPDATE не смог бы найти таблицу chats.
CREATE OR REPLACE FUNCTION update_chat_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chats SET last_message_id = NEW.id WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

CREATE TRIGGER chat_last_message_trigger
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION update_chat_last_message();