// ============================
// Конфигурация
// ============================
const CONFIG = {
    API_BASE: "",
    // Виртуальный чат: на бэке он соответствует chat_id = NULL, is_favorite = true
    FAVORITES_CHAT_ID: -1,
    STORAGE: {
        TOKEN: "messenger_token",
        USER_ID: "messenger_user_id",
        NICKNAME: "messenger_nickname"
    },
    PAGES: {
        AUTH: "pages/auth.html",
        CHAT: "pages/chat.html"
    },
    ENDPOINTS: {
        REGISTER: "/api/register",
        LOGIN: "/api/login",
        USERS: "/api/users",
        CHATS: "/api/chats"
    }
};

// ============================
// API — работа с сервером
// ============================
const API = {
    async request(url, options = {}) {
        const headers = { "Content-Type": "application/json" };
        const token = localStorage.getItem(CONFIG.STORAGE.TOKEN);
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const response = await fetch(CONFIG.API_BASE + url, {
            headers,
            ...options,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) Auth.logout();
            throw new Error(data.detail || `HTTP ${response.status}`);
        }
        return data;
    },

    register(nickname, password) {
        return this.request(CONFIG.ENDPOINTS.REGISTER, {
            method: "POST",
            body: JSON.stringify({ nickname, password })
        });
    },

    login(nickname, password) {
        return this.request(CONFIG.ENDPOINTS.LOGIN, {
            method: "POST",
            body: JSON.stringify({ nickname, password })
        });
    },

    getUsers() {
        return this.request(CONFIG.ENDPOINTS.USERS);
    },

    getChats() {
        return this.request(CONFIG.ENDPOINTS.CHATS);
    },

    createChat(nickname) {
        return this.request(CONFIG.ENDPOINTS.CHATS, {
            method: "POST",
            body: JSON.stringify({ nickname })
        });
    },

    getMessages(chatId, limit = 50) {
        return this.request(`/api/messages/${chatId}?limit=${limit}`);
    },

    sendMessage(chatId, text) {
        return this.request("/api/messages", {
            method: "POST",
            body: JSON.stringify({ chat_id: chatId, text })
        });
    },

    toggleFavorite(messageId) {
        return this.request(`/api/messages/${messageId}/favorite`, { method: "POST" });
    }
};

// ============================
// Auth — логика авторизации
// ============================
const Auth = {
    mode: "login",

    init() {
        document.getElementById("tab-login").onclick = () => this.setMode("login");
        document.getElementById("tab-register").onclick = () => this.setMode("register");
        document.getElementById("auth-form").onsubmit = (e) => this.submit(e);
    },

    setMode(mode) {
        this.mode = mode;
        const isLogin = mode === "login";
        document.getElementById("tab-login").classList.toggle("active", isLogin);
        document.getElementById("tab-register").classList.toggle("active", !isLogin);
        document.getElementById("auth-submit").textContent =
            isLogin ? "Войти" : "Зарегистрироваться";
        document.getElementById("password").autocomplete =
            isLogin ? "current-password" : "new-password";
        this.hideError();
    },

    async submit(e) {
        e.preventDefault();
        const nickname = document.getElementById("nickname").value.trim();
        const password = document.getElementById("password").value;

        try {
            if (this.mode === "register") {
                await API.register(nickname, password);
                alert("Успешно! Теперь войдите.");
                this.setMode("login");
            } else {
                const data = await API.login(nickname, password);
                this.saveSession(data);
                await Main.showChat();
            }
        } catch (err) {
            this.showError(err.message);
        }
    },

    saveSession(data) {
        localStorage.setItem(CONFIG.STORAGE.TOKEN, data.access_token);
        localStorage.setItem(CONFIG.STORAGE.USER_ID, data.user_id);
        localStorage.setItem(CONFIG.STORAGE.NICKNAME, data.nickname);
    },

    logout() {
        localStorage.clear();
        Main.showAuth();
    },

    showError(msg) {
        const el = document.getElementById("auth-error");
        el.textContent = msg;
        el.classList.remove("hidden");
    },

    hideError() {
        document.getElementById("auth-error").classList.add("hidden");
    }
};

// ============================
// Chat — список чатов и сообщения
// ============================
const Chat = {
    currentChatId: null,

    async init() {
        document.getElementById("logout-btn").onclick = () => Auth.logout();
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        document.getElementById("new-chat-btn").onclick = () => this.toggleNewChatForm();
        document.getElementById("new-chat-form").onsubmit = (e) => this.createChat(e);

        const nickname = localStorage.getItem(CONFIG.STORAGE.NICKNAME);
        document.getElementById("current-user").textContent = nickname || "?";

        await this.loadChats();
    },

    toggleNewChatForm() {
        const form = document.getElementById("new-chat-form");
        const willShow = form.classList.contains("hidden");
        form.classList.toggle("hidden", !willShow);
        if (willShow) {
            document.getElementById("new-chat-nickname").focus();
        } else {
            this.hideNewChatError();
        }
    },

    hideNewChatError() {
        document.getElementById("new-chat-error").classList.add("hidden");
    },

    async createChat(e) {
        e.preventDefault();
        const input = document.getElementById("new-chat-nickname");
        const nickname = input.value.trim();
        if (!nickname) return;

        const errorEl = document.getElementById("new-chat-error");
        try {
            const chat = await API.createChat(nickname);
            input.value = "";
            document.getElementById("new-chat-form").classList.add("hidden");
            errorEl.classList.add("hidden");
            await this.openChat(chat.id, chat.title);
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove("hidden");
        }
    },

    async loadChats() {
        const list = document.getElementById("chat-list");
        list.innerHTML = '<li class="chat-item loading-item">Загрузка…</li>';

        try {
            const { chats } = await API.getChats();
            list.innerHTML = "";

            if (!chats.length) {
                list.innerHTML = '<li class="chat-item loading-item">Пока нет чатов</li>';
                return;
            }

            for (const chat of chats) {
                const item = document.createElement("li");
                item.className = "chat-item";
                if (chat.id === this.currentChatId) item.classList.add("active");

                const title = document.createElement("div");
                title.className = "chat-item-title";
                title.textContent = chat.is_favorites ? "★ " + chat.title : chat.title;

                const preview = document.createElement("div");
                preview.className = "chat-item-preview";
                preview.textContent = chat.last_message || "Нет сообщений";

                item.append(title, preview);
                item.onclick = () => this.openChat(chat.id, chat.title);
                list.appendChild(item);
            }
        } catch (err) {
            list.innerHTML = "";
            const item = document.createElement("li");
            item.className = "chat-item loading-item";
            item.textContent = err.message;
            list.appendChild(item);
        }
    },

    async openChat(chatId, title) {
        this.currentChatId = chatId;

        document.getElementById("chat-placeholder").classList.add("hidden");
        document.getElementById("chat-window").classList.remove("hidden");
        document.getElementById("chat-title").textContent = title;
        document.getElementById("message-form").classList.remove("hidden");

        const messages = document.getElementById("messages");
        messages.innerHTML = '<div class="loading">Загрузка…</div>';

        try {
            const items = await API.getMessages(chatId);
            messages.innerHTML = "";
            if (!items.length) {
                messages.innerHTML = '<div class="empty-hint">Сообщений пока нет</div>';
            }
            for (const msg of items) {
                messages.appendChild(this.renderMessage(msg));
            }
            messages.scrollTop = messages.scrollHeight;
        } catch (err) {
            messages.innerHTML = "";
            const hint = document.createElement("div");
            hint.className = "empty-hint";
            hint.textContent = err.message;
            messages.appendChild(hint);
        }

        await this.loadChats();
    },

    renderMessage(msg) {
        const myId = Number(localStorage.getItem(CONFIG.STORAGE.USER_ID));
        const row = document.createElement("div");
        row.className = "message" + (msg.sender_id === myId ? " mine" : "");

        const head = document.createElement("div");
        head.className = "message-head";
        head.textContent = `${msg.sender_nickname || "?"} · ${new Date(msg.created_at).toLocaleString("ru-RU")}`;

        const text = document.createElement("div");
        text.className = "message-text";
        text.textContent = msg.text;

        row.append(head, text);

        // Звезда доступна только для своих сообщений — так же проверяет и бэкенд
        if (msg.sender_id === myId) {
            const star = document.createElement("button");
            star.className = "message-star" + (msg.is_favorite ? " active" : "");
            star.title = "В избранное";
            star.textContent = msg.is_favorite ? "★" : "☆";
            star.onclick = () => this.onToggleFavorite(star, msg);
            row.appendChild(star);
        }

        return row;
    },

    async onToggleFavorite(star, msg) {
        try {
            const updated = await API.toggleFavorite(msg.id);
            msg.is_favorite = updated.is_favorite;
            star.classList.toggle("active", updated.is_favorite);
            star.textContent = updated.is_favorite ? "★" : "☆";
            // Обновляем превью в списке чатов (например счётчик избранного)
            await this.loadChats();
        } catch (err) {
            alert(err.message);
        }
    },

    async sendMessage(e) {
        e.preventDefault();
        const input = document.getElementById("message-input");
        const text = input.value.trim();
        if (!text || this.currentChatId === null) return;

        input.value = "";
        try {
            const msg = await API.sendMessage(this.currentChatId, text);
            const messages = document.getElementById("messages");
            const hint = messages.querySelector(".empty-hint");
            if (hint) hint.remove();
            messages.appendChild(this.renderMessage(msg));
            messages.scrollTop = messages.scrollHeight;
            await this.loadChats();
        } catch (err) {
            input.value = text;
            alert(err.message);
        }
    }
};

// ============================
// Main — роутинг между экранами
// ============================
const Main = {
    appEl: null,

    async start() {
        this.appEl = document.getElementById("app");
        const token = localStorage.getItem(CONFIG.STORAGE.TOKEN);
        if (token) {
            await this.showChat();
        } else {
            await this.showAuth();
        }
    },

    async showAuth() {
        await this.loadPage(CONFIG.PAGES.AUTH);
        Auth.init();
    },

    async showChat() {
        await this.loadPage(CONFIG.PAGES.CHAT);
        Chat.init();
    },

    async loadPage(path) {
        const response = await fetch(path);
        const html = await response.text();
        this.appEl.innerHTML = html;
    }
};

document.addEventListener("DOMContentLoaded", () => Main.start());