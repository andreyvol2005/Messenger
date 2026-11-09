// Доставка сообщений по WebSocket.

import { Session } from "./session.js";

// Сервер сам рассылает новое сообщение всем участникам чата, поэтому клиенту
// не нужно ни опрашивать базу, ни перезагружать страницу. Отправка при этом
// идёт обычным POST: так сообщение попадёт в базу, даже если сокет не подключён.
export const Realtime = {
    socket: null,
    backoff: 1000,
    handler: null,
    statusHandler: null,
    seen: new Set(),      // id уже показанных сообщений
    MAX_SEEN: 500,
    // «Печатает…» шлём не на каждую клавишу, а раз в две секунды на чат
    typingSentAt: new Map(),
    TYPING_INTERVAL: 2000,

    connect(handler, statusHandler = null) {
        this.handler = handler;
        this.statusHandler = statusHandler;
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
        this.socket.onopen = () => {
            this.backoff = 1000;
            this.typingSentAt.clear();
            // После переподключения события за время обрыва потеряны — модуль
            // присутствия сверит состояние с сервером.
            document.dispatchEvent(new CustomEvent("messenger:realtime-open"));
        };
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
        // Сервер присылает error в ответ на некорректный ввод по сокету
        if (data.error) return;

        // Отметки «доставлено/прочитано» — не сообщения, их обрабатывает
        // отдельный колбэк и они не попадают в список увиденных id.
        if (data.type === "status") {
            if (this.statusHandler) this.statusHandler(data);
            return;
        }

        // Собеседник набирает текст — показываем «печатает...» в шапке чата
        if (data.type === "typing") {
            document.dispatchEvent(new CustomEvent("messenger:typing", {
                detail: data
            }));
            return;
        }

        // Пользователь вошёл в сеть или вышел — обновляем зелёные точки
        if (data.type === "presence") {
            document.dispatchEvent(new CustomEvent("messenger:presence", {
                detail: data
            }));
            return;
        }

        // Смена аватарки: списки чатов/контактов обновят картинку без F5
        if (data.type === "avatar_updated") {
            if (Number(data.user_id) === Session.userId()) {
                Session.setAvatar(data.avatar_url);
            }
            document.dispatchEvent(new CustomEvent("messenger:avatar-updated", {
                detail: data
            }));
            return;
        }

        // Группа изменилась: название, аватар или состав участников
        if (data.type === "chat_updated") {
            document.dispatchEvent(new CustomEvent("messenger:chat-updated", {
                detail: data
            }));
            return;
        }

        // Сообщение отредактировали или удалили — меняем существующую строку,
        // а не добавляем новую. id уже показанного сообщения в seen не важен.
        if (data.type === "message_edited") {
            document.dispatchEvent(new CustomEvent("messenger:message-edited", {
                detail: data
            }));
            return;
        }
        if (data.type === "message_deleted") {
            document.dispatchEvent(new CustomEvent("messenger:message-deleted", {
                detail: data
            }));
            return;
        }
        if (data.type && data.type !== "message") return;

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
    },

    // Отправка служебного сообщения по сокету. Если сокет ещё не открыт,
    // молча возвращаем false: сообщения всё равно уходят обычным POST.
    send(data) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
        try {
            this.socket.send(JSON.stringify(data));
            return true;
        } catch (err) {
            return false;
        }
    },

    // Не чаще раза в две секунды на чат: сервер не хранит состояние,
    // а получатель сам гасит индикатор по таймауту.
    sendTyping(chatId) {
        const id = Number(chatId);
        if (!Number.isInteger(id) || id <= 0) return;

        const now = Date.now();
        const last = this.typingSentAt.get(id) || 0;
        if (now - last < this.TYPING_INTERVAL) return;

        if (this.send({ type: "typing", chat_id: id })) {
            this.typingSentAt.set(id, now);
        }
    }
};
