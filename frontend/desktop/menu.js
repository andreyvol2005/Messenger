// Выдвижное меню слева: «гамбургер» в узкой колонке, затемнение и панель.

import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
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
        document.getElementById("menu-username").textContent = Session.username();

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
