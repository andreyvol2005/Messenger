// Общие мелочи для рендера: DOM-хелперы, время, уведомления, debounce.

export const UI = {
    // Только часы: в ленте дата под сообщением не нужна, время и так читается
    // по вертикали переписки. Дата остаётся в title, если понадобится.
    formatClock(iso) {
        return new Date(iso).toLocaleTimeString("ru-RU", {
            hour: "2-digit", minute: "2-digit"
        });
    },

    // Создаёт элемент с классами и текстом — чтобы не городить innerHTML
    el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    },

    scrollToBottom(node) {
        node.scrollTop = node.scrollHeight;
    },

    // Первая буква ника — пока аватарки без картинок
    initial(name) {
        const text = (name || "").trim();
        return text ? text.charAt(0).toUpperCase() : "?";
    },

    // Короткое уведомление внизу экрана: заглушки и подтверждения
    toast(message) {
        let node = document.getElementById("toast");
        if (!node) {
            node = UI.el("div", "toast");
            node.id = "toast";
            document.body.appendChild(node);
        }
        node.textContent = message;
        node.classList.add("show");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
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
