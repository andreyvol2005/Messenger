// ============================
// Конфигурация
// ============================
const CONFIG = {
    API_BASE: "",
    STORAGE: {
        TOKEN: "messenger_token",
        USER_ID: "messenger_user_id",
        USERNAME: "messenger_username",
        NICKNAME: "messenger_nickname"
    },
    PAGES: {
        AUTH: "pages/auth.html",
        CHAT: "pages/chat.html"
    },
    ENDPOINTS: {
        REGISTER: "/api/register",
        LOGIN: "/api/login",
        USERS: "/api/users"
    }
};

// ============================
// API — работа с сервером
// ============================
const API = {
    async request(url, options = {}) {
        const response = await fetch(CONFIG.API_BASE + url, {
            headers: { "Content-Type": "application/json" },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.detail || `HTTP ${response.status}`);
        }
        return data;
    },

    register(username, password, nickname) {
        return this.request(CONFIG.ENDPOINTS.REGISTER, {
            method: "POST",
            body: JSON.stringify({ username, password, nickname })
        });
    },

    login(username, password) {
        return this.request(CONFIG.ENDPOINTS.LOGIN, {
            method: "POST",
            body: JSON.stringify({ username, password })
        });
    },

    getUsers() {
        return this.request(CONFIG.ENDPOINTS.USERS);
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
        document.getElementById("nickname").classList.toggle("hidden", isLogin);
        document.getElementById("auth-submit").textContent =
            isLogin ? "Войти" : "Зарегистрироваться";
        this.hideError();
    },

    async submit(e) {
        e.preventDefault();
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        const nickname = document.getElementById("nickname").value.trim();

        try {
            if (this.mode === "register") {
                await API.register(username, password, nickname || "user");
                alert("Успешно! Теперь войдите.");
                this.setMode("login");
            } else {
                const data = await API.login(username, password);
                this.saveSession(data);
                Main.showChat();
            }
        } catch (err) {
            this.showError(err.message);
        }
    },

    saveSession(data) {
        localStorage.setItem(CONFIG.STORAGE.TOKEN, data.access_token);
        localStorage.setItem(CONFIG.STORAGE.USER_ID, data.user_id);
        localStorage.setItem(CONFIG.STORAGE.USERNAME, data.username);
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
// Chat — логика чатов (заготовка)
// ============================
const Chat = {
    currentChatId: null,

    init() {
        document.getElementById("logout-btn").onclick = () => Auth.logout();
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);

        const nickname = localStorage.getItem(CONFIG.STORAGE.NICKNAME);
        document.getElementById("current-user").textContent = nickname || "?";
    },

    openChat(chatId, title) {
        this.currentChatId = chatId;
        document.getElementById("chat-placeholder").classList.add("hidden");
        document.getElementById("chat-window").classList.remove("hidden");
        document.getElementById("chat-title").textContent = title;
    },

    sendMessage(e) {
        e.preventDefault();
        const input = document.getElementById("message-input");
        const text = input.value.trim();
        if (!text) return;
        console.log("Отправить:", text);
        input.value = "";
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