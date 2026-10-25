// HTTP-клиент: все запросы к FastAPI в одном месте.

import { CONFIG } from "./config.js";
import { Realtime } from "./realtime.js";
import { Session } from "./session.js";

// Серверные тексты тоже показываем по-русски, не меняя API.
function localizeErrorMessage(message) {
    return String(message)
        .replace("Этот username уже занят", "Это имя пользователя уже занято")
        .replace("Неверный username или пароль", "Неверное имя пользователя или пароль")
        .replace("Пользователь с таким username не найден", "Пользователь с таким именем пользователя не найден")
        .replace("Введите username", "Введите имя пользователя")
        .replace("Пишите username без символа @", "Пишите имя пользователя без символа @")
        .replace("Username не может быть длиннее", "Имя пользователя не может быть длиннее")
        .replace("Username: только", "Имя пользователя: только")
        .replace("Введите nickname", "Введите имя")
        .replace("Пишите nickname без символа @", "Пишите имя без символа @")
        .replace("Nickname не может быть длиннее", "Имя не может быть длиннее")
        .replace("Nickname: только", "Имя: только");
}

export const API = {
    async request(url, options = {}) {
        const headers = {};
        // FormData: Content-Type с boundary браузер выставляет сам, вручную
        // его задавать нельзя — иначе сервер не разберёт multipart.
        if (!(options.body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
        }
        const token = Session.token();
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const response = await fetch(CONFIG.API_BASE + url, {
            headers,
            ...options,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            // Токен протух — возвращаем на экран входа
            if (response.status === 401) Session.logout();
            throw new Error(localizeErrorMessage(data.detail || `HTTP ${response.status}`));
        }
        return data;
    },

    register(username, password) {
        return this.request("/api/register", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });
    },

    login(username, password) {
        return this.request("/api/login", {
            method: "POST",
            body: JSON.stringify({ username, password })
        });
    },

    getUsers() {
        return this.request("/api/users");
    },

    searchUsers(query) {
        return this.request(`/api/users?q=${encodeURIComponent(query)}`);
    },

    getContacts() {
        return this.request("/api/contacts");
    },

    addContact(username) {
        return this.request("/api/contacts", {
            method: "POST",
            body: JSON.stringify({ username })
        });
    },

    getChats() {
        return this.request("/api/chats");
    },

    createChat(username) {
        return this.request("/api/chats", {
            method: "POST",
            body: JSON.stringify({ username })
        });
    },

    getMessages(chatId, limit = 50) {
        return this.request(`/api/messages/${chatId}?limit=${limit}`);
    },

    sendMessage(chatId, text) {
        return this.request("/api/messages", {
            method: "POST",
            body: JSON.stringify({ chat_id: chatId, text })
        }).then((msg) => {
            // Сообщение уже показано по ответу, а сервер разошлёт его же по сокету.
            // Помечаем как увиденное, чтобы Realtime не показал его второй раз.
            Realtime.markSeen(msg.id);
            return msg;
        });
    },

    toggleFavorite(messageId) {
        return this.request(`/api/messages/${messageId}/favorite`, { method: "POST" });
    },

    uploadImage(chatId, file, caption = "") {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("file", file);
        if (caption) form.append("caption", caption);

        return this.request("/api/messages/upload", {
            method: "POST",
            body: form
        }).then((msg) => {
            // Как и у текстового сообщения: своё не показываем дважды
            Realtime.markSeen(msg.id);
            return msg;
        });
    },

    getMe() {
        return this.request("/api/me");
    },

    updateMe(data) {
        return this.request("/api/me", {
            method: "PATCH",
            body: JSON.stringify(data)
        });
    }
};
