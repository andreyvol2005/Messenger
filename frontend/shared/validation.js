// Проверки username и nickname. Совпадают с серверными: пользователь видит
// ошибку сразу, а бэкенд всё равно проверяет то же самое ещё раз.

export const Validation = {
    USERNAME_MAX: 30,
    NICKNAME_MAX: 30,

    allowedChars(value) {
        // Тот же набор, что и на сервере: латиница, кириллица, цифры, _.
        // Для кириллицы проверяем и диапазон, и то, что это именно буква:
        // в U+0400–U+04FF есть служебные знаки.
        for (const char of value) {
            if (/[A-Za-z0-9_]/.test(char)) continue;
            const code = char.codePointAt(0);
            if (code >= 0x0400 && code <= 0x04ff && /\p{L}/u.test(char)) continue;
            return false;
        }
        return true;
    },

    username(value) {
        const text = (value || "").trim();
        if (!text) return "Введите имя пользователя";
        if (text.includes("@")) return "Пишите имя пользователя без символа @";
        if (text.length > this.USERNAME_MAX) {
            return `Имя пользователя не может быть длиннее ${this.USERNAME_MAX} символов`;
        }
        if (!this.allowedChars(text)) {
            return "Имя пользователя: только латиница, кириллица, цифры и _";
        }
        return "";
    },

    nickname(value) {
        const text = (value || "").trim();
        if (!text) return "Введите имя";
        if (text.includes("@")) return "Пишите имя без символа @";
        if (text.length > this.NICKNAME_MAX) {
            return `Имя не может быть длиннее ${this.NICKNAME_MAX} символов`;
        }
        if (!this.allowedChars(text)) {
            return "Имя: только латиница, кириллица, цифры и _";
        }
        return "";
    }
};
