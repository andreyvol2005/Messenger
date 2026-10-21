// Мобильная версия: список чатов на весь экран, тап — переход на отдельную страницу чата.

const MobileChats = {
    async init() {
        if (!Session.requireAuth()) return;

        document.getElementById("logout-btn").onclick = () => Session.logout();
        document.getElementById("new-chat-btn").onclick = () => this.toggleNewChatForm();
        document.getElementById("new-chat-form").onsubmit = (e) => this.createChat(e);

        // Список сам обновляется, когда в любом чате появляется сообщение
        Realtime.connect(() => this.refreshList());

        await this.loadChats();
    },

    toggleNewChatForm() {
        const form = document.getElementById("new-chat-form");
        const willShow = form.classList.contains("hidden");
        form.classList.toggle("hidden", !willShow);
        UI.hideError("new-chat-error");
        if (willShow) {
            document.getElementById("new-chat-username").focus();
        }
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

        try {
            await API.createChat(username);
            input.value = "";
            document.getElementById("new-chat-form").classList.add("hidden");
            UI.hideError("new-chat-error");
            await this.loadChats();
        } catch (err) {
            UI.showError("new-chat-error", err.message);
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