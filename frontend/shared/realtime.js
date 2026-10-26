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

        // Отметки «доставлено/прочитано» — не сообщения, их обрабатывает
        // отдельный колбэк и они не попадают в список увиденных id.
        if (data.type === "status") {
            if (this.statusHandler) this.statusHandler(data);
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
    }
};
