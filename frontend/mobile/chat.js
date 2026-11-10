// Мобильная версия: один чат на весь экран. Открывается как chat.html?id=N,
// где -1 — виртуальное «Избранное».

import { API } from "../shared/api.js";
import { CONFIG, PATHS } from "../shared/config.js";
import { ContactSuggestion } from "../shared/contact-suggestion.js";
import { Preferences } from "../shared/preferences.js";
import { Presence } from "../shared/presence.js";
import { Realtime } from "../shared/realtime.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import { GroupInfo } from "../shared/group-info.js";
import {
    appendIncoming,
    appendMessage,
    loadMessageHistory,
    MESSAGE_CLASSES,
    Receipts,
    updateMessageStatuses
} from "../shared/messages.js";
import { MessageActions } from "../shared/message-actions.js";

export const MobileChat = {
    chatId: null,
    peerUsername: null,
    peerAvatarUrl: null,
    peerIsContact: false,
    chatType: "private",
    chatMembersCount: null,
    chatAvatarUrl: null,
    // Событие о прочтении может прийти раньше ответа на отправку — применим
    // отметки после того, как сообщение появится в DOM.
    statusDelivered: 0,
    statusRead: 0,

    async init() {
        if (!Session.requireAuth()) return;

        Preferences.applyAll();

        // Без id (например, заход вручную) — возвращаем к списку
        const raw = new URLSearchParams(window.location.search).get("id");
        const parsed = Number(raw);
        if (raw === null || !Number.isInteger(parsed)) {
            window.location.replace(PATHS.MOBILE_CHATS);
            return;
        }
        this.chatId = parsed;

        MessageActions.init({
            mode: "mobile",
            classes: MESSAGE_CLASSES.mobile,
            getChatId: () => this.chatId,
            onChanged: () => {}
        });

        document.getElementById("back-btn").onclick = () => window.location.href = PATHS.MOBILE_CHATS;
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        const messageInput = document.getElementById("message-input");
        if (messageInput) {
            messageInput.addEventListener("input", () => {
                // Во время правки не затираем черновик нового сообщения
                if (!MessageActions.isEditing()) {
                    this.saveDraft(this.chatId, messageInput.value);
                    if (messageInput.value.trim()) {
                        Realtime.sendTyping(this.chatId);
                    }
                }
                this.resizeInput(messageInput);
            });
            messageInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    document.getElementById("message-form").requestSubmit();
                }
            });
        }
        document.getElementById("attach-btn").onclick = () =>
            document.getElementById("image-input").click();
        document.getElementById("image-input").onchange = (e) =>
            this.sendImage(e.target);
        document.getElementById("chat-contact-banner-add").onclick =
            () => this.addPeerToContacts();
        document.getElementById("chat-contact-banner-close").onclick =
            () => this.dismissContactSuggestion();
        document.getElementById("chat-info-btn").onclick = () =>
            this.openInfo();

        GroupInfo.init({
            onChanged: () => this.loadTitle(),
            onRemovedSelf: () => {
                window.location.href = PATHS.MOBILE_CHATS;
            }
        });

        document.getElementById("peer-info-close").onclick = () =>
            this.closePeerInfo();
        document.querySelector(".m-peer-info-backdrop").onclick = () =>
            this.closePeerInfo();

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isPeerInfoOpen()) this.closePeerInfo();
        });

        // Собеседник пишет — сообщение появляется здесь без перезагрузки
        Realtime.connect(
            (msg) => this.onIncoming(msg),
            (status) => this.onStatus(status)
        );
        Presence.init();

        // Вернулись на вкладку — всё, что пришло в открытый чат, стало прочитано
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                this.markCurrentChatRead();
            }
        });

        // Аватарку собеседника обновили — перечитываем данные чата
        document.addEventListener("messenger:avatar-updated", () => this.loadTitle());
        // Группу переименовали, сменили аватар или состав участников
        document.addEventListener("messenger:chat-updated", () => this.loadTitle());
        document.addEventListener("messenger:message-edited", (event) => {
            MessageActions.onMessageEdited(event.detail || {});
        });
        document.addEventListener("messenger:message-deleted", (event) => {
            MessageActions.onMessageDeleted(event.detail || {});
        });

        await this.loadTitle();
        await this.loadMessages();
        const initialInput = document.getElementById("message-input");
        if (initialInput) {
            initialInput.value = this.getDraft(this.chatId);
            this.resizeInput(initialInput);
            initialInput.focus();
        }
    },

    // Параметры общего рендера: мобильные классы, выбор и контекстные действия.
    // В «Избранном» галочки статусов не нужны: там нет собеседника.
    messageOptions() {
        return {
            ...MessageActions.messageOptions(),
            // В группе подписываем чужие сообщения ником отправителя
            showSender: this.chatType === "group"
        };
    },

    onIncoming(msg) {
        // В избранное сервер шлёт отправителю, у него chat_id = -1
        if (msg.chat_id !== this.chatId) return;

        const mine = msg.sender_id === Session.userId();
        // Сообщение пришло — гасим индикатор только этого автора:
        // в группе остальные участники могут продолжать печатать.
        if (!mine) Presence.clearTyping(msg.chat_id, msg.sender_id);
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
            this.chatType = found.chat_type || "private";
            this.chatMembersCount = found.members_count ?? null;
            this.peerUsername = this.chatType === "group"
                ? null
                : (found.peer_username || null);
            this.chatAvatarUrl = found.avatar_url || null;
            this.peerAvatarUrl = this.chatType === "group"
                ? null
                : (found.avatar_url || null);
            this.peerIsContact = Boolean(found.is_contact);
            this.setChatAvatar(found.title, found.avatar_url, found.peer_id);
            this.setChatStatus(found.peer_id, found.id);
            this.updateContactSuggestion();
            this.updateInfoButton();
        } catch (err) {
            titleEl.textContent = "Чат";
        }
    },

    setChatAvatar(title, avatarUrl, peerId = null) {
        const avatar = document.getElementById("chat-avatar");
        if (!avatar) return;

        // У «Избранного» нет собеседника
        if (this.chatId === CONFIG.FAVORITES_CHAT_ID) {
            avatar.classList.add("hidden");
            return;
        }

        this.chatAvatarUrl = avatarUrl || null;
        avatar.classList.remove("hidden");
        UI.setAvatar(avatar, title, avatarUrl);
        Presence.attach(avatar, peerId);
    },

    setChatStatus(peerId, chatId) {
        const element = document.getElementById("chat-status");
        if (!element) return;

        if (this.chatType === "group") {
            // Пока никто не печатает — число участников; как только кто-то
            // набирает текст, Presence подменяет строку на «Имя печатает...».
            Presence.bindGroupStatus(
                element,
                chatId,
                this.chatMembersCount !== null
                    ? UI.membersLabel(this.chatMembersCount)
                    : "Группа"
            );
            return;
        }

        Presence.bindStatus(element, peerId, chatId);
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

    // Кнопка информации: профиль собеседника в личном чате, панель группы
    // в групповом. У «Избранного» собеседника нет.
    updateInfoButton() {
        const btn = document.getElementById("chat-info-btn");
        const isGroup = this.chatType === "group";
        btn.classList.toggle(
            "hidden",
            this.chatId === CONFIG.FAVORITES_CHAT_ID || (!isGroup && !this.peerUsername)
        );
        btn.title = isGroup ? "Информация о группе" : "Профиль собеседника";
        btn.setAttribute(
            "aria-label",
            isGroup ? "Информация о группе" : "Информация о собеседнике"
        );
    },

    openInfo() {
        if (this.chatType === "group") {
            GroupInfo.open(this.chatId, {
                title: document.getElementById("chat-title").textContent,
                avatar_url: this.chatAvatarUrl,
                members_count: this.chatMembersCount
            });
            return;
        }
        if (this.peerUsername) this.openPeerInfo();
    },

    isPeerInfoOpen() {
        return document.getElementById("peer-info-modal").classList.contains("open");
    },

    // Профиль собеседника на весь экран: не уходим со страницы чата,
    // поэтому WebSocket и отправка сообщений продолжают работать.
    async openPeerInfo() {
        let user = null;
        try {
            const users = await API.searchUsers(this.peerUsername);
            const match = users.find(
                (u) => u.username.replace(/^@/, "").toLowerCase()
                    === this.peerUsername.replace(/^@/, "").toLowerCase()
            ) || users[0];
            if (match) user = await API.getUser(match.id);
        } catch (err) {
            // Собеседник мог удалить аккаунт — покажем то, что есть из чата.
            user = null;
        }
        this.renderPeerInfo(user);

        const modal = document.getElementById("peer-info-modal");
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
        document.getElementById("peer-info-close").focus();
    },

    renderPeerInfo(user) {
        const titleEl = document.getElementById("chat-title");
        const nickname = (user && user.nickname) || titleEl.textContent || "Собеседник";
        document.getElementById("peer-info-name").textContent = nickname;
        UI.setAvatar(
            document.getElementById("peer-info-avatar"),
            nickname,
            (user && user.avatar_url) || this.peerAvatarUrl || null
        );

        const usernameEl = document.getElementById("peer-info-username");
        usernameEl.textContent = user ? user.username : "—";

        const bioEl = document.getElementById("peer-info-bio");
        if (user && user.bio) {
            bioEl.textContent = user.bio;
            bioEl.hidden = false;
        } else {
            bioEl.textContent = "";
            bioEl.hidden = true;
        }

        const birthEl = document.getElementById("peer-info-birth");
        if (user && user.birth_date) {
            birthEl.textContent = new Date(user.birth_date).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric"
            });
            birthEl.hidden = false;
        } else {
            birthEl.textContent = "";
            birthEl.hidden = true;
        }
    },

    closePeerInfo() {
        const modal = document.getElementById("peer-info-modal");
        if (!modal.classList.contains("open")) return;
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
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

    draftKey(chatId) {
        return `messenger_draft_${Session.userId()}_${chatId}`;
    },

    saveDraft(chatId, text) {
        if (chatId === null || chatId === undefined) return;
        try {
            localStorage.setItem(this.draftKey(chatId), text || "");
        } catch (e) {}
    },

    getDraft(chatId) {
        if (chatId === null || chatId === undefined) return "";
        try {
            return localStorage.getItem(this.draftKey(chatId)) || "";
        } catch (e) {
            return "";
        }
    },

    clearDraft(chatId) {
        if (chatId === null || chatId === undefined) return;
        try {
            localStorage.removeItem(this.draftKey(chatId));
        } catch (e) {}
    },

    resizeInput(input) {
        if (!input) return;

        const styles = getComputedStyle(input);
        const lineHeight = parseFloat(styles.lineHeight) || 22.4;
        const verticalPadding =
            parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
        const verticalBorder =
            parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
        // Поле растёт до 10 строк, дальше включается внутренняя прокрутка.
        const maxHeight = lineHeight * 10 + verticalPadding + verticalBorder;
        const wasScrollable = input.classList.contains("is-scrollable");

        input.style.height = "auto";
        // scrollHeight не учитывает рамку, а при border-box она входит в высоту.
        const contentHeight = input.scrollHeight + verticalBorder;
        const scrollable = contentHeight > maxHeight;

        input.classList.toggle("is-scrollable", scrollable);
        input.style.height = Math.min(contentHeight, maxHeight) + "px";

        if (scrollable && !wasScrollable) {
            input.scrollTop = input.scrollHeight;
        } else if (!scrollable) {
            input.scrollTop = 0;
        }
    },

    async sendMessage(e) {
        e.preventDefault();
        const input = document.getElementById("message-input");

        // Enter в режиме правки сохраняет изменение, а не отправляет новое
        if (MessageActions.isEditing()) {
            if (!MessageActions.canSaveEdit(input.value)) return;
            try {
                await MessageActions.saveEdit(input.value);
            } catch (err) {
                alert(err.message);
            }
            return;
        }

        const text = input.value.trim();
        if (!text) return;

        const replyToId = MessageActions.replyToId();
        input.value = "";
        this.clearDraft(this.chatId);
        this.resizeInput(input);
        try {
            const msg = await API.sendMessage(this.chatId, text, replyToId);
            MessageActions.clearReply();
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            appendMessage(box, msg, this.messageOptions());
            this.applyCachedStatuses();
            UI.scrollToBottom(box);
        } catch (err) {
            input.value = text;
            this.resizeInput(input);
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

        // В режиме правки скрепка выбирает новое фото, отправка — по Enter
        if (MessageActions.isEditing()) {
            MessageActions.setEditImage(file);
            return;
        }

        const replyToId = MessageActions.replyToId();
        try {
            const msg = await API.uploadImage(
                this.chatId,
                file,
                "",
                replyToId
            );
            MessageActions.clearReply();
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
