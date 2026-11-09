-- Редактирование, пересылка и цитаты ответов.
--
-- «Избранное» больше не помечает чужие сообщения звёздочкой: это отдельная
-- папка с копиями (chat_id IS NULL, sender_id = владелец). Старые отметки
-- is_favorite просто удаляются вместе со столбцом — в чатах сообщения
-- остаются как обычные.

ALTER TABLE messages ADD COLUMN edited_at TIMESTAMP DEFAULT NULL;
ALTER TABLE messages ADD COLUMN forwarded_from_nickname VARCHAR(30) DEFAULT NULL;
ALTER TABLE messages ADD COLUMN reply_to_nickname VARCHAR(30) DEFAULT NULL;
ALTER TABLE messages ADD COLUMN reply_to_text TEXT DEFAULT NULL;

DROP INDEX IF EXISTS idx_messages_favorites;
ALTER TABLE messages DROP COLUMN IF EXISTS is_favorite;

-- Быстрый поиск последней заметки/пересланного сообщения в «Избранном».
CREATE INDEX idx_messages_favorites
    ON messages(sender_id, created_at DESC)
    WHERE chat_id IS NULL;
