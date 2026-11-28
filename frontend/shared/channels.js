// Каналы: создание, каталог с поиском и панель информации.
// Разметка с одинаковыми id используется и на десктопе, и в мобильной версии,
// отличается только контейнер и внешний вид.

import { API } from "./api.js";
import { Session } from "./session.js";
import { UI } from "./ui.js";

// Подписка идемпотентна на сервере: повторный запрос не создаёт дублей.
async function toggleSubscription(chatId, subscribed) {
    return subscribed
        ? API.unsubscribeChannel(chatId)
        : API.subscribeChannel(chatId);
}

// ==========================================
// Создание канала
// ==========================================

export const ChannelCreate = {
    onCreated: null,

    init(options = {}) {
        this.onCreated = options.onCreated || null;
        this.modal = document.getElementById("channel-create-modal");
        if (!this.modal) return;

        this.form = document.getElementById("channel-create-form");
        this.nameInput = document.getElementById("channel-create-name");
        this.submit = document.getElementById("channel-create-submit");

        document.getElementById("channel-create-backdrop").onclick = () => this.close();
        document.getElementById("channel-create-close").onclick = () => this.close();
        document.getElementById("channel-create-cancel").onclick = () => this.close();
        this.form.onsubmit = (event) => this.submitForm(event);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return this.modal && this.modal.classList.contains("open");
    },

    open() {
        if (!this.modal) return;
        this.reset();
        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        this.nameInput.focus();
    },

    close() {
        if (!this.isOpen()) return;
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
    },

    reset() {
        this.form.reset();
        UI.hideError("channel-create-error");
        this.submit.disabled = false;
    },

    async submitForm(event) {
        event.preventDefault();
        const name = this.nameInput.value.trim();
        if (!name) {
            UI.showError("channel-create-error", "Введите название канала");
            this.nameInput.focus();
            return;
        }

        this.submit.disabled = true;
        UI.hideError("channel-create-error");
        try {
            const chat = await API.createChannel(name);
            this.close();
            this.reset();
            UI.toast("Канал создан");
            if (this.onCreated) await this.onCreated(chat);
        } catch (err) {
            UI.showError("channel-create-error", err.message);
        } finally {
            this.submit.disabled = false;
        }
    }
};

// ==========================================
// Каталог каналов
// ==========================================

export const ChannelCatalog = {
    onOpen: null,
    onChanged: null,
    channels: [],
    searchSeq: 0,

    init(options = {}) {
        this.onOpen = options.onOpen || null;
        this.onChanged = options.onChanged || null;
        this.modal = document.getElementById("channels-modal");
        if (!this.modal) return;

        this.searchInput = document.getElementById("channels-search");
        this.list = document.getElementById("channels-list");

        document.getElementById("channels-backdrop").onclick = () => this.close();
        document.getElementById("channels-close").onclick = () => this.close();
        this.searchInput.addEventListener(
            "input",
            UI.debounce(() => this.load(), 250)
        );

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.isOpen()) this.close();
        });

        // Канал создали или изменили с другого устройства
        document.addEventListener("messenger:chat-updated", () => {
            if (this.isOpen()) this.load();
        });
    },

    isOpen() {
        return this.modal && this.modal.classList.contains("open");
    },

    async open() {
        if (!this.modal) return;
        this.searchInput.value = "";
        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        this.searchInput.focus();
        await this.load();
    },

    close() {
        if (!this.isOpen()) return;
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
    },

    async load() {
        const seq = ++this.searchSeq;
        const query = this.searchInput.value.trim();
        this.list.innerHTML = "";
        this.list.appendChild(UI.el("li", "channel-empty", "Загрузка…"));

        try {
            const { channels } = await API.getChannels(query);
            if (seq !== this.searchSeq) return;
            this.channels = channels;
            this.render();
        } catch (err) {
            if (seq !== this.searchSeq) return;
            this.list.innerHTML = "";
            this.list.appendChild(UI.el("li", "channel-empty", err.message));
        }
    },

    render() {
        this.list.innerHTML = "";
        if (!this.channels.length) {
            this.list.appendChild(UI.el(
                "li",
                "channel-empty",
                this.searchInput.value.trim()
                    ? "Каналы не найдены"
                    : "Каналов пока нет"
            ));
            return;
        }

        for (const channel of this.channels) {
            const item = UI.el("li", "channel-item");
            item.appendChild(UI.avatar(
                channel.title,
                channel.avatar_url,
                "avatar avatar-lg channel-item-avatar"
            ));

            const body = UI.el("div", "channel-item-body");
            body.appendChild(UI.el("div", "channel-item-title", channel.title));
            body.appendChild(UI.el(
                "div",
                "channel-item-sub",
                UI.subscribersLabel(channel.members_count)
            ));
            item.appendChild(body);

            const actions = UI.el("div", "channel-item-actions");
            const open = UI.el("button", "channel-open-btn", "Открыть");
            open.type = "button";
            open.onclick = (event) => {
                event.stopPropagation();
                this.openChannel(channel);
            };
            actions.appendChild(open);

            // Владелец и так подписан на свой канал — отписываться нельзя
            if (channel.owner_id !== Session.userId()) {
                const subscribe = UI.el(
                    "button",
                    "channel-subscribe-btn" + (channel.is_subscribed ? " subscribed" : ""),
                    channel.is_subscribed ? "Отписаться" : "Подписаться"
                );
                subscribe.type = "button";
                subscribe.onclick = (event) => {
                    event.stopPropagation();
                    this.toggle(channel, subscribe);
                };
                actions.appendChild(subscribe);
            }
            item.appendChild(actions);

            item.onclick = () => this.openChannel(channel);
            this.list.appendChild(item);
        }
    },

    async toggle(channel, button) {
        button.disabled = true;
        try {
            const updated = await toggleSubscription(
                channel.id,
                channel.is_subscribed
            );
            Object.assign(channel, updated);
            this.render();
            if (this.onChanged) await this.onChanged(updated);
        } catch (err) {
            UI.toast(err.message);
        } finally {
            button.disabled = false;
        }
    },

    openChannel(channel) {
        this.close();
        if (this.onOpen) this.onOpen(channel);
    }
};

// ==========================================
// Панель канала
// ==========================================

export const ChannelInfo = {
    chatId: null,
    ownerId: null,
    subscribed: false,
    onChanged: null,
    onSubscribed: null,

    init(options = {}) {
        this.onChanged = options.onChanged || null;
        this.onSubscribed = options.onSubscribed || null;

        this.root = document.getElementById("channel-info");
        if (!this.root) return;

        this.avatar = document.getElementById("channel-info-avatar");
        this.nameEl = document.getElementById("channel-info-name");
        this.countEl = document.getElementById("channel-info-count");
        this.nameInput = document.getElementById("channel-name-input");
        this.avatarInput = document.getElementById("channel-avatar-input");
        this.subscribeBtn = document.getElementById("channel-subscribe-btn");
        this.editBlock = document.getElementById("channel-edit");

        document.getElementById("channel-info-close").onclick = () => this.close();
        const backdrop = document.getElementById("channel-info-backdrop");
        if (backdrop) backdrop.onclick = () => this.close();
        document.getElementById("channel-name-save").onclick = () => this.saveName();
        document.getElementById("channel-avatar-btn").onclick = () =>
            this.avatarInput.click();
        this.avatarInput.onchange = (event) => this.uploadAvatar(event.target);
        this.subscribeBtn.onclick = () => this.toggleSubscription();

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.isOpen()) this.close();
        });

        document.addEventListener("messenger:chat-updated", (event) => {
            const data = event.detail || {};
            if (!this.isOpen() || Number(data.chat_id) !== this.chatId) return;
            this.refresh();
        });
    },

    isOpen() {
        return this.root && this.root.classList.contains("open");
    },

    async open(chatId, chatData = {}) {
        if (!this.root) return;

        this.chatId = Number(chatId);
        if (!Number.isInteger(this.chatId) || this.chatId <= 0) return;

        this.updateHeader(chatData);
        UI.hideError("channel-info-error");
        this.root.classList.add("open");
        this.root.setAttribute("aria-hidden", "false");
        const main = document.getElementById("chat-main");
        if (main) main.classList.add("with-panel");
        await this.refresh();
    },

    close() {
        if (!this.isOpen()) return;
        this.root.classList.remove("open");
        this.root.setAttribute("aria-hidden", "true");
        const main = document.getElementById("chat-main");
        if (main) main.classList.remove("with-panel");
        this.chatId = null;
    },

    updateHeader(chat = {}) {
        const title = chat.title || "Канал";
        this.ownerId = chat.owner_id ?? null;
        this.subscribed = Boolean(chat.is_subscribed);
        const isOwner = this.ownerId === Session.userId();

        this.nameEl.textContent = title;
        UI.setAvatar(this.avatar, title, chat.avatar_url || null);
        if (document.activeElement !== this.nameInput) {
            this.nameInput.value = title;
        }
        this.countEl.textContent = chat.members_count === undefined
            || chat.members_count === null
            ? ""
            : UI.subscribersLabel(chat.members_count);

        // Владелец не может отписаться от собственного канала
        this.subscribeBtn.classList.toggle("hidden", isOwner);
        this.subscribeBtn.textContent = this.subscribed ? "Отписаться" : "Подписаться";
        this.subscribeBtn.classList.toggle("subscribed", this.subscribed);
        this.editBlock.classList.toggle("hidden", !isOwner);
        document.getElementById("channel-avatar-btn").classList.toggle(
            "hidden",
            !isOwner
        );
    },

    async refresh() {
        try {
            const chat = await API.getChannel(this.chatId);
            if (!this.isOpen() || chat.id !== this.chatId) return;
            this.updateHeader(chat);
        } catch (err) {
            if (this.isOpen()) UI.showError("channel-info-error", err.message);
        }
    },

    async toggleSubscription() {
        const chatId = this.chatId;
        if (!chatId) return;

        this.subscribeBtn.disabled = true;
        UI.hideError("channel-info-error");
        try {
            const chat = await toggleSubscription(chatId, this.subscribed);
            if (chat.id === this.chatId) this.updateHeader(chat);
            UI.toast(this.subscribed ? "Вы подписались" : "Вы отписались");
            if (this.onChanged) await this.onChanged(chat);
            if (this.onSubscribed) await this.onSubscribed(chat);
        } catch (err) {
            UI.showError("channel-info-error", err.message);
        } finally {
            this.subscribeBtn.disabled = false;
        }
    },

    async saveName() {
        const name = this.nameInput.value.trim();
        if (!name) {
            UI.showError("channel-info-error", "Введите название канала");
            return;
        }

        const button = document.getElementById("channel-name-save");
        button.disabled = true;
        UI.hideError("channel-info-error");
        try {
            const chat = await API.updateChat(this.chatId, { name });
            this.updateHeader(chat);
            UI.toast("Название изменено");
            if (this.onChanged) await this.onChanged(chat);
        } catch (err) {
            UI.showError("channel-info-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    async uploadAvatar(input) {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            UI.showError("channel-info-error", "Можно загружать только изображения");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            UI.showError("channel-info-error", "Файл больше 5 МБ");
            return;
        }

        const button = document.getElementById("channel-avatar-btn");
        button.disabled = true;
        UI.hideError("channel-info-error");
        try {
            const chat = await API.updateChat(this.chatId, { file });
            this.updateHeader(chat);
            UI.toast("Аватар канала обновлён");
            if (this.onChanged) await this.onChanged(chat);
        } catch (err) {
            UI.showError("channel-info-error", err.message);
        } finally {
            button.disabled = false;
        }
    }
};

// Общая кнопка подписки под лентой канала.
export const ChannelBar = {
    onChanged: null,
    chatId: null,
    subscribed: false,

    init(options = {}) {
        this.onChanged = options.onChanged || null;
        this.root = document.getElementById("channel-subscribe-bar");
        if (!this.root) return;
        this.title = document.getElementById("channel-subscribe-title");
        this.hint = document.getElementById("channel-subscribe-hint");
        this.button = document.getElementById("channel-subscribe-toggle");
        this.button.onclick = () => this.toggle();
    },

    show({ chatId, title, subscribed, isOwner }) {
        if (!this.root) return;
        this.chatId = chatId;
        this.subscribed = Boolean(subscribed);
        // Владелец публикует посты — подписываться ему не нужно
        this.root.classList.toggle("hidden", Boolean(isOwner));
        this.title.textContent = title || "Канал";
        this.hint.textContent = this.subscribed
            ? "Вы подписаны на новые посты"
            : "Подпишитесь, чтобы получать новые посты";
        this.button.textContent = this.subscribed ? "Отписаться" : "Подписаться";
        this.button.classList.toggle("subscribed", this.subscribed);
    },

    hide() {
        if (this.root) this.root.classList.add("hidden");
        this.chatId = null;
    },

    async toggle() {
        if (!this.chatId) return;
        this.button.disabled = true;
        try {
            const chat = await toggleSubscription(this.chatId, this.subscribed);
            this.show({
                chatId: chat.id,
                title: chat.title,
                subscribed: chat.is_subscribed,
                isOwner: chat.owner_id === Session.userId()
            });
            UI.toast(chat.is_subscribed ? "Вы подписались" : "Вы отписались");
            if (this.onChanged) await this.onChanged(chat);
        } catch (err) {
            UI.toast(err.message);
        } finally {
            this.button.disabled = false;
        }
    }
};
