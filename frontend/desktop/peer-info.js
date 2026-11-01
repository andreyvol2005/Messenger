// Панель информации о собеседнике (десктоп): выезжает справа поверх шапки и ленты.
// Данные — через GET /api/users/{id}; WebSocket и отправка сообщений не затрагиваются.

import { API } from "../shared/api.js";
import { UI } from "../shared/ui.js";

export const PeerInfo = {
    panel: null,
    backdrop: null,

    init() {
        this.panel = document.getElementById("peer-info");
        this.backdrop = document.getElementById("peer-info-backdrop");

        document.getElementById("peer-info-close").onclick = () => this.close();
        this.backdrop.onclick = () => this.close();

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return this.panel.classList.contains("open");
    },

    // peerUsername — логин собеседника с «@» (из списка чатов).
    // fallback — то, что уже известно без запроса к серверу: ник и аватар из чата.
    async open(peerUsername, { nickname = "", avatarUrl = "" } = {}) {
        let user = null;
        try {
            const users = await API.searchUsers(peerUsername);
            const match = users.find(
                (u) => u.username.replace(/^@/, "").toLowerCase()
                    === peerUsername.replace(/^@/, "").toLowerCase()
            ) || users[0];
            if (match) user = await API.getUser(match.id);
        } catch (err) {
            // Собеседник мог удалить аккаунт — покажем то, что есть из списка чатов.
            user = null;
        }
        this.render(user, { nickname, avatarUrl });

        this.backdrop.classList.add("open");
        this.backdrop.setAttribute("aria-hidden", "false");
        this.panel.classList.add("open");
        this.panel.setAttribute("aria-hidden", "false");
        document.getElementById("peer-info-close").focus();
    },

    render(user, fallback) {
        const nickname = (user && user.nickname) || fallback.nickname || "Собеседник";
        document.getElementById("peer-info-name").textContent = nickname;
        UI.setAvatar(
            document.getElementById("peer-info-avatar"),
            nickname,
            (user && user.avatar_url) || fallback.avatarUrl || null
        );

        const usernameEl = document.getElementById("peer-info-username");
        const username = user ? user.username : "";
        usernameEl.textContent = username || "—";

        const bioEl = document.getElementById("peer-info-bio");
        if (user && user.bio) {
            bioEl.textContent = user.bio;
            bioEl.hidden = false;
        } else {
            bioEl.textContent = "";
            bioEl.hidden = true;
        }

        const birthEl = document.getElementById("peer-info-birth");
        if (user && user.birth_date) {
            birthEl.textContent = new Date(user.birth_date).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric"
            });
            birthEl.hidden = false;
        } else {
            birthEl.textContent = "";
            birthEl.hidden = true;
        }
    },

    close() {
        if (!this.isOpen()) return;
        this.panel.classList.remove("open");
        this.panel.setAttribute("aria-hidden", "true");
        this.backdrop.classList.remove("open");
        this.backdrop.setAttribute("aria-hidden", "true");
    }
};
