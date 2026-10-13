// Общий модуль для десктопной и мобильной версий: настройки, работа с API, сессия.

const CONFIG = {
    API_BASE: "",
    // Виртуальный чат: на бэке он соответствует chat_id = NULL, is_favorite = true
    FAVORITES_CHAT_ID: -1,
    MOBILE_MAX_WIDTH: 768,
    STORAGE: {
        TOKEN: "messenger_token",
        USER_ID: "messenger_user_id",
        NICKNAME: "messenger_nickname"
    }
};

// Абсолютные пути: страницы лежат на разной глубине, относительные путались бы
const PATHS = {
    LOGIN: "/login.html",
    DESKTOP: "/desktop/index.html",
    MOBILE_CHATS: "/mobile/chats.html",
    MOBILE_CHAT: "/mobile/chat.html"
};

// ============================
// API — работа с сервером
// ============================
const API = {
    async request(url, options = {}) {
        const headers = { "Content-Type": "application/json" };
        const token = Session.token();
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const response = await fetch(CONFIG.API_BASE + url, {
            headers,
            ...options,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            // Токен протух — возвращаем на экран входа
            if (response.status === 401) Session.logout();
            throw new Error(data.detail || `HTTP ${response.status}`);
        }
        return data;
    },

    register(nickname, password) {
        return this.request("/api/register", {
            method: "POST",
            body: JSON.stringify({ nickname, password })
        });
    },

    login(nickname, password) {
        return this.request("/api/login", {
            method: "POST",
            body: JSON.stringify({ nickname, password })
        });
    },

    getUsers() {
        return this.request("/api/users");
    },

    getChats() {
        return this.request("/api/chats");
    },

    createChat(nickname) {
        return this.request("/api/chats", {
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
        }).then((msg) => {
            // Сообщение уже показано по ответу, а сервер разошлёт его же по сокету.
            // Помечаем как увиденное, чтобы Realtime не показал его второй раз.
            Realtime.markSeen(msg.id);
            return msg;
        });
    },

    toggleFavorite(messageId) {
        return this.request(`/api/messages/${messageId}/favorite`, { method: "POST" });
    }
};

// ============================
// Session — токен и переходы между экранами
// ============================
const Session = {
    isMobile() {
        return window.matchMedia(`(max-width: ${CONFIG.MOBILE_MAX_WIDTH}px)`).matches;
    },

    // Куда попасть после входа и куда возвращаться из приложения
    homePath() {
        return this.isMobile() ? PATHS.MOBILE_CHATS : PATHS.DESKTOP;
    },

    chatUrl(chatId) {
        return `${PATHS.MOBILE_CHAT}?id=${chatId}`;
    },

    token() {
        return localStorage.getItem(CONFIG.STORAGE.TOKEN);
    },

    nickname() {
        return localStorage.getItem(CONFIG.STORAGE.NICKNAME) || "?";
    },

    userId() {
        return Number(localStorage.getItem(CONFIG.STORAGE.USER_ID));
    },

    save(data) {
        localStorage.setItem(CONFIG.STORAGE.TOKEN, data.access_token);
        localStorage.setItem(CONFIG.STORAGE.USER_ID, data.user_id);
        localStorage.setItem(CONFIG.STORAGE.NICKNAME, data.nickname);
    },

    logout() {
        localStorage.clear();
        window.location.replace(PATHS.LOGIN);
    },

    requireAuth() {
        if (!this.token()) {
            window.location.replace(PATHS.LOGIN);
            return false;
        }
        return true;
    }
};

// ============================
// Realtime — доставка сообщений по WebSocket
// ============================
// Сервер сам рассылает новое сообщение всем участникам чата, поэтому клиенту
// не нужно ни опрашивать базу, ни перезагружать страницу. Отправка при этом
// идёт обычным POST: так сообщение попадёт в базу, даже если сокет не подключён.
const Realtime = {
    socket: null,
    backoff: 1000,
    handler: null,
    seen: new Set(),      // id уже показанных сообщений
    MAX_SEEN: 500,

    connect(handler) {
        this.handler = handler;
        this.open();
    },

    open() {
        const userId = Session.userId();
        const token = Session.token();
        if (!userId || !token) return;

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        this.socket = new WebSocket(
            `${proto}//${window.location.host}/ws/${userId}?token=${encodeURIComponent(token)}`
        );
        this.socket.onopen = () => { this.backoff = 1000; };
        this.socket.onmessage = (event) => this.handle(event);
        this.socket.onclose = () => this.retry();
        // Ошибку не логируем: после неё всё равно придёт onclose с переподключением
        this.socket.onerror = () => {};
    },

    // Пауза растёт от секунды до 15, чтобы не долбить сервер после долгого обрыва
    retry() {
        if (!Session.token()) return;   // разлогинились — переподключаться незачем
        setTimeout(() => this.open(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 15000);
    },

    handle(event) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (err) {
            return;
        }
        // Сервер присылает error в ответ на ввод с сокета, мы по сокету не шлём
        if (data.error) return;

        if (typeof data.id === "number") {
            if (this.seen.has(data.id)) return;   // это своё сообщение, уже показано
            this.markSeen(data.id);
        }
        if (this.handler) this.handler(data);
    },

    markSeen(id) {
        this.seen.add(id);
        if (this.seen.size > this.MAX_SEEN) {
            this.seen = new Set([...this.seen].slice(-(this.MAX_SEEN / 2)));
        }
    }
};

// ============================
// UI — общие мелочи для рендера
// ============================
const UI = {
    formatTime(iso) {
        return new Date(iso).toLocaleString("ru-RU", {
            day: "2-digit", month: "2-digit",
            hour: "2-digit", minute: "2-digit"
        });
    },

    // Создаёт элемент с классами, текстом и обработчиком — чтобы не городить innerHTML
    el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    },

    scrollToBottom(node) {
        node.scrollTop = node.scrollHeight;
    },

    // Собирает частые вызовы в один: список чатов перерисовывать на каждое
    // сообщение из всех чатов сразу было бы расточительно
    debounce(fn, ms = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    },

    showError(id, message) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = message;
        el.classList.remove("hidden");
    },

    hideError(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    }
};

// Общий код страницы входа: используется и из login.html
const LoginPage = {
    mode: "login",

    init() {
        document.getElementById("tab-login").onclick = () => this.setMode("login");
        document.getElementById("tab-register").onclick = () => this.setMode("register");
        document.getElementById("auth-form").onsubmit = (e) => this.submit(e);
        this.setMode("login");
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
        UI.hideError("auth-error");
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
                Session.save(data);
                window.location.replace(Session.homePath());
            }
        } catch (err) {
            UI.showError("auth-error", err.message);
        }
    }
};