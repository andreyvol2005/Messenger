// Контакты: только явно сохранённые записи из таблицы contacts.

import { API } from "../shared/api.js";
import { UI } from "../shared/ui.js";
import { Validation } from "../shared/validation.js";
import { Chat } from "./chat.js";

export const Contacts = {
    contacts: [],

    init() {
        this.modal = document.getElementById("contacts-modal");
        this.list = document.getElementById("contacts-list");
        this.addForm = document.getElementById("contact-add-form");
        this.searchInput = document.getElementById("contact-search");
        this.searchResults = document.getElementById("contact-search-results");

        document.getElementById("contacts-backdrop").onclick = () => this.close();
        document.getElementById("contacts-close").onclick = () => this.close();
        document.getElementById("contacts-add-toggle").onclick = () => this.toggleAddForm();
        this.addForm.onsubmit = (e) => this.addFromInput(e);
        this.searchInput.addEventListener("input", UI.debounce(() => this.searchUsers(), 250));

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || !this.isOpen()) return;
            // Сначала закрываем форму добавления, потом уже весь экран
            if (!this.addForm.classList.contains("hidden")) {
                this.resetAddForm();
                return;
            }
            this.close();
        });

        // Аватарку контакта обновили через WebSocket — перерисовываем список
        document.addEventListener("messenger:avatar-updated", (event) => {
            const data = event.detail || {};
            let changed = false;
            for (const contact of this.contacts) {
                if (contact.id === Number(data.user_id)) {
                    contact.avatar_url = data.avatar_url;
                    changed = true;
                }
            }
            if (changed && this.isOpen()) this.render();
        });
    },

    isOpen() {
        return this.modal.classList.contains("open");
    },

    async open() {
        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        this.resetAddForm();
        document.getElementById("contacts-close").focus();
        await this.load();
    },

    close() {
        if (!this.isOpen()) return;
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
        this.resetAddForm();
    },

    async load() {
        this.list.innerHTML = "";
        this.list.appendChild(UI.el("li", "loading", "Загрузка…"));
        UI.hideError("contacts-error");

        try {
            const contacts = await API.getContacts();
            // localeCompare даёт нормальный алфавитный порядок для русского
            this.contacts = contacts.slice().sort((a, b) =>
                a.nickname.localeCompare(b.nickname, "ru", { sensitivity: "base" })
            );
            this.render();
        } catch (err) {
            this.list.innerHTML = "";
            this.list.appendChild(UI.el("li", "contacts-empty", "Не удалось загрузить контакты"));
            UI.showError("contacts-error", err.message);
        }
    },

    render() {
        this.list.innerHTML = "";

        if (!this.contacts.length) {
            this.list.appendChild(UI.el(
                "li",
                "contacts-empty",
                "Контактов пока нет. Нажмите «Добавить контакт»."
            ));
            return;
        }

        for (const user of this.contacts) {
            const item = UI.el("li", "contact-item");
            item.appendChild(
                UI.avatar(user.nickname, user.avatar_url, "avatar avatar-lg")
            );

            const text = UI.el("div", "contact-text");
            text.appendChild(UI.el("div", "contact-name", user.nickname));
            text.appendChild(UI.el("div", "contact-username", user.username));
            item.appendChild(text);

            item.onclick = () => this.openChat(user.username);
            this.list.appendChild(item);
        }
    },

    async openChat(username) {
        const handle = (username || "").replace(/^@/, "").trim();

        try {
            const chat = await API.createChat(handle);
            this.close();
            await Chat.openChat(
                chat.id,
                chat.title,
                chat.peer_username,
                chat.is_contact,
                chat.avatar_url
            );
        } catch (err) {
            UI.showError("contacts-error", err.message);
        }
    },

    toggleAddForm() {
        const willShow = this.addForm.classList.contains("hidden");
        this.addForm.classList.toggle("hidden", !willShow);
        UI.hideError("contacts-error");

        if (willShow) {
            this.searchInput.focus();
        } else {
            this.resetAddForm();
        }
    },

    resetAddForm() {
        this.addForm.classList.add("hidden");
        this.searchInput.value = "";
        this.hideSearchResults();
        UI.hideError("contacts-error");
    },

    hideSearchResults() {
        this.searchResults.classList.add("hidden");
        this.searchResults.innerHTML = "";
    },

    async addFromInput(e) {
        e.preventDefault();
        await this.addContact(this.searchInput.value);
    },

    async addContact(username) {
        const handle = (username || "").replace(/^@/, "").trim();
        const error = Validation.username(handle);
        if (error) {
            UI.showError("contacts-error", error);
            return;
        }

        try {
            await API.addContact(handle);
            this.resetAddForm();
            UI.toast("Контакт добавлен");
            Chat.markContactAdded(handle);
            await this.load();
        } catch (err) {
            UI.showError("contacts-error", err.message);
        }
    },

    async searchUsers() {
        const query = this.searchInput.value.trim();

        if (!query) {
            this.hideSearchResults();
            UI.hideError("contacts-error");
            return;
        }

        if (query.includes("@")) {
            this.hideSearchResults();
            UI.showError("contacts-error", "Пишите имя пользователя без символа @");
            return;
        }

        UI.hideError("contacts-error");

        try {
            const users = await API.searchUsers(query);
            if (this.searchInput.value.trim() !== query) return;

            const existing = new Set(this.contacts.map((user) => user.username));
            const matches = users.filter((user) => !existing.has(user.username));

            this.searchResults.innerHTML = "";
            if (!matches.length) {
                this.searchResults.appendChild(
                    UI.el("li", "user-search-empty", "Никого не найдено")
                );
            } else {
                for (const user of matches) {
                    const item = UI.el("li", "user-search-item");
                    item.appendChild(
                        UI.avatar(user.nickname, user.avatar_url, "user-search-avatar")
                    );

                    const text = UI.el("div", "user-search-text");
                    text.appendChild(UI.el("div", "user-search-name", user.nickname));
                    text.appendChild(UI.el("div", "user-search-username", user.username));
                    item.appendChild(text);

                    item.onclick = () => this.addContact(user.username);
                    this.searchResults.appendChild(item);
                }
            }
            this.searchResults.classList.remove("hidden");
        } catch (err) {
            if (this.searchInput.value.trim() === query) {
                this.hideSearchResults();
                UI.showError("contacts-error", err.message);
            }
        }
    }
};
