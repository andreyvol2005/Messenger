// Общий рендер сообщений и загрузка истории для десктопной и мобильной версий.

import { API } from "./api.js";
import { CONFIG } from "./config.js";
import { openImageLightbox } from "./lightbox.js";
import { Session } from "./session.js";
import { UI } from "./ui.js";

// Классы отличаются только оформлением, структура DOM у обеих версий одинаковая.
export const MESSAGE_CLASSES = {
    desktop: {
        row: "message",
        bubble: "message-bubble",
        text: "message-text",
        image: "message-image",
        time: "message-time",
        star: "message-star"
    },
    mobile: {
        row: "m-message",
        bubble: "m-bubble",
        text: "m-message-text",
        image: "m-message-image",
        time: "m-message-time",
        star: "m-star"
    }
};

const STATUS_LABELS = {
    sent: "Отправлено",
    delivered: "Доставлено",
    read: "Прочитано"
};

function normalizeStatus(status) {
    return STATUS_LABELS[status] ? status : "sent";
}

// Одна галочка — отправлено, две — доставлено, две синие — прочитано.
function createStatusIcon(status) {
    const normalized = normalizeStatus(status);
    const icon = UI.el("span", "message-status " + normalized);
    icon.dataset.status = normalized;
    icon.title = STATUS_LABELS[normalized];
    icon.setAttribute("aria-label", STATUS_LABELS[normalized]);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 12");
    svg.setAttribute("aria-hidden", "true");

    const addCheck = (pathData) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.appendChild(path);
    };
    addCheck("M1,6.5 L4.5,10 L10.5,2");
    if (normalized !== "sent") {
        addCheck("M6,6.5 L9.5,10 L15.5,2");
    }

    icon.appendChild(svg);
    return icon;
}

const STATUS_RANK = { sent: 0, delivered: 1, read: 2 };

function applyStatusToRow(row, lastDeliveredId, lastReadId) {
    if (!row.classList.contains("mine")) return;

    const id = Number(row.dataset.msgId) || 0;
    const status = id <= lastReadId
        ? "read"
        : id <= lastDeliveredId
            ? "delivered"
            : "sent";

    const icon = row.querySelector(".message-status");
    if (!icon) return;
    // Статус только растёт. Это защищает от запоздавшего события или кэша,
    // пришедшего раньше, чем более свежая история из API.
    if (STATUS_RANK[status] <= STATUS_RANK[icon.dataset.status || "sent"]) return;
    icon.replaceWith(createStatusIcon(status));
}

// Обновляет галочки своих сообщений по событию от собеседника. Отметки
// приходят как максимальные id, поэтому статус можно применить ко всей ленте.
export function updateMessageStatuses(box, lastDeliveredId, lastReadId) {
    const delivered = lastDeliveredId || 0;
    const read = lastReadId || 0;
    for (const row of box.querySelectorAll("[data-msg-id]")) {
        applyStatusToRow(row, delivered, read);
    }
}

// Отметки о доставке/прочтении не критичны для работы чата: если запрос не
// прошёл из-за сети, сообщение просто останется с прежней галочкой.
export const Receipts = {
    async markDelivered(chatId, messageId) {
        if (!chatId || chatId === CONFIG.FAVORITES_CHAT_ID || !messageId) return;
        try {
            await API.markDelivered(chatId, messageId);
        } catch (err) {
            // повторится при следующем открытии чата или новом сообщении
        }
    },

    async markRead(chatId, messageId) {
        if (!chatId || chatId === CONFIG.FAVORITES_CHAT_ID || !messageId) return;
        try {
            await API.markRead(chatId, messageId);
        } catch (err) {
            // см. markDelivered
        }
    },

    // Новое сообщение пришло по сокету. Если чат открыт и вкладка видима —
    // сразу прочитано, иначе достаточно доставки.
    async acknowledgeMessage(chatId, messageId, isOpen) {
        if (isOpen && document.visibilityState === "visible") {
            return this.markRead(chatId, messageId);
        }
        return this.markDelivered(chatId, messageId);
    },

    // После загрузки истории отмечаем последнее входящее сообщение: всё,
    // что ниже него, пользователь уже получил, а в видимой вкладке — прочитал.
    async acknowledgeHistory(box, chatId) {
        if (!chatId || chatId === CONFIG.FAVORITES_CHAT_ID) return;

        let latest = 0;
        for (const row of box.querySelectorAll("[data-msg-id]")) {
            if (row.classList.contains("mine")) continue;
            const id = Number(row.dataset.msgId) || 0;
            if (id > latest) latest = id;
        }
        if (!latest) return;

        if (document.visibilityState === "visible") {
            return this.markRead(chatId, latest);
        }
        return this.markDelivered(chatId, latest);
    }
};

export function renderMessage(msg, { classes, showStar, showStatus, onToggleFavorite }) {
    const mine = msg.sender_id === Session.userId();
    const row = UI.el("div", classes.row + (mine ? " mine" : ""));
    row.dataset.msgId = msg.id;

    // Пузырь по ширине подстраивается под текст, время — строкой ниже, справа
    const bubble = UI.el(
        "div",
        classes.bubble + (msg.media_url ? " has-image" : "")
    );

    // Картинка идёт первой, подпись (если есть) — под ней
    if (msg.media_url) {
        const image = UI.el("img", classes.image);
        image.src = CONFIG.API_BASE + msg.media_url;
        image.alt = "Изображение";
        image.loading = "lazy";
        // Картинку можно открыть на весь экран и рассмотреть в масштабе
        image.tabIndex = 0;
        image.title = "Открыть изображение";
        image.setAttribute("role", "button");
        image.setAttribute("aria-label", "Открыть изображение");
        image.addEventListener("click", () => {
            openImageLightbox(image.currentSrc || image.src, image.alt);
        });
        image.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openImageLightbox(image.currentSrc || image.src, image.alt);
        });
        bubble.appendChild(image);
    }

    // У сообщения только с картинкой текста нет — пустой div не нужен
    if (msg.text) {
        bubble.appendChild(UI.el("div", classes.text, msg.text));
    }

    const meta = UI.el("div", classes.time);
    meta.appendChild(UI.el("span", "message-time-text", UI.formatClock(msg.created_at)));
    // В «Избранном» собеседника нет — галочки там ничего не значат
    if (mine && showStatus) {
        meta.appendChild(createStatusIcon(msg.status));
    }
    bubble.appendChild(meta);
    row.appendChild(bubble);

    // Звезда доступна только для своих сообщений — так же проверяет и бэкенд.
    // В избранном она лишняя: там все сообщения уже в избранном.
    if (mine && showStar) {
        const star = UI.el("button", classes.star + (msg.is_favorite ? " active" : ""),
            msg.is_favorite ? "★" : "☆");
        star.title = "В избранное";
        star.onclick = () => onToggleFavorite(star, msg);
        row.appendChild(star);
    }
    return row;
}

// Единственное место, где сообщение попадает в ленту. Ответ на отправку и
// событие из сокета несут одно и то же сообщение, и какой из них придёт
// первым — неизвестно, поэтому сверяемся по id и второй раз не добавляем.
export function appendMessage(box, msg, options) {
    if (box.querySelector(`[data-msg-id="${msg.id}"]`)) return false;
    box.appendChild(renderMessage(msg, options));
    return true;
}

// Убирает заглушку, добавляет сообщение и держит ленту внизу, если пользователь
// уже был внизу. Если он читает выше, прокрутку не трогаем.
export function appendIncoming(box, msg, options) {
    const hint = box.querySelector(".empty-hint");
    if (hint) hint.remove();
    appendMessage(box, msg, options);
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) UI.scrollToBottom(box);
}

export async function loadMessageHistory(box, chatId, options) {
    box.innerHTML = "";
    box.appendChild(UI.el("div", "loading", "Загрузка…"));

    try {
        const items = await API.getMessages(chatId);
        box.innerHTML = "";
        if (!items.length) {
            box.appendChild(UI.el("div", "empty-hint", "Сообщений пока нет"));
        }
        for (const msg of items) {
            box.appendChild(renderMessage(msg, options));
        }
        UI.scrollToBottom(box);
        return items;
    } catch (err) {
        box.innerHTML = "";
        box.appendChild(UI.el("div", "empty-hint", err.message));
        return [];
    }
}
