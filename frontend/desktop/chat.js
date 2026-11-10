// Десктопная версия: список чатов и окно переписки на одной странице.

import { API } from "../shared/api.js";
import { CONFIG } from "../shared/config.js";
import { ContactSuggestion } from "../shared/contact-suggestion.js";
import { Presence } from "../shared/presence.js";
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
import { MessageActions } from "../shared/message-actions.js";
import { UserSearch } from "../shared/user-search.js";
import { GroupInfo } from "../shared/group-info.js";
import { PeerInfo } from "./peer-info.js";

export const Chat = {
    currentChatId: null,
    peerUsername: null,
    peerIsContact: false,
    // "private" | "group": у группы нет собеседника, но есть название и аватар
    chatType: "private",
    chatMembersCount: null,
    chatAvatarUrl: null,
    // Последние отметки по чатам: событие может прийти раньше, чем ответ
    // на отправку добавит сообщение в DOM. Тогда применим их после рендера.
    statusBounds: new Map(),

    async init() {
        MessageActions.init({
            mode: "desktop",
            classes: MESSAGE_CLASSES.desktop,
            getChatId: () => this.currentChatId,
            onChanged: () => this.refreshList()
        });

        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        const messageInput = document.getElementById("message-input");
        if (messageInput) {
            messageInput.addEventListener("input", () => {
                // Во время правки поле временно показывает текст сообщения,
                // а не черновик нового — не затираем сохранённый черновик.
                if (!MessageActions.isEditing()) {
                    this.saveDraft(this.currentChatId, messageInput.value);
                    if (messageInput.value.trim()) {
                        Realtime.sendTyping(this.currentChatId);
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
            this.resizeInput(messageInput);
        }
        document.getElementById("attach-btn").onclick = () =>
            document.getElementById("image-input").click();
        document.getElementById("image-input").onchange = (e) =>
            this.sendImage(e.target);
        document.getElementById("chat-contact-banner-add").onclick =
            () => this.addPeerToContacts();
        document.getElementById("chat-contact-banner-close").onclick =
            () => this.dismissContactSuggestion();
        UserSearch.init((chat) => this.openChatFromResponse(chat));

        document.addEventListener("messenger:avatar-updated", () => {
            // В списке чатов мог измениться собеседник, а в шапке — его аватар
            this.refreshList();
        });

        document.addEventListener("messenger:chat-updated", (event) => {
            const data = event.detail || {};
            if (Number(data.chat_id) === this.currentChatId) {
                this.refreshCurrentChat();
            }
            this.refreshList();
        });

        document.addEventListener("messenger:message-edited", (event) => {
            MessageActions.onMessageEdited(event.detail || {});
        });
        document.addEventListener("messenger:message-deleted", (event) => {
            MessageActions.onMessageDeleted(event.detail || {});
        });

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

        await this.loadChats();
    },

    // Параметры общего рендера: классы десктопа, выбор и контекстные действия.
    // В «Избранном» галочки статусов не нужны: там нет собеседника.
    messageOptions() {
        return {
            ...MessageActions.messageOptions(),
            // В группе подписываем чужие сообщения ником отправителя
            showSender: this.chatType === "group"
        };
    },

    // Сообщение от другого человека пришло по сокету
    async onIncoming(msg) {
        const mine = msg.sender_id === Session.userId();
        // Сообщение пришло — гасим индикатор только этого автора:
        // в группе остальные участники могут продолжать печатать.
        if (!mine) Presence.clearTyping(msg.chat_id, msg.sender_id);
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
        // Список могут обновлять сразу несколько событий (сообщение, смена
        // группы, ответ на отправку). Считаем только последний запрос, иначе
        // два параллельных ответа допишут чаты в список дважды.
        const generation = (this.chatsLoadGeneration || 0) + 1;
        this.chatsLoadGeneration = generation;

        try {
            const { chats } = await API.getChats();
            if (generation !== this.chatsLoadGeneration) return;

            list.innerHTML = "";
            if (!chats.length) {
                list.appendChild(UI.el("li", "chat-item loading-item", "Пока нет чатов"));
                return;
            }

            for (const chat of chats) {
                const item = UI.el("li", "chat-item");
                if (chat.id === this.currentChatId) item.classList.add("active");

                const avatar = UI.avatar(
                    chat.is_favorites ? "★" : chat.title,
                    chat.is_favorites ? null : chat.avatar_url,
                    "avatar avatar-lg chat-item-avatar"
                );
                if (chat.is_favorites) avatar.classList.add("avatar-fav");
                Presence.attach(avatar, chat.peer_id);

                const title = chat.is_favorites ? "★ " + chat.title : chat.title;
                // В узком режиме текст скрыт, поэтому название остаётся в подсказке
                item.title = title;

                const body = UI.el("div", "chat-item-body");
                body.appendChild(UI.el("div", "chat-item-title", title));
                body.appendChild(UI.el("div", "chat-item-preview",
                    chat.last_message || "Нет сообщений"));
                item.append(avatar, body);

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
                item.onclick = () => this.openChatFromResponse(chat);
                list.appendChild(item);
            }

            // Если открыт чат, шапка тоже должна подхватить свежие название
            // и аватар: у группы они могли измениться с другого устройства.
            const current = chats.find((chat) => chat.id === this.currentChatId);
            if (current) {
                this.applyChatHeader(current);
            }
        } catch (err) {
            if (generation !== this.chatsLoadGeneration) return;
            list.innerHTML = "";
            list.appendChild(UI.el("li", "chat-item loading-item", err.message));
        }
    },

    // ---------- Окно переписки ----------

    openChatFromResponse(chat) {
        return this.openChat(
            chat.id,
            chat.title,
            chat.peer_username,
            chat.is_contact,
            chat.avatar_url,
            chat.peer_id,
            chat.chat_type || "private",
            chat.members_count ?? null
        );
    },

    async openChat(
        chatId,
        title,
        peerUsername = null,
        isContact = false,
        avatarUrl = null,
        peerId = null,
        chatType = "private",
        membersCount = null
    ) {
        // Сохраняем черновик текущего чата перед переключением. Если открыта
        // правка, в поле лежит текст сообщения, а не черновик — его не трогаем.
        if (this.currentChatId !== null && !MessageActions.isEditing()) {
            const currentInput = document.getElementById("message-input");
            if (currentInput) this.saveDraft(this.currentChatId, currentInput.value);
        }
        // Ответ, правка и выбранные сообщения не переносятся в другой чат
        MessageActions.reset();

        this.currentChatId = chatId;
        this.peerUsername = peerUsername || null;
        this.peerIsContact = Boolean(isContact);
        this.chatType = chatType || "private";
        this.chatMembersCount = membersCount ?? null;
        this.chatAvatarUrl = avatarUrl || null;
        this.updateContactSuggestion();

        // Панели профиля собеседника и группы взаимоисключающие
        if (this.chatType === "group") {
            if (PeerInfo.isOpen()) PeerInfo.close();
        } else if (GroupInfo.isOpen()) {
            GroupInfo.close();
        }
        this.updateInfoButton();

        // Переключаемся между личными чатами: панель профиля остаётся открытой,
        // просто перерисовываем её под нового собеседника.
        // У «Избранного» и группы нет собеседника — панель закрываем.
        if (this.chatType !== "group" && PeerInfo.isOpen()) {
            if (this.peerUsername) {
                PeerInfo.open(this.peerUsername, { nickname: title, avatarUrl });
            } else {
                PeerInfo.close();
            }
        }

        document.getElementById("chat-placeholder").classList.add("hidden");
        document.getElementById("chat-window").classList.remove("hidden");
        document.getElementById("chat-title").textContent = title;
        this.setChatAvatar(title, avatarUrl, peerId);
        this.setChatStatus(peerId, chatId);
        // Чат могли создать только что: собеседник уже был онлайн, поэтому
        // события о его входе не приходило — уточняем состояние.
        Presence.refresh();

        const input = document.getElementById("message-input");
        if (input) {
            input.value = this.getDraft(chatId);
            this.resizeInput(input);
        }

        const box = document.getElementById("messages");
        await loadMessageHistory(box, chatId, this.messageOptions());
        this.applyCachedStatuses(chatId);
        // Открыли чат — всё входящее в ленте получено и (в видимой вкладке) прочитано
        await Receipts.acknowledgeHistory(box, chatId);
        await this.loadChats();
    },

    // Обновляет шапку по свежей записи из GET /api/chats
    applyChatHeader(chat) {
        this.chatType = chat.chat_type || "private";
        this.chatMembersCount = chat.members_count ?? null;
        this.peerUsername = chat.peer_username || null;
        this.peerIsContact = Boolean(chat.is_contact);
        this.chatAvatarUrl = chat.avatar_url || null;

        document.getElementById("chat-title").textContent = chat.title;
        this.setChatAvatar(chat.title, chat.avatar_url, chat.peer_id);
        this.setChatStatus(chat.peer_id, chat.id);
        this.updateContactSuggestion();
        this.updateInfoButton();
    },

    // После события chat_updated: имя, аватар и состав группы могли измениться
    async refreshCurrentChat() {
        if (this.currentChatId === null) return;
        if (this.currentChatId === CONFIG.FAVORITES_CHAT_ID) {
            await this.loadChats();
            return;
        }

        try {
            const { chats } = await API.getChats();
            const current = chats.find((chat) => chat.id === this.currentChatId);
            if (!current) {
                // Пользователя удалили из группы — открывать больше нечего
                this.closeChat();
                await this.loadChats();
                return;
            }
            this.applyChatHeader(current);
        } catch (err) {
            // Сеть отвалилась: оставляем то, что уже показано
        }
        await this.loadChats();
    },

    closeChat() {
        if (GroupInfo.isOpen()) GroupInfo.close();
        if (PeerInfo.isOpen()) PeerInfo.close();
        MessageActions.reset();

        this.currentChatId = null;
        this.peerUsername = null;
        this.peerIsContact = false;
        this.chatType = "private";
        this.chatMembersCount = null;
        this.chatAvatarUrl = null;

        document.getElementById("chat-window").classList.add("hidden");
        document.getElementById("chat-placeholder").classList.remove("hidden");
        document.getElementById("messages").innerHTML = "";
        document.getElementById("chat-title").textContent = "";
    },

    updateInfoButton() {
        const infoBtn = document.getElementById("chat-info-btn");
        if (!infoBtn) return;

        const isGroup = this.chatType === "group";
        infoBtn.classList.toggle("hidden", !isGroup && !this.peerUsername);

        if (isGroup) {
            infoBtn.title = "Информация о группе";
            infoBtn.setAttribute("aria-label", "Информация о группе");
            infoBtn.onclick = () => {
                if (GroupInfo.isOpen() && GroupInfo.chatId === this.currentChatId) {
                    GroupInfo.close();
                    return;
                }
                GroupInfo.open(this.currentChatId, {
                    title: document.getElementById("chat-title").textContent,
                    avatar_url: this.chatAvatarUrl,
                    members_count: this.chatMembersCount
                });
            };
            return;
        }

        infoBtn.title = "Профиль собеседника";
        infoBtn.setAttribute("aria-label", "Информация о собеседнике");
        infoBtn.onclick = () => {
            if (!this.peerUsername) return;
            if (PeerInfo.isOpen()) {
                PeerInfo.close();
                return;
            }
            PeerInfo.open(this.peerUsername, {
                nickname: document.getElementById("chat-title").textContent,
                avatarUrl: this.chatAvatarUrl
            });
        };
    },

    setChatAvatar(title, avatarUrl, peerId = null) {
        const avatar = document.getElementById("chat-avatar");
        if (!avatar) return;

        // У «Избранного» нет собеседника
        if (this.currentChatId === CONFIG.FAVORITES_CHAT_ID) {
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
        if (!text || this.currentChatId === null) return;

        const replyToId = MessageActions.replyToId();
        input.value = "";
        this.clearDraft(this.currentChatId);
        this.resizeInput(input);
        try {
            const msg = await API.sendMessage(
                this.currentChatId,
                text,
                replyToId
            );
            MessageActions.clearReply();
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            appendMessage(box, msg, this.messageOptions());
            this.applyCachedStatuses(this.currentChatId);
            UI.scrollToBottom(box);
            await this.loadChats();
        } catch (err) {
            input.value = text;
            this.resizeInput(input);
            alert(err.message);
        }
    },

    // Черновики и размер поля ввода
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

        // В режиме правки скрепка выбирает новую картинку, а не отправляет
        // отдельное сообщение. Файл загрузится только по Enter/сохранению.
        if (MessageActions.isEditing()) {
            MessageActions.setEditImage(file);
            return;
        }

        const replyToId = MessageActions.replyToId();
        try {
            const msg = await API.uploadImage(
                this.currentChatId,
                file,
                "",
                replyToId
            );
            MessageActions.clearReply();
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
