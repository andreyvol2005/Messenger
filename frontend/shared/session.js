// Сессия: токен, данные пользователя и переходы между экранами.

import { CONFIG, PATHS } from "./config.js";

export const Session = {
    isMobile() {
        return window.matchMedia(`(max-width: ${CONFIG.MOBILE_MAX_WIDTH}px)`).matches;
    },

    // Куда попасть после входа и куда возвращаться из приложения
    homePath() {
        return this.isMobile() ? PATHS.MOBILE_CHATS : PATHS.DESKTOP;
    },

    chatUrl(chatId) {
        return `${PATHS.MOBILE_CHAT}?id=${chatId}`;
    },

    token() {
        return localStorage.getItem(CONFIG.STORAGE.TOKEN);
    },

    username() {
        return localStorage.getItem(CONFIG.STORAGE.USERNAME) || "";
    },

    nickname() {
        return localStorage.getItem(CONFIG.STORAGE.NICKNAME) || "?";
    },

    userId() {
        return Number(localStorage.getItem(CONFIG.STORAGE.USER_ID));
    },

    save(data) {
        localStorage.setItem(CONFIG.STORAGE.TOKEN, data.access_token);
        localStorage.setItem(CONFIG.STORAGE.USER_ID, data.user_id);
        localStorage.setItem(CONFIG.STORAGE.USERNAME, data.username || "");
        localStorage.setItem(CONFIG.STORAGE.NICKNAME, data.nickname || "");
    },

    // После смены username/nickname сессия не сбрасывается: JWT привязан к id
    setIdentity(username, nickname) {
        localStorage.setItem(CONFIG.STORAGE.USERNAME, username || "");
        localStorage.setItem(CONFIG.STORAGE.NICKNAME, nickname || "");
    },

    logout() {
        localStorage.clear();
        window.location.replace(PATHS.LOGIN);
    },

    requireAuth() {
        if (!this.token()) {
            window.location.replace(PATHS.LOGIN);
            return false;
        }
        return true;
    }
};
