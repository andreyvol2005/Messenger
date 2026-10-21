// Десктопная версия: список чатов и окно переписки на одной странице.

import { API } from "../shared/api.js";
import { CONFIG } from "../shared/config.js";
import { Realtime } from "../shared/realtime.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import {
    appendIncoming,
    appendMessage,
    loadMessageHistory,
    MESSAGE_CLASSES
} from "../shared/messages.js";
import { UserSearch } from "../shared/user-search.js";

export const Chat = {
    currentChatId: null,

    async init() {
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        UserSearch.init((chat) => this.openChat(chat.id, chat.title));

        Realtime.connect((msg) => this.onIncoming(msg));
        await this.loadChats();
    },

    // Параметры общего рендера: классы десктопа, звезда только вне избранного
    messageOptions() {
        return {
            classes: MESSAGE_CLASSES.desktop,
            showStar: this.currentChatId !== CONFIG.FAVORITES_CHAT_ID,
            onToggleFavorite: (star, msg) => this.onToggleFavorite(star, msg)
        };
    },

    // Сообщение от другого человека пришло по сокету
    onIncoming(msg) {
        if (msg.chat_id === this.currentChatId) {
            appendIncoming(document.getElementById("messages"), msg, this.messageOptions());
        }
        this.refreshList();
    },

    // ---------- Список чатов ----------

    async loadChats() {
        const list = document.getElementById("chat-list");
        list.innerHTML = "";

        try {
            const { chats } = await API.getChats();

            if (!chats.length) {
                list.appendChild(UI.el("li", "chat-item loading-item", "Пока нет чатов"));
                return;
            }

            for (const chat of chats) {
                const item = UI.el("li", "chat-item");
                if (chat.id === this.currentChatId) item.classList.add("active");
                item.appendChild(UI.el("div", "chat-item-title",
                    chat.is_favorites ? "★ " + chat.title : chat.title));
                item.appendChild(UI.el("div", "chat-item-preview",
                    chat.last_message || "Нет сообщений"));
                item.onclick = () => this.openChat(chat.id, chat.title);
                list.appendChild(item);
            }
        } catch (err) {
            list.appendChild(UI.el("li", "chat-item loading-item", err.message));
        }
    },

    // ---------- Окно переписки ----------

    async openChat(chatId, title) {
        this.currentChatId = chatId;

        document.getElementById("chat-placeholder").classList.add("hidden");
        document.getElementById("chat-window").classList.remove("hidden");
        document.getElementById("chat-title").textContent = title;

        const box = document.getElementById("messages");
        await loadMessageHistory(box, chatId, this.messageOptions());
        await this.loadChats();
    },

    async onToggleFavorite(star, msg) {
        try {
            const updated = await API.toggleFavorite(msg.id);
            msg.is_favorite = updated.is_favorite;
            star.classList.toggle("active", updated.is_favorite);
            star.textContent = updated.is_favorite ? "★" : "☆";
            // Обновляем превью в списке чатов
            await this.loadChats();
        } catch (err) {
            alert(err.message);
        }
    },

    async sendMessage(e) {
        e.preventDefault();
        const input = document.getElementById("message-input");
        const text = input.value.trim();
        if (!text || this.currentChatId === null) return;

        input.value = "";
        try {
            const msg = await API.sendMessage(this.currentChatId, text);
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            appendMessage(box, msg, this.messageOptions());
            UI.scrollToBottom(box);
            await this.loadChats();
        } catch (err) {
            input.value = text;
            alert(err.message);
        }
    }
};

// Список перерисовываем не на каждое сообщение, а пачкой: события из разных
// чатов могут прийти подряд
Chat.refreshList = UI.debounce(() => Chat.loadChats());
