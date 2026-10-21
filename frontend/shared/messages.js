// Общий рендер сообщений и загрузка истории для десктопной и мобильной версий.

import { API } from "./api.js";
import { Session } from "./session.js";
import { UI } from "./ui.js";

// Классы отличаются только оформлением, структура DOM у обеих версий одинаковая.
export const MESSAGE_CLASSES = {
    desktop: {
        row: "message",
        bubble: "message-bubble",
        text: "message-text",
        time: "message-time",
        star: "message-star"
    },
    mobile: {
        row: "m-message",
        bubble: "m-bubble",
        text: "m-message-text",
        time: "m-message-time",
        star: "m-star"
    }
};

export function renderMessage(msg, { classes, showStar, onToggleFavorite }) {
    const mine = msg.sender_id === Session.userId();
    const row = UI.el("div", classes.row + (mine ? " mine" : ""));
    row.dataset.msgId = msg.id;

    // Пузырь по ширине подстраивается под текст, время — строкой ниже, справа
    const bubble = UI.el("div", classes.bubble);
    bubble.appendChild(UI.el("div", classes.text, msg.text));
    bubble.appendChild(UI.el("div", classes.time, UI.formatClock(msg.created_at)));
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
    } catch (err) {
        box.innerHTML = "";
        box.appendChild(UI.el("div", "empty-hint", err.message));
    }
}
