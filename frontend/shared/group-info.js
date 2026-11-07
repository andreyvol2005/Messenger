// Панель группы: участники, смена названия и аватара, добавление и удаление.
// Один модуль на десктоп и мобильную версию: разметка с одинаковыми id,
// а внешний вид задаётся классами контейнера в CSS.

import { API } from "./api.js";
import { Presence } from "./presence.js";
import { Session } from "./session.js";
import { UI } from "./ui.js";

export const GroupInfo = {
    chatId: null,
    members: [],
    contacts: [],
    candidates: [],
    searchSeq: 0,
    onChanged: null,
    onRemovedSelf: null,

    init(options = {}) {
        this.onChanged = options.onChanged || null;
        this.onRemovedSelf = options.onRemovedSelf || null;

        this.root = document.getElementById("group-info");
        if (!this.root) return;

        this.avatar = document.getElementById("group-info-avatar");
        this.nameEl = document.getElementById("group-info-name");
        this.countEl = document.getElementById("group-info-count");
        this.nameInput = document.getElementById("group-name-input");
        this.membersList = document.getElementById("group-members-list");
        this.candidatesList = document.getElementById("group-add-results");
        this.searchInput = document.getElementById("group-add-search");
        this.avatarInput = document.getElementById("group-avatar-input");

        document.getElementById("group-info-close").onclick = () => this.close();
        const backdrop = document.getElementById("group-info-backdrop");
        if (backdrop) backdrop.onclick = () => this.close();
        document.getElementById("group-name-save").onclick = () => this.saveName();
        document.getElementById("group-avatar-btn").onclick = () =>
            this.avatarInput.click();
        this.avatarInput.onchange = (event) => this.uploadAvatar(event.target);
        this.searchInput.addEventListener(
            "input",
            UI.debounce(() => this.searchCandidates(), 250)
        );

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.isOpen()) this.close();
        });

        // Группу изменили с другого устройства или другой участник
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
        this.nameInput.value = chatData.title || "";
        this.searchInput.value = "";
        this.candidatesList.classList.add("hidden");
        this.candidatesList.innerHTML = "";
        UI.hideError("group-info-error");

        this.root.classList.add("open");
        this.root.setAttribute("aria-hidden", "false");
        const main = document.getElementById("chat-main");
        if (main) main.classList.add("with-panel");
        this.membersList.innerHTML = "";
        this.membersList.appendChild(UI.el("li", "group-members-empty", "Загрузка…"));

        await this.loadMembers();
        await this.loadDefaultCandidates();
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
        const title = chat.title || "Группа";
        this.nameEl.textContent = title;
        UI.setAvatar(this.avatar, title, chat.avatar_url || null);
        if (document.activeElement !== this.nameInput) {
            this.nameInput.value = title;
        }
        this.setCount(chat.members_count);
    },

    setCount(count) {
        if (count === undefined || count === null) {
            this.countEl.textContent = "";
            return;
        }
        this.countEl.textContent = UI.membersLabel(count);
    },

    async refresh() {
        // Список чатов — источник правды: если группа пропала, пользователя
        // удалили из участников, и панель нужно закрыть.
        try {
            const { chats } = await API.getChats();
            const found = chats.find((chat) => chat.id === this.chatId);
            if (!found) {
                this.close();
                if (this.onRemovedSelf) this.onRemovedSelf();
                return;
            }
            this.updateHeader(found);
            await this.loadMembers();
        } catch (err) {
            if (this.isOpen()) UI.showError("group-info-error", err.message);
        }
    },

    async loadMembers() {
        try {
            this.members = await API.getChatMembers(this.chatId);
            this.renderMembers();
            this.setCount(this.members.length);
        } catch (err) {
            this.membersList.innerHTML = "";
            this.membersList.appendChild(
                UI.el("li", "group-members-empty", "Не удалось загрузить участников")
            );
            UI.showError("group-info-error", err.message);
        }
    },

    renderMembers() {
        this.membersList.innerHTML = "";
        if (!this.members.length) {
            this.membersList.appendChild(
                UI.el("li", "group-members-empty", "В группе пока нет участников")
            );
            return;
        }

        for (const member of this.members) {
            const item = UI.el("li", "group-member");
            const avatar = UI.avatar(
                member.nickname,
                member.avatar_url,
                "avatar group-member-avatar"
            );
            Presence.attach(avatar, member.id);
            item.appendChild(avatar);

            const text = UI.el("div", "group-member-text");
            text.appendChild(UI.el("div", "group-member-name", member.nickname));
            text.appendChild(UI.el(
                "div",
                "group-member-username",
                member.username || ""
            ));
            item.appendChild(text);

            const isSelf = member.id === Session.userId();
            const remove = UI.el(
                "button",
                "group-member-remove",
                isSelf ? "Выйти" : "Удалить"
            );
            remove.type = "button";
            remove.title = isSelf ? "Выйти из группы" : "Удалить из группы";
            remove.onclick = () => this.removeMember(member, item);
            item.appendChild(remove);

            this.membersList.appendChild(item);
        }
    },

    async loadDefaultCandidates() {
        try {
            this.contacts = await API.getContacts();
            this.renderCandidates(this.contacts);
        } catch (err) {
            // Без контактов всё равно работает поиск через /api/users
            this.contacts = [];
            this.renderCandidates([]);
        }
    },

    async searchCandidates() {
        const query = this.searchInput.value.trim();
        if (!query) {
            this.renderCandidates(this.contacts);
            return;
        }

        const seq = ++this.searchSeq;
        UI.hideError("group-info-error");
        try {
            const users = await API.searchUsers(query);
            if (seq !== this.searchSeq) return;
            this.renderCandidates(users);
        } catch (err) {
            if (seq !== this.searchSeq) return;
            this.candidatesList.innerHTML = "";
            this.candidatesList.appendChild(
                UI.el("li", "user-search-empty", err.message)
            );
            this.candidatesList.classList.remove("hidden");
        }
    },

    renderCandidates(users) {
        const memberIds = new Set(this.members.map((member) => member.id));
        this.candidates = users.filter((user) => !memberIds.has(user.id));

        this.candidatesList.innerHTML = "";
        if (!this.candidates.length) {
            this.candidatesList.appendChild(UI.el(
                "li",
                "user-search-empty",
                this.searchInput.value.trim()
                    ? "Никого не найдено"
                    : "Нет доступных пользователей"
            ));
        } else {
            for (const user of this.candidates) {
                const item = UI.el("li", "user-search-item group-candidate");
                item.appendChild(
                    UI.avatar(user.nickname, user.avatar_url, "user-search-avatar")
                );

                const text = UI.el("div", "user-search-text");
                text.appendChild(UI.el("div", "user-search-name", user.nickname));
                text.appendChild(UI.el("div", "user-search-username", user.username));
                item.appendChild(text);

                const add = UI.el("button", "group-candidate-add", "Добавить");
                add.type = "button";
                add.onclick = () => this.addMember(user, add);
                item.appendChild(add);

                this.candidatesList.appendChild(item);
            }
        }
        this.candidatesList.classList.remove("hidden");
    },

    async addMember(user, button) {
        button.disabled = true;
        UI.hideError("group-info-error");
        try {
            await API.addChatMember(this.chatId, user.id);
            UI.toast("Участник добавлен");
            await this.loadMembers();
            this.renderCandidates(
                this.searchInput.value.trim() ? this.candidates : this.contacts
            );
            if (this.onChanged) await this.onChanged({ chatId: this.chatId });
        } catch (err) {
            UI.showError("group-info-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    async removeMember(member, item) {
        const isSelf = member.id === Session.userId();
        const question = isSelf
            ? "Выйти из группы?"
            : `Удалить ${member.nickname} из группы?`;
        if (!confirm(question)) return;

        const button = item.querySelector(".group-member-remove");
        if (button) button.disabled = true;
        UI.hideError("group-info-error");
        try {
            await API.removeChatMember(this.chatId, member.id);
            if (isSelf) {
                this.close();
                UI.toast("Вы вышли из группы");
                if (this.onRemovedSelf) this.onRemovedSelf();
                return;
            }
            await this.loadMembers();
            this.renderCandidates(
                this.searchInput.value.trim() ? this.candidates : this.contacts
            );
            if (this.onChanged) await this.onChanged({ chatId: this.chatId });
        } catch (err) {
            UI.showError("group-info-error", err.message);
        } finally {
            if (button) button.disabled = false;
        }
    },

    async saveName() {
        const name = this.nameInput.value.trim();
        if (!name) {
            UI.showError("group-info-error", "Введите название группы");
            return;
        }

        const button = document.getElementById("group-name-save");
        button.disabled = true;
        UI.hideError("group-info-error");
        try {
            const chat = await API.updateChat(this.chatId, { name });
            this.updateHeader(chat);
            UI.toast("Название изменено");
            if (this.onChanged) await this.onChanged(chat);
        } catch (err) {
            UI.showError("group-info-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    async uploadAvatar(input) {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            UI.showError("group-info-error", "Можно загружать только изображения");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            UI.showError("group-info-error", "Файл больше 5 МБ");
            return;
        }

        const button = document.getElementById("group-avatar-btn");
        button.disabled = true;
        UI.hideError("group-info-error");
        try {
            const chat = await API.updateChat(this.chatId, { file });
            this.updateHeader(chat);
            UI.toast("Аватар группы обновлён");
            if (this.onChanged) await this.onChanged(chat);
        } catch (err) {
            UI.showError("group-info-error", err.message);
        } finally {
            button.disabled = false;
        }
    }
};
