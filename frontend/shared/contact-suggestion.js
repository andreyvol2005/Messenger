// Подсказка «добавить в контакты»: общая логика для десктопа и мобильной версии.

import { API } from "./api.js";

export const ContactSuggestion = {
    // Закрытые подсказки запоминаем по username собеседника: для этого
    // человека окно больше не появится даже после перезагрузки страницы.
    KEY: "messenger_hidden_contact_suggestions",

    dismissed() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.KEY) || "[]");
            return Array.isArray(saved)
                ? saved.filter((username) => typeof username === "string")
                : [];
        } catch (err) {
            return [];
        }
    },

    isDismissed(username) {
        return Boolean(username) && this.dismissed().includes(username);
    },

    dismiss(username) {
        if (!username) return;
        const saved = this.dismissed();
        if (!saved.includes(username)) {
            saved.push(username);
            localStorage.setItem(this.KEY, JSON.stringify(saved));
        }
    },

    add(username) {
        return API.addContact((username || "").replace(/^@/, "").trim());
    }
};
