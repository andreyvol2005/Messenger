// Поиск пользователей и создание личного чата. Разметка и id одинаковые
// в десктопной и мобильной версиях, отличается только переход после создания.

import { API } from "./api.js";
import { UI } from "./ui.js";
import { Validation } from "./validation.js";

export const UserSearch = {
    onChatCreated: null,

    init(onChatCreated) {
        this.onChatCreated = onChatCreated;
        this.form = document.getElementById("new-chat-form");
        this.input = document.getElementById("new-chat-username");
        this.results = document.getElementById("user-search-results");

        this.form.onsubmit = (e) => this.createChat(e);

        this.input.addEventListener("input", UI.debounce(() => this.searchUsers(), 250));
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                this.clearSearch();
                this.input.blur();
            }
        });
    },

    showChatList() {
        document.getElementById("chat-list").classList.remove("hidden");
    },

    hideChatList() {
        document.getElementById("chat-list").classList.add("hidden");
    },

    clearSearch() {
        this.input.value = "";
        this.hideSearchResults();
        UI.hideError("new-chat-error");
        this.showChatList();
    },

    hideSearchResults() {
        this.results.classList.add("hidden");
        this.results.innerHTML = "";
    },

    async createChat(e) {
        e.preventDefault();
        const username = this.input.value.trim();
        const error = Validation.username(username);
        if (error) {
            UI.showError("new-chat-error", error);
            return;
        }
        await this.createChatWith(username);
    },

    async createChatWith(username) {
        const handle = (username || "").replace(/^@/, "").trim();

        try {
            const chat = await API.createChat(handle);
            this.clearSearch();
            if (this.onChatCreated) await this.onChatCreated(chat);
        } catch (err) {
            UI.showError("new-chat-error", err.message);
        }
    },

    async searchUsers() {
        const query = this.input.value.trim();

        if (!query) {
            this.hideSearchResults();
            UI.hideError("new-chat-error");
            this.showChatList();
            return;
        }

        this.hideChatList();
        if (query.includes("@")) {
            this.hideSearchResults();
            UI.showError("new-chat-error", "Пишите имя пользователя без символа @");
            return;
        }

        UI.hideError("new-chat-error");

        try {
            const users = await API.searchUsers(query);
            // Пока шёл запрос, пользователь мог изменить строку
            if (this.input.value.trim() !== query) return;

            this.results.innerHTML = "";
            if (!users.length) {
                this.results.appendChild(UI.el("li", "user-search-empty", "Никого не найдено"));
            } else {
                for (const user of users) {
                    const item = UI.el("li", "user-search-item");
                    item.appendChild(
                        UI.el("div", "user-search-avatar", UI.initial(user.nickname))
                    );

                    const text = UI.el("div", "user-search-text");
                    text.appendChild(UI.el("div", "user-search-name", user.nickname));
                    text.appendChild(UI.el("div", "user-search-username", user.username));
                    item.appendChild(text);

                    item.onclick = () => this.createChatWith(user.username);
                    this.results.appendChild(item);
                }
            }
            this.results.classList.remove("hidden");
        } catch (err) {
            if (this.input.value.trim() === query) {
                this.hideSearchResults();
                this.showChatList();
            }
        }
    }
};
