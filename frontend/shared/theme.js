// Тема интерфейса: применение и переключение светлой/тёмной темы.

import { Session } from "./session.js";

export const Theme = {
    apply(theme) {
        const value = theme === "light" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", value);
        document.documentElement.style.colorScheme = value;
        Session.setTheme(value);
    },

    current() {
        return document.documentElement.getAttribute("data-theme") || Session.theme() || "dark";
    },

    toggle() {
        return this.current() === "dark" ? "light" : "dark";
    }
};