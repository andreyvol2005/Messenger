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
        this.fillBasic();
        document.getElementById("profile-birth").value = "";
        document.getElementById("profile-bio").value = "";
        document.getElementById("profile-since").textContent = "";

        try {
            this.fill(await API.getMe());
        } catch (err) {
            UI.showError("profile-error", err.message);
        }

        document.getElementById("profile-close").focus();
    },

    fillBasic() {
        const nickname = Session.nickname();
        document.getElementById("profile-avatar").textContent = UI.initial(nickname);
        document.getElementById("profile-name").textContent = nickname;
    },

    fill(me) {
        document.getElementById("profile-avatar").textContent = UI.initial(me.nickname);
        document.getElementById("profile-name").textContent = me.nickname;
        document.getElementById("profile-bio").value = me.bio || "";
        document.getElementById("profile-birth").value = me.birth_date || "";

        const since = document.getElementById("profile-since");
        since.textContent = me.created_at
            ? "В Messenger с " + new Date(me.created_at).toLocaleDateString("ru-RU", {
                day: "numeric", month: "long", year: "numeric"
            })
            : "";
    },

    async save() {
        const button = document.getElementById("profile-save");
        const birthDate = document.getElementById("profile-birth").value;
        const bio = document.getElementById("profile-bio").value.trim();

        button.disabled = true;
        UI.hideError("profile-error");

        try {
            const me = await API.updateMe({ bio, birth_date: birthDate || null });
            this.fill(me);
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

const Chat = {
    currentChatId: null,

    async init() {
        if (!Session.requireAuth()) return;

        document.getElementById("current-user").textContent = Session.nickname();
        document.getElementById("logout-btn").onclick = () => Session.logout();
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);
        document.getElementById("new-chat-btn").onclick = () => this.toggleNewChatForm();
        document.getElementById("new-chat-form").onsubmit = (e) => this.createChat(e);

        Menu.init();
        Profile.init();

        Realtime.connect((msg) => this.onIncoming(msg));
        await this.loadChats();
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
        const willShow = form.classList.contains("hidden");
        form.classList.toggle("hidden", !willShow);
        if (willShow) {
            document.getElementById("new-chat-nickname").focus();
        } else {
            UI.hideError("new-chat-error");
        }
    },

    async createChat(e) {
        e.preventDefault();
        const input = document.getElementById("new-chat-nickname");
        const nickname = input.value.trim();
        if (!nickname) return;

        try {
            const chat = await API.createChat(nickname);
            input.value = "";
            document.getElementById("new-chat-form").classList.add("hidden");
            UI.hideError("new-chat-error");
            await this.openChat(chat.id, chat.title);
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