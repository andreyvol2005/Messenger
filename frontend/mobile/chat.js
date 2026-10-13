// Мобильная версия: один чат на весь экран. Открывается как chats.html?id=N,
// где -1 — виртуальное «Избранное».

const MobileChat = {
    chatId: null,

    async init() {
        if (!Session.requireAuth()) return;

        // Без id (например, заход вручную) — возвращаем к списку
        const raw = new URLSearchParams(window.location.search).get("id");
        const parsed = Number(raw);
        if (raw === null || !Number.isInteger(parsed)) {
            window.location.replace(PATHS.MOBILE_CHATS);
            return;
        }
        this.chatId = parsed;

        document.getElementById("back-btn").onclick = () => window.location.href = PATHS.MOBILE_CHATS;
        document.getElementById("message-form").onsubmit = (e) => this.sendMessage(e);

        // Собеседник пишет — сообщение появляется здесь без перезагрузки
        Realtime.connect((msg) => this.onIncoming(msg));

        await this.loadTitle();
        await this.loadMessages();
        document.getElementById("message-input").focus();
    },

    onIncoming(msg) {
        // В избранное сервер шлёт отправителю, у него chat_id = -1
        if (msg.chat_id !== this.chatId) return;

        const box = document.getElementById("messages");
        const hint = box.querySelector(".empty-hint");
        if (hint) hint.remove();
        this.appendMessage(msg, box);

        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
        if (nearBottom) UI.scrollToBottom(box);
    },

    // Ответ на отправку и событие из сокета несут одно сообщение, порядок прихода
    // неизвестен — сверяемся по id, чтобы не показать его дважды
    appendMessage(msg, box) {
        if (box.querySelector(`[data-msg-id="${msg.id}"]`)) return;
        box.appendChild(this.renderMessage(msg));
    },

    // Заголовок берём из списка чатов — так он всегда совпадает с тем, что видит собеседник
    async loadTitle() {
        const titleEl = document.getElementById("chat-title");
        titleEl.textContent = this.chatId === CONFIG.FAVORITES_CHAT_ID ? "Избранное" : "Чат";
        try {
            const { chats } = await API.getChats();
            const found = chats.find((c) => c.id === this.chatId);
            if (!found) {
                // Чата нет (удалили или с другого устройства) — назад к списку
                window.location.replace(PATHS.MOBILE_CHATS);
                return;
            }
            titleEl.textContent = found.title;
        } catch (err) {
            titleEl.textContent = "Чат";
        }
    },

    async loadMessages() {
        const box = document.getElementById("messages");
        box.innerHTML = "";
        box.appendChild(UI.el("div", "loading", "Загрузка…"));

        try {
            const items = await API.getMessages(this.chatId);
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
    },

    renderMessage(msg) {
        const mine = msg.sender_id === Session.userId();
        const row = UI.el("div", "m-message" + (mine ? " mine" : ""));
        row.dataset.msgId = msg.id;
        const bubble = UI.el("div", "m-bubble");

        bubble.appendChild(UI.el("div", "m-message-text", msg.text));
        bubble.appendChild(UI.el("div", "m-message-time", UI.formatTime(msg.created_at)));
        row.appendChild(bubble);

        if (mine) {
            const star = UI.el("button", "m-star" + (msg.is_favorite ? " active" : ""), "☆");
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
        } catch (err) {
            alert(err.message);
        }
    },

    async sendMessage(e) {
        e.preventDefault();
        const input = document.getElementById("message-input");
        const text = input.value.trim();
        if (!text) return;

        input.value = "";
        try {
            const msg = await API.sendMessage(this.chatId, text);
            const box = document.getElementById("messages");
            const hint = box.querySelector(".empty-hint");
            if (hint) hint.remove();
            this.appendMessage(msg, box);
            UI.scrollToBottom(box);
        } catch (err) {
            input.value = text;
            alert(err.message);
        }
    }
};

document.addEventListener("DOMContentLoaded", () => MobileChat.init());