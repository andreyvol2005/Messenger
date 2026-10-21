// Настройки приложения и адреса страниц. Общий модуль для всех версий.

export const CONFIG = {
    API_BASE: "",
    // Виртуальный чат: на бэке он соответствует chat_id = NULL, is_favorite = true
    FAVORITES_CHAT_ID: -1,
    MOBILE_MAX_WIDTH: 768,
    STORAGE: {
        TOKEN: "messenger_token",
        USER_ID: "messenger_user_id",
        USERNAME: "messenger_username",
        NICKNAME: "messenger_nickname"
    }
};

// Абсолютные пути: страницы лежат на разной глубине, относительные путались бы
export const PATHS = {
    LOGIN: "/login.html",
    DESKTOP: "/desktop/index.html",
    MOBILE_CHATS: "/mobile/chats.html",
    MOBILE_CHAT: "/mobile/chat.html"
};
