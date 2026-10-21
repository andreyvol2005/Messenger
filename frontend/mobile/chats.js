// Мобильная версия: список чатов на весь экран, тап — переход на отдельную страницу чата.

const MobileChats = {
    async init() {
        if (!Session.requireAuth()) return;

        document.getElementById("logout-btn").onclick = () => Session.logout();
        document.getElementById("new-chat-form").onsubmit = (e) => this.createChat(e);

        const searchInput = document.getElementById("new-chat-username");
        searchInput.addEventListener("input", UI.debounce(() => this.searchUsers(), 250));
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                this.clearSearch();
                searchInput.blur();
            }
        });

        // Список сам обновляется, когда в любом чате появляется сообщение
        Realtime.connect(() => this.refreshList());

        await this.loadChats();
    },

    showChatList() {
        document.getElementById("chat-list").classList.remove("hidden");
    },

    hideChatList() {
        document.getElementById("chat-list").classList.add("hidden");
    },

    clearSearch() {
        document.getElementById("new-chat-username").value = "";
        this.hideSearchResults();
        UI.hideError("new-chat-error");
        this.showChatList();
    },

    hideSearchResults() {
        const results = document.getElementById("user-search-results");
        results.classList.add("hidden");
        results.innerHTML = "";
    },

    async createChat(e) {
        e.preventDefault();
        const input = document.getElementById("new-chat-username");
        const username = input.value.trim();
        const error = Validation.username(username);
        if (error) {
            UI.showError("new-chat-error", error);
            return;
        }
        await this.openChat(username);
    },

    async openChat(username) {
        const handle = (username || "").replace(/^@/, "").trim();

        try {
            const chat = await API.createChat(handle);
            this.clearSearch();
            window.location.href = Session.chatUrl(chat.id);
        } catch (err) {
            UI.showError("new-chat-error", err.message);
        }
    },

    async searchUsers() {
        const input = document.getElementById("new-chat-username");
        const query = input.value.trim();
        const results = document.getElementById("user-search-results");

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
            if (input.value.trim() !== query) return;

            results.innerHTML = "";
            if (!users.length) {
                results.appendChild(UI.el("li", "user-search-empty", "Никого не найдено"));
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

                    item.onclick = () => this.openChat(user.username);
                    results.appendChild(item);
                }
            }
            results.classList.remove("hidden");
        } catch (err) {
            if (input.value.trim() === query) {
                this.hideSearchResults();
                this.showChatList();
            }
        }
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

                const avatar = UI.el("div", "m-avatar", chat.is_favorites ? "★" : this.initials(chat.title));
                if (chat.is_favorites) avatar.classList.add("m-avatar-fav");

                const body = UI.el("div", "m-chat-body");
                const top = UI.el("div", "m-chat-top");
                top.appendChild(UI.el("div", "m-chat-title", chat.title));
                body.appendChild(top);
                body.appendChild(UI.el("div", "m-chat-preview", chat.last_message || "Нет сообщений"));

                item.append(avatar, body);
                item.onclick = () => { window.location.href = Session.chatUrl(chat.id); };
                list.appendChild(item);
            }
        } catch (err) {
            list.appendChild(UI.el("li", "m-loading", err.message));
        }
    },

    // Первая буква ника для аватарки-инициала
    initials(title) {
        return (title || "?").trim().charAt(0).toUpperCase() || "?";
    }
};

MobileChats.refreshList = UI.debounce(() => MobileChats.loadChats());

document.addEventListener("DOMContentLoaded", () => MobileChats.init());