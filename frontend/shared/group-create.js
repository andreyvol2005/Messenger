// Создание группового чата: название и мультивыбор пользователей.
// Разметка одинаковая на десктопе и в мобильной версии, отличается только
// контейнер (модальное окно или нижняя панель).

import { API } from "./api.js";
import { UI } from "./ui.js";

export const GroupCreate = {
    onCreated: null,
    users: [],
    selected: new Set(),

    init(options = {}) {
        this.onCreated = options.onCreated || null;
        this.modal = document.getElementById("group-create-modal");
        if (!this.modal) return;

        this.form = document.getElementById("group-create-form");
        this.nameInput = document.getElementById("group-create-name");
        this.searchInput = document.getElementById("group-create-search");
        this.list = document.getElementById("group-create-users");
        this.submit = document.getElementById("group-create-submit");

        document.getElementById("group-create-backdrop").onclick = () => this.close();
        document.getElementById("group-create-close").onclick = () => this.close();
        document.getElementById("group-create-cancel").onclick = () => this.close();
        this.form.onsubmit = (event) => this.submitForm(event);
        this.searchInput.addEventListener("input", () => this.renderUsers());

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return this.modal && this.modal.classList.contains("open");
    },

    async open() {
        if (!this.modal) return;
        this.reset();
        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        this.nameInput.focus();
        await this.loadUsers();
    },

    close() {
        if (!this.isOpen()) return;
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
    },

    reset() {
        this.selected.clear();
        this.users = [];
        this.form.reset();
        this.list.innerHTML = "";
        this.searchInput.value = "";
        UI.hideError("group-create-error");
        this.submit.disabled = false;
    },

    async loadUsers() {
        this.list.innerHTML = "";
        this.list.appendChild(UI.el("li", "group-pick-empty", "Загрузка…"));
        UI.hideError("group-create-error");

        try {
            this.users = await API.getUsers();
            this.renderUsers();
        } catch (err) {
            this.list.innerHTML = "";
            this.list.appendChild(UI.el("li", "group-pick-empty", "Не удалось загрузить пользователей"));
            UI.showError("group-create-error", err.message);
        }
    },

    renderUsers() {
        const query = this.searchInput.value.trim().toLowerCase();
        const matches = this.users.filter((user) => {
            const nickname = (user.nickname || "").toLowerCase();
            const username = (user.username || "").replace(/^@/, "").toLowerCase();
            return !query || nickname.includes(query) || username.includes(query);
        });

        this.list.innerHTML = "";
        if (!matches.length) {
            this.list.appendChild(UI.el(
                "li",
                "group-pick-empty",
                this.users.length ? "Никого не найдено" : "Других пользователей пока нет"
            ));
            return;
        }

        for (const user of matches) {
            const item = UI.el("li", "group-pick-item");
            const label = UI.el("label", "group-pick-label");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = String(user.id);
            checkbox.checked = this.selected.has(user.id);
            checkbox.onchange = () => {
                if (checkbox.checked) this.selected.add(user.id);
                else this.selected.delete(user.id);
            };

            label.appendChild(checkbox);
            label.appendChild(UI.avatar(user.nickname, user.avatar_url, "user-search-avatar"));

            const text = UI.el("div", "user-search-text");
            text.appendChild(UI.el("div", "user-search-name", user.nickname));
            text.appendChild(UI.el("div", "user-search-username", user.username));
            label.appendChild(text);

            item.appendChild(label);
            this.list.appendChild(item);
        }
    },

    async submitForm(event) {
        event.preventDefault();
        const name = this.nameInput.value.trim();

        if (!name) {
            UI.showError("group-create-error", "Введите название группы");
            this.nameInput.focus();
            return;
        }
        if (!this.selected.size) {
            UI.showError("group-create-error", "Выберите хотя бы одного участника");
            return;
        }

        this.submit.disabled = true;
        UI.hideError("group-create-error");
        try {
            const chat = await API.createGroup(name, [...this.selected]);
            this.close();
            this.reset();
            UI.toast("Группа создана");
            if (this.onCreated) await this.onCreated(chat);
        } catch (err) {
            UI.showError("group-create-error", err.message);
        } finally {
            this.submit.disabled = false;
        }
    }
};
