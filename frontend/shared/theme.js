// Тема интерфейса: значение хранится в localStorage и выставляется
// атрибутом data-theme на <body>. Все цвета собраны в CSS-переменных
// (shared/base.css), поэтому переключение не требует перезагрузки.

import { Session } from "./session.js";

export const Theme = {
    apply(theme) {
        const value = theme === "light" ? "light" : "dark";
        if (document.body) {
            document.body.setAttribute("data-theme", value);
        }
        // color-scheme влияет на нативные контролы (календарь, скроллбары)
        document.documentElement.style.colorScheme = value;
        Session.setTheme(value);
        return value;
    },

    current() {
        return document.body?.getAttribute("data-theme")
            || Session.theme()
            || "dark";
    },

    toggle() {
        return this.current() === "dark" ? "light" : "dark";
    }
};
