-- ====================================================
-- 1. Пользователи
-- ====================================================
CREATE TABLE users (
id SERIAL PRIMARY KEY,
username VARCHAR(20) UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
nickname VARCHAR(50) DEFAULT 'user',
bio VARCHAR(150) DEFAULT NULL,
birth_date DATE DEFAULT NULL,
avatar_url TEXT DEFAULT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================
-- 2. Чаты
-- ====================================================
CREATE TABLE chats (
id SERIAL PRIMARY KEY,
type VARCHAR(10) NOT NULL CHECK (type IN ('private', 'group')),
name VARCHAR(50) DEFAULT NULL,
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
CREATE TABLE messages (
id SERIAL PRIMARY KEY,
chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
text TEXT DEFAULT NULL,
media_url TEXT DEFAULT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
is_deleted BOOLEAN DEFAULT FALSE
);

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

CREATE OR REPLACE FUNCTION update_chat_last_message()
RETURNS TRIGGER AS $$
BEGIN
UPDATE chats SET last_message_id = NEW.id WHERE id = NEW.chat_id;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_last_message_trigger
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION update_chat_last_message();