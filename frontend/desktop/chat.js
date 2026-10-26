// Десктопная версия: список чатов и окно переписки на одной странице.

import { API } from "../shared/api.js";
import { CONFIG } from "../shared/config.js";
import { ContactSuggestion } from "../shared/contact-suggestion.js";
import { Realtime } from "../shared/realtime.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import {
    appendIncoming,
    appendMessage,
    loadMessageHistory,
    MESSAGE_CLASSES,
    Receipts,
    updateMessageStatuses
} from "../shared/messages.js";
import { UserSearch } from "../shared/user-search.js";

export const Chat = {
    currentChatId: null,
    peerUsername: null,
    peerIsContact: false,
    // Последние отметки по чатам: событие может прийти раньше, чем ответ
    // на отправку добавит сообщение в DOM. Тогда применим их после рендера.
    statusBounds: new Map(),

    async init() {
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        document.getElementById("attach-btn").onclick = () =>
            document.getElementById("image-input").click();
        document.getElementById("image-input").onchange = (e) =>
            this.sendImage(e.target);
        document.getElementById("chat-contact-banner-add").onclick =
            () => this.addPeerToContacts();
        document.getElementById("chat-contact-banner-close").onclick =
            () => this.dismissContactSuggestion();
        UserSearch.init((chat) => this.openChat(
            chat.id,
            chat.title,
            chat.peer_username,
            chat.is_contact
        ));

        Realtime.connect(
            (msg) => this.onIncoming(msg),
            (status) => this.onStatus(status)
        );

        // Вернулись на вкладку — всё, что пришло в открытый чат, стало прочитано
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                this.markCurrentChatRead();
            }
        });

        await this.loadChats();
    },

    // Параметры общего рендера: классы десктопа, звезда только вне избранного.
    // В «Избранном» галочки не нужны: там нет собеседника.
    messageOptions() {
        return {
            classes: MESSAGE_CLASSES.desktop,
            showStar: this.currentChatId !== CONFIG.FAVORITES_CHAT_ID,
            showStatus: this.currentChatId !== CONFIG.FAVORITES_CHAT_ID,
            onToggleFavorite: (star, msg) => this.onToggleFavorite(star, msg)
        };
    },

    // Сообщение от другого человека пришло по сокету
    async onIncoming(msg) {
        const mine = msg.sender_id === Session.userId();
        if (msg.chat_id === this.currentChatId) {
            appendIncoming(document.getElementById("messages"), msg, this.messageOptions());
            if (mine) this.applyCachedStatuses(msg.chat_id);
            if (!mine) {
                // Чат открыт: если вкладка видима — сообщение сразу прочитано.
                // Ждём отметку, иначе список успеет показать бейдж непрочитанного.
                await Receipts.acknowledgeMessage(msg.chat_id, msg.id, true);
            }
        } else if (!mine) {
            // Чат закрыт, но сообщение получено — отмечаем доставку
            Receipts.markDelivered(msg.chat_id, msg.id);
        }
        this.refreshList();
    },

    // Собеседник получил или прочитал наши сообщения — обновляем галочки
    onStatus(status) {
        this.statusBounds.set(status.chat_id, {
            delivered: status.last_delivered_message_id || 0,
            read: status.last_read_message_id || 0
        });
        if (status.chat_id !== this.currentChatId) return;
        this.applyCachedStatuses(status.chat_id);
    },

    applyCachedStatuses(chatId) {
        const bounds = this.statusBounds.get(chatId);
        if (!bounds) return;
        updateMessageStatuses(
            document.getElementById("messages"),
            bounds.delivered,
            bounds.read
        );
    },

    async markCurrentChatRead() {
        if (this.currentChatId === null) return;
        await Receipts.acknowledgeHistory(
            document.getElementById("messages"),
            this.currentChatId
        );
        // Бейдж непрочитанных в списке тоже должен исчезнуть
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

                const body = UI.el("div", "chat-item-body");
                body.appendChild(UI.el("div", "chat-item-title",
                    chat.is_favorites ? "★ " + chat.title : chat.title));
                body.appendChild(UI.el("div", "chat-item-preview",
                    chat.last_message || "Нет сообщений"));
                item.appendChild(body);

                // Бейдж — отдельный элемент строки, поэтому выравнивается
                // по её вертикальному центру, а не по строке заголовка.
                if (chat.unread_count > 0) {
                    // Больше 99 не показываем: бейдж не должен растягиваться
                    // на всю строку. Точное число остаётся в подсказке.
                    const label = chat.unread_count > 99
                        ? "99+"
                        : String(chat.unread_count);
                    const badge = UI.el("span", "chat-item-unread", label);
                    badge.title = `Непрочитанных сообщений: ${chat.unread_count}`;
                    badge.setAttribute("aria-label", badge.title);
                    item.appendChild(badge);
                }
                item.onclick = () => this.openChat(
                    chat.id,
                    chat.title,
                    chat.peer_username,
                    chat.is_contact
                );
                list.appendChild(item);
            }
        } catch (err) {
            list.appendChild(UI.el("li", "chat-item loading-item", err.message));
        }
    },

    // ---------- Окно переписки ----------

    async openChat(chatId, title, peerUsername = null, isContact = false) {
        this.currentChatId = chatId;
        this.peerUsername = peerUsername || null;
        this.peerIsContact = Boolean(isContact);
        this.updateContactSuggestion();

        document.getElementById("chat-placeholder").classList.add("hidden");
        document.getElementById("chat-window").classList.remove("hidden");
        document.getElementById("chat-title").textContent = title;

        const box = document.getElementById("messages");
        await loadMessageHistory(box, chatId, this.messageOptions());
        this.applyCachedStatuses(chatId);
        // Открыли чат — всё входящее в ленте получено и (в видимой вкладке) прочитано
        await Receipts.acknowledgeHistory(box, chatId);
        await this.loadChats();
    },

    updateContactSuggestion() {
        const banner = document.getElementById("chat-contact-banner");
        const button = document.getElementById("chat-contact-banner-add");
        const show = Boolean(this.peerUsername)
            && !this.peerIsContact
            && !ContactSuggestion.isDismissed(this.peerUsername);

        banner.classList.toggle("hidden", !show);
        button.disabled = false;
        UI.hideError("chat-contact-banner-error");
    },

    dismissContactSuggestion() {
        if (!this.peerUsername) return;
        ContactSuggestion.dismiss(this.peerUsername);
        this.updateContactSuggestion();
        document.getElementById("message-input").focus();
    },

    async addPeerToContacts() {
        if (!this.peerUsername) return;

        const button = document.getElementById("chat-contact-banner-add");
        button.disabled = true;
        UI.hideError("chat-contact-banner-error");

        try {
            await ContactSuggestion.add(this.peerUsername);
            this.peerIsContact = true;
            this.updateContactSuggestion();
            UI.toast("Контакт добавлен");
            await this.loadChats();
        } catch (err) {
            UI.showError("chat-contact-banner-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    markContactAdded(username) {
        const normalized = (username || "").replace(/^@/, "").trim();
        const current = (this.peerUsername || "").replace(/^@/, "").trim();
        if (!current || normalized !== current) return;

        this.peerIsContact = true;
        this.updateContactSuggestion();
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
            this.applyCachedStatuses(this.currentChatId);
            UI.scrollToBottom(box);
            await this.loadChats();
        } catch (err) {
            input.value = text;
            alert(err.message);
        }
    },

    // Скрепка: файл выбран — сразу отправляем, без промежуточной формы
    async sendImage(input) {
        const file = input.files && input.files[0];
        // Сбрасываем значение, иначе повторный выбор того же файла не сработает
        input.value = "";
        if (!file || this.currentChatId === null) return;

        if (!file.type.startsWith("image/")) {
            alert("Можно отправлять только изображения");
            return;
        }
        if (file.size > CONFIG.MAX_IMAGE_BYTES) {
            alert("Файл больше 5 МБ");
            return;
        }

        try {
            const msg = await API.uploadImage(this.currentChatId, file);
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            appendMessage(box, msg, this.messageOptions());
            this.applyCachedStatuses(this.currentChatId);
            UI.scrollToBottom(box);
            await this.loadChats();
        } catch (err) {
            alert(err.message);
        }
    }
};

// Список перерисовываем не на каждое сообщение, а пачкой: события из разных
// чатов могут прийти подряд
Chat.refreshList = UI.debounce(() => Chat.loadChats());
