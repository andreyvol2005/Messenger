// Мобильная версия: список чатов на весь экран, тап — переход на отдельную страницу чата.

import { API } from "../shared/api.js";
import { Receipts } from "../shared/messages.js";
import { Realtime } from "../shared/realtime.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import { UserSearch } from "../shared/user-search.js";
import { Contacts } from "./contacts.js";
import { Menu } from "./menu.js";
import { Profile } from "./profile.js";

export const MobileChats = {
    async init() {
        if (!Session.requireAuth()) return;

        Menu.init();
        Profile.init();
        Contacts.init();
        UserSearch.init((chat) => {
            window.location.href = Session.chatUrl(chat.id);
        });

        // Список сам обновляется, когда в любом чате появляется сообщение.
        // Входящее сообщение здесь получено, хотя чат и не открыт, — отмечаем
        // доставку, чтобы отправитель увидел вторую серую галочку.
        Realtime.connect((msg) => {
            const mine = msg.sender_id === Session.userId();
            if (!mine && msg.chat_id > 0) {
                Receipts.markDelivered(msg.chat_id, msg.id);
            }
            this.refreshList();
        });

        // Смена аватарки собеседника — тоже повод перерисовать список
        document.addEventListener("messenger:avatar-updated", () => this.refreshList());

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

                const avatar = UI.avatar(
                    chat.is_favorites ? "★" : chat.title,
                    chat.is_favorites ? null : chat.avatar_url,
                    "m-avatar"
                );
                if (chat.is_favorites) avatar.classList.add("m-avatar-fav");

                const body = UI.el("div", "m-chat-body");
                body.appendChild(UI.el("div", "m-chat-title", chat.title));
                body.appendChild(UI.el("div", "m-chat-preview", chat.last_message || "Нет сообщений"));
                item.append(avatar, body);

                // Бейдж — отдельный элемент строки, поэтому выравнивается
                // по её вертикальному центру, а не по строке заголовка.
                if (chat.unread_count > 0) {
                    // Больше 99 не показываем: бейдж не должен растягиваться
                    // на всю строку. Точное число остаётся в подсказке.
                    const label = chat.unread_count > 99
                        ? "99+"
                        : String(chat.unread_count);
                    const badge = UI.el("span", "m-chat-unread", label);
                    badge.title = `Непрочитанных сообщений: ${chat.unread_count}`;
                    badge.setAttribute("aria-label", badge.title);
                    item.appendChild(badge);
                }
                item.onclick = () => { window.location.href = Session.chatUrl(chat.id); };
                list.appendChild(item);
            }
        } catch (err) {
            list.appendChild(UI.el("li", "m-loading", err.message));
        }
    }
};

MobileChats.refreshList = UI.debounce(() => MobileChats.loadChats());

// Возврат из чата по кнопке «назад» может восстановить страницу из bfcache:
// тогда бейдж нужно обновить, потому что сообщения уже прочитаны.
window.addEventListener("pageshow", (event) => {
    if (event.persisted) MobileChats.refreshList();
});

document.addEventListener("DOMContentLoaded", () => MobileChats.init());
