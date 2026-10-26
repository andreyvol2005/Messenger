// Мобильная версия: один чат на весь экран. Открывается как chat.html?id=N,
// где -1 — виртуальное «Избранное».

import { API } from "../shared/api.js";
import { CONFIG, PATHS } from "../shared/config.js";
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

export const MobileChat = {
    chatId: null,
    peerUsername: null,
    peerIsContact: false,
    // Событие о прочтении может прийти раньше ответа на отправку — применим
    // отметки после того, как сообщение появится в DOM.
    statusDelivered: 0,
    statusRead: 0,

    async init() {
        if (!Session.requireAuth()) return;

        // Без id (например, заход вручную) — возвращаем к списку
        const raw = new URLSearchParams(window.location.search).get("id");
        const parsed = Number(raw);
        if (raw === null || !Number.isInteger(parsed)) {
            window.location.replace(PATHS.MOBILE_CHATS);
            return;
        }
        this.chatId = parsed;

        document.getElementById("back-btn").onclick = () => window.location.href = PATHS.MOBILE_CHATS;
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        document.getElementById("attach-btn").onclick = () =>
            document.getElementById("image-input").click();
        document.getElementById("image-input").onchange = (e) =>
            this.sendImage(e.target);
        document.getElementById("chat-contact-banner-add").onclick =
            () => this.addPeerToContacts();
        document.getElementById("chat-contact-banner-close").onclick =
            () => this.dismissContactSuggestion();

        // Собеседник пишет — сообщение появляется здесь без перезагрузки
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

        // Аватарку собеседника обновили — перечитываем данные чата
        document.addEventListener("messenger:avatar-updated", () => this.loadTitle());

        await this.loadTitle();
        await this.loadMessages();
        document.getElementById("message-input").focus();
    },

    // Параметры общего рендера: мобильные классы, звезда только вне избранного.
    // В «Избранном» галочки не нужны: там нет собеседника.
    messageOptions() {
        return {
            classes: MESSAGE_CLASSES.mobile,
            showStar: this.chatId !== CONFIG.FAVORITES_CHAT_ID,
            showStatus: this.chatId !== CONFIG.FAVORITES_CHAT_ID,
            onToggleFavorite: (star, msg) => this.onToggleFavorite(star, msg)
        };
    },

    onIncoming(msg) {
        // В избранное сервер шлёт отправителю, у него chat_id = -1
        if (msg.chat_id !== this.chatId) return;

        const mine = msg.sender_id === Session.userId();
        appendIncoming(document.getElementById("messages"), msg, this.messageOptions());
        if (mine) this.applyCachedStatuses();
        if (!mine) {
            // Чат открыт: если вкладка видима — сообщение сразу прочитано
            Receipts.acknowledgeMessage(msg.chat_id, msg.id, true);
        }
    },

    // Собеседник получил или прочитал наши сообщения — обновляем галочки
    onStatus(status) {
        if (status.chat_id !== this.chatId) return;
        this.statusDelivered = status.last_delivered_message_id || 0;
        this.statusRead = status.last_read_message_id || 0;
        this.applyCachedStatuses();
    },

    applyCachedStatuses() {
        updateMessageStatuses(
            document.getElementById("messages"),
            this.statusDelivered,
            this.statusRead
        );
    },

    async markCurrentChatRead() {
        await Receipts.acknowledgeHistory(
            document.getElementById("messages"),
            this.chatId
        );
    },

    // Заголовок берём из списка чатов — так он всегда совпадает с тем, что видит собеседник
    async loadTitle() {
        const titleEl = document.getElementById("chat-title");
        titleEl.textContent = this.chatId === CONFIG.FAVORITES_CHAT_ID ? "Избранное" : "Чат";
        try {
            const { chats } = await API.getChats();
            const found = chats.find((c) => c.id === this.chatId);
            if (!found) {
                // Чата нет (удалили или с другого устройства) — назад к списку
                window.location.replace(PATHS.MOBILE_CHATS);
                return;
            }
            titleEl.textContent = found.title;
            this.peerUsername = found.peer_username || null;
            this.peerIsContact = Boolean(found.is_contact);
            this.setChatAvatar(found.title, found.avatar_url);
            this.updateContactSuggestion();
        } catch (err) {
            titleEl.textContent = "Чат";
        }
    },

    setChatAvatar(title, avatarUrl) {
        const avatar = document.getElementById("chat-avatar");
        if (!avatar) return;

        // У «Избранного» нет собеседника
        if (this.chatId === CONFIG.FAVORITES_CHAT_ID) {
            avatar.classList.add("hidden");
            return;
        }

        avatar.classList.remove("hidden");
        UI.setAvatar(avatar, title, avatarUrl);
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
        } catch (err) {
            UI.showError("chat-contact-banner-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    async loadMessages() {
        const box = document.getElementById("messages");
        await loadMessageHistory(box, this.chatId, this.messageOptions());
        this.applyCachedStatuses();
        // Открыли чат — всё входящее в ленте получено и (в видимой вкладке) прочитано
        await Receipts.acknowledgeHistory(box, this.chatId);
    },

    async onToggleFavorite(star, msg) {
        try {
            const updated = await API.toggleFavorite(msg.id);
            msg.is_favorite = updated.is_favorite;
            star.classList.toggle("active", updated.is_favorite);
            star.textContent = updated.is_favorite ? "★" : "☆";
        } catch (err) {
            alert(err.message);
        }
    },

    async sendMessage(e) {
        e.preventDefault();
        const input = document.getElementById("message-input");
        const text = input.value.trim();
        if (!text) return;

        input.value = "";
        try {
            const msg = await API.sendMessage(this.chatId, text);
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            appendMessage(box, msg, this.messageOptions());
            this.applyCachedStatuses();
            UI.scrollToBottom(box);
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
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Можно отправлять только изображения");
            return;
        }
        if (file.size > CONFIG.MAX_IMAGE_BYTES) {
            alert("Файл больше 5 МБ");
            return;
        }

        try {
            const msg = await API.uploadImage(this.chatId, file);
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            appendMessage(box, msg, this.messageOptions());
            this.applyCachedStatuses();
            UI.scrollToBottom(box);
        } catch (err) {
            alert(err.message);
        }
    }
};

document.addEventListener("DOMContentLoaded", () => MobileChat.init());
