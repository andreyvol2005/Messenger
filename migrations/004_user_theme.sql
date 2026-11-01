-- 004. Тема интерфейса в аккаунте.
--
-- Хранит предпочтительную тему ("dark"/"light") у пользователя, чтобы
-- при повторном входе не настраивать её заново.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS theme VARCHAR(10) NOT NULL DEFAULT 'dark';

UPDATE users SET theme = 'dark' WHERE theme IS NULL;