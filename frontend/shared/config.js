// Настройки приложения и адреса страниц. Общий модуль для всех версий.

export const CONFIG = {
    API_BASE: "",
    // Виртуальная папка: на бэке это сообщения с chat_id = NULL, принадлежащие
    // владельцу (sender_id). Клиент работает с привычным id -1.
    FAVORITES_CHAT_ID: -1,
    MOBILE_MAX_WIDTH: 768,
    // Лимит совпадает с проверкой на бэкенде (backend/media.py)
    MAX_IMAGE_BYTES: 5 * 1024 * 1024,
    MAX_WALLPAPER_BYTES: 10 * 1024 * 1024,
    STORAGE: {
        TOKEN: "messenger_token",
        USER_ID: "messenger_user_id",
        USERNAME: "messenger_username",
        NICKNAME: "messenger_nickname",
        AVATAR: "messenger_avatar",
        THEME: "messenger_theme",
        WALLPAPER: "messenger_wallpaper",
        SCALE: "messenger_scale"
    }
};

// Абсолютные пути: страницы лежат на разной глубине, относительные путались бы
export const PATHS = {
    LOGIN: "/login.html",
    DESKTOP: "/desktop/index.html",
    MOBILE_CHATS: "/mobile/chats.html",
    MOBILE_CHAT: "/mobile/chat.html"
};
