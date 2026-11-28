-- Каналы. Это обычный чат с типом channel: сообщения и подписки хранятся
-- в существующих таблицах, а просмотры постов — в отдельной message_views.
-- Автор поста входит в число просмотревших: строка создаётся при публикации.

ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE chats ADD CONSTRAINT chats_type_check
    CHECK (type IN ('private', 'group', 'channel'));

-- Уникальность пары (message_id, user_id) не даёт накрутить счётчик
-- повторными открытиями канала.
CREATE TABLE IF NOT EXISTS message_views (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id)
);

-- Для очистки просмотров при удалении пользователя.
CREATE INDEX IF NOT EXISTS idx_message_views_user ON message_views(user_id);
