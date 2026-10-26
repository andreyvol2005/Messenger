// Общий сценарий удаления аккаунта для десктопа и мобильной версии.
//
// Разметка страницы даёт поля пароля и контрольной фразы, а этот модуль
// проверяет ввод, вызывает API и после успеха очищает сессию. Так логика
// не дублируется между двумя версиями интерфейса.

import { API } from "./api.js";
import { Session } from "./session.js";
import { UI } from "./ui.js";

const CONFIRM_PHRASE = "УДАЛИТЬ АККАУНТ";

export const AccountDeletion = {
    init({ passwordId, phraseId, buttonId, errorId }) {
        this.ids = { passwordId, phraseId, buttonId, errorId };

        const button = document.getElementById(buttonId);
        if (button) button.onclick = () => this.submit();
    },

    reset() {
        if (!this.ids) return;
        const password = document.getElementById(this.ids.passwordId);
        const phrase = document.getElementById(this.ids.phraseId);
        if (password) password.value = "";
        if (phrase) phrase.value = "";
        UI.hideError(this.ids.errorId);
    },

    async submit() {
        const { passwordId, phraseId, buttonId, errorId } = this.ids;
        const password = document.getElementById(passwordId).value;
        const phrase = document.getElementById(phraseId).value.trim();
        const button = document.getElementById(buttonId);

        UI.hideError(errorId);

        if (!password) {
            UI.showError(errorId, "Введите пароль");
            return;
        }
        if (phrase !== CONFIRM_PHRASE) {
            UI.showError(errorId, `Напишите ровно: ${CONFIRM_PHRASE}`);
            return;
        }
        if (!window.confirm(
            "Удалить аккаунт навсегда? Восстановить его будет нельзя."
        )) {
            return;
        }

        const label = button.textContent;
        button.disabled = true;
        button.textContent = "Удаляем…";

        try {
            await API.deleteAccount(password, phrase);
            // Аккаунт удалён, старый токен больше не действует.
            Session.logout();
        } catch (err) {
            UI.showError(errorId, err.message);
            button.disabled = false;
            button.textContent = label;
        }
    }
};
