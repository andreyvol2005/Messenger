-- Владелец группы. Удалять других участников может только он, а выйти из
-- группы сам может любой. При удалении аккаунта владельца поле обнуляется,
-- и приложение передаёт группу следующему участнику.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS owner_id INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

-- У старых групп создатель не сохранялся. Владельцем назначаем автора первого
-- сообщения, если он ещё в группе, иначе участника с наименьшим id.
UPDATE chats c
SET owner_id = COALESCE(
    (
        SELECT m.sender_id
        FROM messages m
        JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = m.sender_id
        WHERE m.chat_id = c.id
        ORDER BY m.id
        LIMIT 1
    ),
    (SELECT MIN(cm.user_id) FROM chat_members cm WHERE cm.chat_id = c.id)
)
WHERE c.type = 'group' AND c.owner_id IS NULL;

-- История чата грузится страницами по id (before_id), а не по времени.
CREATE INDEX IF NOT EXISTS idx_messages_chat_id_desc ON messages(chat_id, id DESC);
