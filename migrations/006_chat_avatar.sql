-- Аватар группового чата. У личных чатов колонка остаётся NULL:
-- там интерфейс по-прежнему показывает аватар собеседника.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;
