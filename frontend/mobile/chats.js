// Мобильная версия: список чатов на весь экран, тап — переход на отдельную страницу чата.

import { API } from "../shared/api.js";
import { Realtime } from "../shared/realtime.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import { UserSearch } from "../shared/user-search.js";

export const MobileChats = {
    async init() {
        if (!Session.requireAuth()) return;

        document.getElementById("logout-btn").onclick = () => Session.logout();
        UserSearch.init((chat) => {
            window.location.href = Session.chatUrl(chat.id);
        });

        // Список сам обновляется, когда в любом чате появляется сообщение
        Realtime.connect(() => this.refreshList());

        await this.loadChats();
    },

    async loadChats() {
        const list = document.getElementById("chat-list");
        list.innerHTML = "";

        try {
            const { chats } = await API.getChats();

            if (!chats.length) {
                list.appendChild(UI.el("li", "m-loading", "Пока нет чатов"));
                return;
            }

            for (const chat of chats) {
                const item = UI.el("li", "m-chat-item");

                const avatar = UI.el("div", "m-avatar",
                    chat.is_favorites ? "★" : UI.initial(chat.title));
                if (chat.is_favorites) avatar.classList.add("m-avatar-fav");

                const body = UI.el("div", "m-chat-body");
                const top = UI.el("div", "m-chat-top");
                top.appendChild(UI.el("div", "m-chat-title", chat.title));
                body.appendChild(top);
                body.appendChild(UI.el("div", "m-chat-preview", chat.last_message || "Нет сообщений"));

                item.append(avatar, body);
                item.onclick = () => { window.location.href = Session.chatUrl(chat.id); };
                list.appendChild(item);
            }
        } catch (err) {
            list.appendChild(UI.el("li", "m-loading", err.message));
        }
    }
};

MobileChats.refreshList = UI.debounce(() => MobileChats.loadChats());

document.addEventListener("DOMContentLoaded", () => MobileChats.init());
