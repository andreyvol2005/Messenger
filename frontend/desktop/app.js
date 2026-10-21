// Десктопная версия: список чатов и окно переписки на одной странице.

// Выдвижное меню слева: «гамбургер» в узкой колонке, затемнение и панель
const Menu = {
    init() {
        this.menu = document.getElementById("side-menu");
        this.backdrop = document.getElementById("menu-backdrop");
        this.button = document.getElementById("menu-btn");

        this.button.onclick = () => this.open();
        this.backdrop.onclick = () => this.close();

        document.getElementById("menu-profile").onclick = () => {
            this.close();
            Profile.open();
        };
        document.getElementById("menu-contacts").onclick = () => {
            UI.toast("Раздел «Контакты» пока в разработке");
        };

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return this.menu.classList.contains("open");
    },

    open() {
        if (this.isOpen()) return;

        // Ник и аватарка могли смениться, пока меню было закрыто
        document.getElementById("menu-avatar").textContent = UI.initial(Session.nickname());
        document.getElementById("menu-nickname").textContent = Session.nickname();
        document.getElementById("menu-username").textContent = Session.username();

        this.menu.classList.add("open");
        this.backdrop.classList.add("open");
        this.menu.setAttribute("aria-hidden", "false");
        this.button.setAttribute("aria-expanded", "true");
        document.getElementById("menu-profile").focus();
    },

    close() {
        if (!this.isOpen()) return;

        this.menu.classList.remove("open");
        this.backdrop.classList.remove("open");
        this.menu.setAttribute("aria-hidden", "true");
        this.button.setAttribute("aria-expanded", "false");
        this.button.focus();
    }
};

// Диалог профиля: данные тянем с сервера, правим bio и дату рождения
const Profile = {
    init() {
        this.modal = document.getElementById("profile-modal");

        document.getElementById("profile-backdrop").onclick = () => this.close();
        document.getElementById("profile-close").onclick = () => this.close();
        document.getElementById("profile-save").onclick = () => this.save();

        // Календарь не должен предлагать будущие даты
        document.getElementById("profile-birth").max = new Date().toISOString().slice(0, 10);

        // Пока профиль грузится, пользователь уже может начать редактировать
        // поля. Тогда ответ сервера не должен затирать его ввод.
        this.dirty = false;
        for (const id of ["profile-username", "profile-nickname", "profile-bio", "profile-birth"]) {
            document.getElementById(id).addEventListener("input", () => {
                this.dirty = true;
            });
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return this.modal.classList.contains("open");
    },

    async open() {
        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        UI.hideError("profile-error");

        // Сразу показываем ник из сессии, остальное подгрузим
        this.dirty = false;
        this.fillBasic();
        document.getElementById("profile-birth").value = "";
        document.getElementById("profile-bio").value = "";
        document.getElementById("profile-since").textContent = "";

        try {
            const me = await API.getMe();
            if (!this.dirty) this.fill(me);
        } catch (err) {
            UI.showError("profile-error", err.message);
        }

        document.getElementById("profile-close").focus();
    },

    fillBasic() {
        const nickname = Session.nickname();
        document.getElementById("profile-avatar").textContent = UI.initial(nickname);
        document.getElementById("profile-name").textContent = nickname;
        document.getElementById("profile-username").value = Session.username().replace(/^@/, "");
        document.getElementById("profile-nickname").value = nickname;
    },

    fill(me) {
        document.getElementById("profile-avatar").textContent = UI.initial(me.nickname);
        document.getElementById("profile-name").textContent = me.nickname;
        document.getElementById("profile-username").value = (me.username || "").replace(/^@/, "");
        document.getElementById("profile-nickname").value = me.nickname;
        document.getElementById("profile-bio").value = me.bio || "";
        document.getElementById("profile-birth").value = me.birth_date || "";

        const since = document.getElementById("profile-since");
        since.textContent = me.created_at
            ? "В Messenger с " + new Date(me.created_at).toLocaleDateString("ru-RU", {
                day: "numeric", month: "long", year: "numeric"
            })
            : "";
        this.dirty = false;
    },

    async save() {
        const button = document.getElementById("profile-save");
        const username = document.getElementById("profile-username").value.trim();
        const nickname = document.getElementById("profile-nickname").value.trim();
        const birthDate = document.getElementById("profile-birth").value;
        const bio = document.getElementById("profile-bio").value.trim();

        const error = Validation.username(username) || Validation.nickname(nickname);
        if (error) {
            UI.showError("profile-error", error);
            return;
        }

        button.disabled = true;
        UI.hideError("profile-error");

        try {
            const me = await API.updateMe({
                username,
                nickname,
                bio,
                birth_date: birthDate || null
            });

            // JWT привязан к id пользователя, поэтому сессия остаётся живой
            Session.setIdentity(me.username, me.nickname);
            this.fill(me);
            Chat.updateCurrentUser();
            UI.toast("Профиль сохранён");
            this.close();
        } catch (err) {
            UI.showError("profile-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    close() {
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
    }
};

const Sidebar = {
    MIN:0,
    MAX:560,
    DEFAULT:280,
    KEY: "messenger_sidebar_width",

    init() {
        this.sidebar = document.querySelector(".chat-sidebar");
        this.handle = document.getElementById("sidebar-resizer");
        if (!this.sidebar || !this.handle) return;

        // 0 — допустимая ширина (панель свёрнута), поэтому проверяем не на
        // truthy, а на то, что значение вообще сохранено и является числом
        const raw = localStorage.getItem(this.KEY);
        if (raw !== null && raw !== "") {
            const saved = Number(raw);
            if (Number.isFinite(saved)) this.apply(this.clamp(saved));
        }

        this.handle.addEventListener("pointerdown", (e) => this.start(e));

        this.handle.addEventListener("dblclick", () => {
            localStorage.removeItem(this.KEY);
            this.apply(this.DEFAULT);
        });
    },

    clamp(width) {
        return Math.min(this.MAX, Math.max(this.MIN, width));
    },

    apply(width) {
        document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
        // На нуле убираем разделительную рамку, чтобы панель исчезла полностью
        if (this.sidebar) {
            this.sidebar.classList.toggle("collapsed", width <= 0);
        }
    },

    start(e) {
        e.preventDefault();
        this.startX = e.clientX;
        this.startWidth = this.sidebar.getBoundingClientRect().width;
        document.body.classList.add("resizing");
        this.handle.classList.add("active");
        this.handle.setPointerCapture(e.pointerId);

        this.onMove = (ev) => {
            this.apply(this.clamp(this.startWidth + ev.clientX - this.startX));
        };
        this.onUp = () => this.stop();

        this.handle.addEventListener("pointermove", this.onMove);
        this.handle.addEventListener("pointerup", this.onUp);
        this.handle.addEventListener("pointercancel", this.onUp);
    },

    stop() {
        document.body.classList.remove("resizing");
        this.handle.classList.remove("active");
        this.handle.removeEventListener("pointermove", this.onMove);
        this.handle.removeEventListener("pointerup", this.onUp);
        this.handle.removeEventListener("pointercancel", this.onUp);

        const width = Math.round(this.sidebar.getBoundingClientRect().width);
        localStorage.setItem(this.KEY, String(width));
    }
};

const Chat = {
    currentChatId: null,

    async init() {
        if (!Session.requireAuth()) return;

        this.updateCurrentUser();
        document.getElementById("logout-btn").onclick = () => Session.logout();
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        document.getElementById("new-chat-btn").onclick = () => this.toggleNewChatForm();
        document.getElementById("new-chat-form").onsubmit = (e) => this.createChat(e);

        const searchInput = document.getElementById("new-chat-username");
        searchInput.addEventListener("input", UI.debounce(() => this.searchUsers(), 250));

        Menu.init();
        Profile.init();
        Sidebar.init();

        Realtime.connect((msg) => this.onIncoming(msg));
        await this.loadChats();
    },

    updateCurrentUser() {
        document.getElementById("current-user").textContent = Session.nickname();
    },

    // Сообщение от другого человека пришло по сокету
    onIncoming(msg) {
        if (msg.chat_id === this.currentChatId) {
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            this.appendMessage(msg, box);
            // Не дёргаем список вниз, если пользователь читает выше
            const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
            if (nearBottom) UI.scrollToBottom(box);
        }
        this.refreshList();
    },

    // Единственное место, где сообщение попадает в ленту. Ответ на отправку и
    // событие из сокета несут одно и то же сообщение, и какой из них придёт
    // первым — неизвестно, поэтому сверяемся по id и второй раз не добавляем.
    appendMessage(msg, box) {
        if (box.querySelector(`[data-msg-id="${msg.id}"]`)) return;
        box.appendChild(this.renderMessage(msg));
    },

    // ---------- Список чатов ----------

    toggleNewChatForm() {
        const form = document.getElementById("new-chat-form");
        const input = document.getElementById("new-chat-username");
        const willShow = form.classList.contains("hidden");

        form.classList.toggle("hidden", !willShow);
        this.hideSearchResults();
        UI.hideError("new-chat-error");

        if (willShow) {
            input.focus();
        } else {
            input.value = "";
        }
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
        await this.createChatWith(username);
    },

    async createChatWith(username) {
        const handle = (username || "").replace(/^@/, "").trim();

        try {
            const chat = await API.createChat(handle);
            document.getElementById("new-chat-username").value = "";
            document.getElementById("new-chat-form").classList.add("hidden");
            this.hideSearchResults();
            UI.hideError("new-chat-error");
            await this.openChat(chat.id, chat.title);
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
            return;
        }
        if (query.includes("@")) {
            this.hideSearchResults();
            UI.showError("new-chat-error", "Пишите username без символа @");
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

                    item.onclick = () => this.createChatWith(user.username);
                    results.appendChild(item);
                }
            }
            results.classList.remove("hidden");
        } catch (err) {
            if (input.value.trim() === query) this.hideSearchResults();
        }
    },

    async loadChats() {
        const list = document.getElementById("chat-list");
        list.innerHTML = "";

        try {
            const { chats } = await API.getChats();

            if (!chats.length) {
                list.appendChild(UI.el("li", "chat-item loading-item", "Пока нет чатов"));
                return;
            }

            for (const chat of chats) {
                const item = UI.el("li", "chat-item");
                if (chat.id === this.currentChatId) item.classList.add("active");
                item.appendChild(UI.el("div", "chat-item-title",
                    chat.is_favorites ? "★ " + chat.title : chat.title));
                item.appendChild(UI.el("div", "chat-item-preview",
                    chat.last_message || "Нет сообщений"));
                item.onclick = () => this.openChat(chat.id, chat.title);
                list.appendChild(item);
            }
        } catch (err) {
            list.appendChild(UI.el("li", "chat-item loading-item", err.message));
        }
    },

    // ---------- Окно переписки ----------

    async openChat(chatId, title) {
        this.currentChatId = chatId;

        document.getElementById("chat-placeholder").classList.add("hidden");
        document.getElementById("chat-window").classList.remove("hidden");
        document.getElementById("chat-title").textContent = title;

        const box = document.getElementById("messages");
        box.innerHTML = "";
        box.appendChild(UI.el("div", "loading", "Загрузка…"));

        try {
            const items = await API.getMessages(chatId);
            box.innerHTML = "";
            if (!items.length) {
                box.appendChild(UI.el("div", "empty-hint", "Сообщений пока нет"));
            }
            for (const msg of items) {
                box.appendChild(this.renderMessage(msg));
            }
            UI.scrollToBottom(box);
        } catch (err) {
            box.innerHTML = "";
            box.appendChild(UI.el("div", "empty-hint", err.message));
        }

        await this.loadChats();
    },

    renderMessage(msg) {
        const mine = msg.sender_id === Session.userId();
        const row = UI.el("div", "message" + (mine ? " mine" : ""));
        row.dataset.msgId = msg.id;

        // Пузырь по ширине подстраивается под текст, время — строкой ниже, справа
        const bubble = UI.el("div", "message-bubble");
        bubble.appendChild(UI.el("div", "message-text", msg.text));
        bubble.appendChild(UI.el("div", "message-time", UI.formatClock(msg.created_at)));
        row.appendChild(bubble);

        // Звезда доступна только для своих сообщений — так же проверяет и бэкенд.
        // В избранном она лишняя: там все сообщения уже в избранном.
        if (mine && this.currentChatId !== CONFIG.FAVORITES_CHAT_ID) {
            const star = UI.el("button", "message-star" + (msg.is_favorite ? " active" : ""), "☆");
            if (msg.is_favorite) star.textContent = "★";
            star.title = "В избранное";
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
            // Обновляем превью в списке чатов
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
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            this.appendMessage(msg, box);
            UI.scrollToBottom(box);
            await this.loadChats();
        } catch (err) {
            input.value = text;
            alert(err.message);
        }
    }
};

// Список перерисовываем не на каждое сообщение, а пачкой: события из разных
// чатов могут прийти подряд
Chat.refreshList = UI.debounce(() => Chat.loadChats());

document.addEventListener("DOMContentLoaded", () => Chat.init());