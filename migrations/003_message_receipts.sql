-- 003. Статусы доставки и прочтения сообщений.
--
-- Для каждого участника чата храним максимальный id сообщения, которое его
-- клиент уже получил (delivered) и которое он увидел в открытом чате (read).
-- Статус своего сообщения отправитель вычисляет как минимум по остальным
-- участникам: в личном чате это один собеседник, в групповом — все.
--
-- Идемпотентно: на свежей базе из init.sql колонки уже есть.

ALTER TABLE chat_members
    ADD COLUMN IF NOT EXISTS last_delivered_message_id INTEGER DEFAULT NULL;

ALTER TABLE chat_members
    ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER DEFAULT NULL;

-- До появления статусов история не хранила отметок. Считаем старую переписку
-- уже прочитанной: иначе все прежние сообщения навсегда остались бы с одной
-- галочкой, хотя собеседники их давно видели. Новые сообщения получают
-- статусы по-настоящему — от момента отправки.
UPDATE chat_members AS cm
SET last_delivered_message_id = latest.id,
    last_read_message_id = latest.id
FROM (
    SELECT chat_id, MAX(id) AS id
    FROM messages
    WHERE chat_id IS NOT NULL
    GROUP BY chat_id
) AS latest
WHERE cm.chat_id = latest.chat_id
  AND cm.last_delivered_message_id IS NULL
  AND cm.last_read_message_id IS NULL;
