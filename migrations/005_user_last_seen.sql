-- 005. Время последней активности пользователя.
--
-- Нужно для статуса «был в …» в шапке чата, когда собеседник не в сети.
-- Значение обновляется при подключении и отключении WebSocket.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
