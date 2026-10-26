// Выдвижное меню слева: «гамбургер» в узкой колонке, затемнение и панель.

import { API } from "../shared/api.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import { Contacts } from "./contacts.js";
import { Profile } from "./profile.js";

export const Menu = {
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
            this.close();
            Contacts.open();
        };

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isOpen()) this.close();
        });

        // Своя аватарка могла измениться с другого устройства
        document.addEventListener("messenger:avatar-updated", (event) => {
            const data = event.detail || {};
            if (Number(data.user_id) !== Session.userId()) return;
            Session.setAvatar(data.avatar_url);
            if (this.isOpen()) this.renderUser();
        });
    },

    isOpen() {
        return this.menu.classList.contains("open");
    },

    renderUser() {
        UI.setAvatar(
            document.getElementById("menu-avatar"),
            Session.nickname(),
            Session.avatar()
        );
        document.getElementById("menu-nickname").textContent = Session.nickname();
        document.getElementById("menu-username").textContent = Session.username();
    },

    // В localStorage с прошлой версии мог не сохраниться avatar_url
    async refreshUser() {
        try {
            const me = await API.getMe();
            Session.setIdentity(me.username, me.nickname);
            Session.setAvatar(me.avatar_url);
            if (this.isOpen()) this.renderUser();
        } catch (err) {
            // Меню уже показано из сессии — сетевую ошибку здесь не показываем
        }
    },

    open() {
        if (this.isOpen()) return;

        // Ник и аватарка могли смениться, пока меню было закрыто
        this.renderUser();

        this.menu.classList.add("open");
        this.backdrop.classList.add("open");
        this.menu.setAttribute("aria-hidden", "false");
        this.button.setAttribute("aria-expanded", "true");
        document.getElementById("menu-profile").focus();
        this.refreshUser();
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
