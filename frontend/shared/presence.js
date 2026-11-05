// Кто из связанных пользователей сейчас в сети.
//
// Сервер присылает изменения по WebSocket, а начальное состояние — отдельным
// запросом: событие сообщает только о переходах, а не о тех, кто уже был онлайн.
// Зелёная точка живёт прямо в аватаре и обновляется без перерисовки списков.

import { API } from "./api.js";
import { UI } from "./ui.js";

export const Presence = {
    online: new Set(),
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
        this.seq += 1;
        // Запоминаем событие: ответ на getPresence мог быть сформирован раньше,
        // а прийти позже. Такие события должны победить устаревший снимок.
        this.lastEvents.set(userId, { seq: this.seq, online });
        this.set(userId, online);
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
                // События, пришедшие во время запроса, важнее снимка
                for (const [userId, event] of this.lastEvents) {
                    if (event.seq <= startSeq) continue;
                    if (event.online) next.add(userId);
                    else next.delete(userId);
                }
                this.online = next;
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

    render() {
        document.querySelectorAll("[data-presence-user]").forEach((avatar) => {
            this.update(avatar);
        });
    }
};
