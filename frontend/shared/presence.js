// Кто из связанных пользователей сейчас в сети и когда был в последний раз.
//
// Сервер присылает изменения по WebSocket, а начальное состояние — отдельным
// запросом: событие сообщает только о переходах, а не о тех, кто уже был онлайн.
// Зелёная точка живёт прямо в аватаре, а строка под именем в шапке чата
// показывает «в сети», «был в …» или «печатает...».

import { API } from "./api.js";
import { UI } from "./ui.js";

// Сервер отдаёт время как ISO. Если зоны нет (SQLite/naive-значения), считаем
// его UTC: иначе браузер понял бы строку как местное время.
function parseServerDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    let text = String(value).trim();
    if (!text) return null;
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) text += "Z";
    text = text.replace(" ", "T");

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function formatLastSeen(date) {
    const now = new Date();
    const time = date.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit"
    });

    if (sameDay(date, now)) return `был в ${time}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(date, yesterday)) return `был вчера в ${time}`;

    if (date.getFullYear() === now.getFullYear()) {
        const day = date.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long"
        });
        return `был ${day} в ${time}`;
    }

    const day = date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric"
    });
    return `был ${day} в ${time}`;
}

// Столько живёт «печатает...» после последнего события от собеседника.
const TYPING_TIMEOUT = 3500;

export const Presence = {
    online: new Set(),
    lastSeen: new Map(),
    // chat_id -> { userId, until, timer }. Состояние эфемерное и только для UI.
    typing: new Map(),
    seq: 0,
    lastEvents: new Map(),
    initialized: false,
    refreshing: null,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        document.addEventListener("messenger:presence", (event) => {
            this.onEvent(event.detail || {});
        });
        document.addEventListener("messenger:typing", (event) => {
            this.onTyping(event.detail || {});
        });

        // После сна ноутбука или возврата из bfcache сокет мог отвалиться, и
        // события за это время потерялись — сверяемся с сервером.
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") this.refresh();
        });
        window.addEventListener("pageshow", (event) => {
            if (event.persisted) this.refresh();
        });
        // При каждом открытии сокета (в том числе после обрыва) сверяемся
        // с сервером: за время простоя часть событий могла потеряться.
        document.addEventListener("messenger:realtime-open", () => this.refresh());

        this.refresh();
    },

    onEvent(data) {
        const userId = Number(data.user_id);
        if (!Number.isInteger(userId) || userId <= 0) return;

        const online = Boolean(data.online);
        const lastSeen = parseServerDate(data.last_seen_at);
        this.seq += 1;
        // Запоминаем событие: ответ на getPresence мог быть сформирован раньше,
        // а прийти позже. Такие события должны победить устаревший снимок.
        this.lastEvents.set(userId, { seq: this.seq, online, lastSeen });

        if (lastSeen) this.lastSeen.set(userId, lastSeen);
        else if (Object.prototype.hasOwnProperty.call(data, "last_seen_at")) {
            this.lastSeen.delete(userId);
        }

        // Ушёл в офлайн — «печатает...» больше не показываем
        if (!online) this.clearTypingForUser(userId);
        this.set(userId, online);
    },

    onTyping(data) {
        const chatId = Number(data.chat_id);
        const userId = Number(data.user_id);
        if (!Number.isInteger(chatId) || chatId <= 0) return;
        if (!Number.isInteger(userId) || userId <= 0) return;

        const previous = this.typing.get(chatId);
        if (previous && previous.timer) clearTimeout(previous.timer);

        const until = Date.now() + TYPING_TIMEOUT;
        const timer = setTimeout(() => {
            const current = this.typing.get(chatId);
            // Пока ждали, могло прийти новое событие с другим сроком
            if (!current || current.until !== until) return;
            this.typing.delete(chatId);
            this.renderStatuses();
        }, TYPING_TIMEOUT);

        this.typing.set(chatId, { userId, until, timer });
        this.renderStatuses();
    },

    clearTyping(chatId) {
        const id = Number(chatId);
        const entry = this.typing.get(id);
        if (!entry) return;

        if (entry.timer) clearTimeout(entry.timer);
        this.typing.delete(id);
        this.renderStatuses();
    },

    clearTypingForUser(userId) {
        const id = Number(userId);
        let changed = false;

        for (const [chatId, entry] of [...this.typing]) {
            if (entry.userId !== id) continue;
            if (entry.timer) clearTimeout(entry.timer);
            this.typing.delete(chatId);
            changed = true;
        }

        if (changed) this.renderStatuses();
    },

    async refresh() {
        if (this.refreshing) return this.refreshing;

        const startSeq = this.seq;
        this.refreshing = (async () => {
            try {
                const data = await API.getPresence();
                const next = new Set(
                    (data.online || []).map(Number).filter((id) => id > 0)
                );
                const nextSeen = new Map();
                for (const [rawId, rawDate] of Object.entries(data.last_seen || {})) {
                    const userId = Number(rawId);
                    const date = parseServerDate(rawDate);
                    if (userId > 0 && date) nextSeen.set(userId, date);
                }

                // События, пришедшие во время запроса, важнее снимка
                for (const [userId, event] of this.lastEvents) {
                    if (event.seq <= startSeq) continue;
                    if (event.online) next.add(userId);
                    else next.delete(userId);
                    if (event.lastSeen) nextSeen.set(userId, event.lastSeen);
                    else nextSeen.delete(userId);
                }

                this.online = next;
                this.lastSeen = nextSeen;
                this.render();
            } catch (err) {
                // Без сети индикаторы просто останутся в последнем известном
                // состоянии — это не повод показывать ошибку в интерфейсе.
            } finally {
                this.refreshing = null;
            }
        })();

        return this.refreshing;
    },

    set(userId, online) {
        const id = Number(userId);
        if (!id) return;

        const wasOnline = this.online.has(id);
        if (online) this.online.add(id);
        else this.online.delete(id);

        if (wasOnline !== online) this.render();
    },

    isOnline(userId) {
        return this.online.has(Number(userId));
    },

    presenceText(userId) {
        if (this.isOnline(userId)) return "в сети";
        const seen = this.lastSeen.get(Number(userId));
        return seen ? formatLastSeen(seen) : "не в сети";
    },

    // Добавляет точку в аватар и запоминает, чей это статус. Повторный вызов
    // безопасен: используется и после setAvatar, который очищает содержимое.
    attach(avatar, userId) {
        if (!avatar) return avatar;

        const id = Number(userId);
        if (!id) {
            avatar.classList.remove("presence-host", "is-online");
            avatar.removeAttribute("data-presence-user");
            return avatar;
        }

        avatar.dataset.presenceUser = String(id);
        avatar.classList.add("presence-host");

        let dot = avatar.querySelector(".presence-dot");
        if (!dot) {
            dot = UI.el("span", "presence-dot");
            dot.setAttribute("role", "img");
            avatar.appendChild(dot);
        }
        this.update(avatar);
        return avatar;
    },

    update(avatar) {
        const userId = Number(avatar.dataset.presenceUser);
        const online = this.online.has(userId);
        avatar.classList.toggle("is-online", online);

        const dot = avatar.querySelector(".presence-dot");
        if (!dot) return;
        dot.title = online ? "В сети" : "Не в сети";
        dot.setAttribute("aria-label", dot.title);
    },

    // Строка статуса под именем в шапке чата. Без собеседника (например,
    // в «Избранном») элемент просто скрыт.
    bindStatus(element, userId, chatId) {
        if (!element) return element;

        const id = Number(userId);
        const chat = Number(chatId);
        if (!Number.isInteger(id) || id <= 0
            || !Number.isInteger(chat) || chat <= 0) {
            element.classList.add("hidden");
            delete element.dataset.presenceStatusUser;
            delete element.dataset.presenceStatusChat;
            return element;
        }

        element.dataset.presenceStatusUser = String(id);
        element.dataset.presenceStatusChat = String(chat);
        element.classList.remove("hidden");
        this.updateStatus(element);
        return element;
    },

    updateStatus(element) {
        const userId = Number(element.dataset.presenceStatusUser);
        const chatId = Number(element.dataset.presenceStatusChat);
        const online = this.online.has(userId);

        const typing = this.typing.get(chatId);
        const isTyping = Boolean(
            typing && typing.userId === userId && typing.until > Date.now()
        );

        element.textContent = isTyping ? "печатает..." : this.presenceText(userId);
        element.classList.toggle("is-online", online && !isTyping);
        element.classList.toggle("is-typing", isTyping);
    },

    renderStatuses() {
        document.querySelectorAll("[data-presence-status-user]").forEach((element) => {
            this.updateStatus(element);
        });
    },

    render() {
        document.querySelectorAll("[data-presence-user]").forEach((avatar) => {
            this.update(avatar);
        });
        this.renderStatuses();
    }
};
