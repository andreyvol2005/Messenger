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
        sender: "message-sender",
        text: "message-text",
        image: "message-image",
        time: "message-time",
        select: "message-select"
    },
    mobile: {
        row: "m-message",
        bubble: "m-bubble",
        sender: "m-message-sender",
        text: "m-message-text",
        image: "m-message-image",
        time: "m-message-time",
        select: "message-select"
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
            // Заглушка удалённого сообщения не требует отметки о прочтении
            if (row.dataset.deleted === "true") continue;
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

function quotePreview(msg, options) {
    // У пересланной копии может не быть reply_to_id, но снимок цитаты есть.
    if (
        msg.reply_to_id == null
        && !msg.reply_to_nickname
        && !msg.reply_to_text
    ) {
        return null;
    }

    const target = options.findMessage ? options.findMessage(msg.reply_to_id) : null;
    let text = msg.reply_to_text || "";
    if (target && target.is_deleted) {
        text = "Сообщение удалено";
    } else if (!text && target) {
        text = target.text || (target.media_url ? "📷 Изображение" : "Сообщение");
    } else if (!text) {
        text = "Сообщение";
    }

    const nickname = msg.reply_to_nickname
        || (target && target.sender_nickname)
        || "Сообщение";
    return {
        id: msg.reply_to_id,
        nickname,
        text,
        clickable: Boolean(target && msg.reply_to_id)
    };
}

export function renderMessage(msg, options) {
    const mine = msg.sender_id === Session.userId();
    const row = UI.el("div", options.classes.row + (mine ? " mine" : ""));
    row.dataset.msgId = msg.id;
    row.dataset.senderId = msg.sender_id;
    row.dataset.deleted = msg.is_deleted ? "true" : "false";
    // Контекстное меню и выбор работают по исходным данным строки
    row.__message = msg;
    if (msg.is_deleted) row.classList.add("deleted");

    const bubble = UI.el(
        "div",
        options.classes.bubble
            + (msg.media_url && !msg.is_deleted ? " has-image" : "")
            + (msg.is_deleted ? " is-deleted" : "")
    );

    if (msg.is_deleted) {
        // Заглушка: автор и время остаются, содержимое недоступно
        bubble.appendChild(
            UI.el("div", "message-author", msg.sender_nickname || "Пользователь")
        );
        bubble.appendChild(
            UI.el("div", "message-deleted-text", "Сообщение удалено")
        );
    } else {
        // В группе по нику видно, кто написал. Свои сообщения не подписываем:
        // их и так выделяет сторона и цвет пузыря.
        if (options.showSender && !mine && msg.sender_nickname) {
            bubble.appendChild(
                UI.el("div", options.classes.sender, msg.sender_nickname)
            );
        }

        if (msg.forwarded_from_nickname) {
            bubble.appendChild(
                UI.el(
                    "div",
                    "message-forwarded",
                    `Переслано от ${msg.forwarded_from_nickname}`
                )
            );
        }

        const quote = quotePreview(msg, options);
        if (quote) {
            const quoteNode = UI.el(
                "div",
                "message-quote" + (quote.clickable ? " clickable" : "")
            );
            if (quote.id !== null && quote.id !== undefined) {
                quoteNode.dataset.replyId = quote.id;
            }
            quoteNode.appendChild(
                UI.el("div", "message-quote-name", quote.nickname)
            );
            quoteNode.appendChild(
                UI.el("div", "message-quote-text", quote.text)
            );
            if (quote.clickable) {
                quoteNode.title = "Перейти к сообщению";
                quoteNode.addEventListener("click", (event) => {
                    event.stopPropagation();
                    options.onQuoteClick?.(quote.id);
                });
            }
            bubble.appendChild(quoteNode);
        }

        // Картинка идёт первой, подпись (если есть) — под ней
        if (msg.media_url) {
            const image = UI.el("img", options.classes.image);
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
            bubble.appendChild(UI.el("div", options.classes.text, msg.text));
        }
    }

    const meta = UI.el("div", options.classes.time);
    meta.appendChild(UI.el("span", "message-time-text", UI.formatClock(msg.created_at)));
    if (mine && options.showStatus && !msg.is_deleted) {
        meta.appendChild(createStatusIcon(msg.status));
    }
    if (msg.edited_at && !msg.is_deleted) {
        meta.appendChild(UI.el("span", "message-edited", "изменено"));
    }
    bubble.appendChild(meta);
    row.appendChild(bubble);

    // Чекбокс всегда в DOM: на десктопе появляется при наведении, на телефоне
    // и в режиме выбора — постоянно.
    if (options.onToggleSelect) {
        const selected = options.isSelected ? options.isSelected(msg.id) : false;
        const check = UI.el("button", options.classes.select + (selected ? " checked" : ""));
        check.type = "button";
        check.setAttribute("role", "checkbox");
        check.setAttribute("aria-checked", selected ? "true" : "false");
        check.setAttribute("aria-label", "Выбрать сообщение");
        check.title = "Выбрать";
        check.addEventListener("click", (event) => {
            event.stopPropagation();
            options.onToggleSelect(msg);
        });
        row.classList.toggle("selected", selected);
        row.appendChild(check);
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

// Заменяет строку после правки или удаления. Сообщение может быть не в текущей
// ленте (например, правка пришла из другой вкладки) — тогда ничего не делаем.
export function updateMessageRow(box, msg, options) {
    const row = box.querySelector(`[data-msg-id="${msg.id}"]`);
    if (!row) return false;
    row.replaceWith(renderMessage(msg, options));
    return true;
}

export function removeMessageRow(box, messageId) {
    const row = box.querySelector(`[data-msg-id="${messageId}"]`);
    if (!row) return false;
    row.remove();
    return true;
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
