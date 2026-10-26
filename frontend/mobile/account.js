// Мобильный экран аккаунта: выход и удаление аккаунта.
// Открывается кнопкой с аватаром в шапке списка чатов.

import { AccountDeletion } from "../shared/account-deletion.js";
import { Session } from "../shared/session.js";

export const Account = {
    init() {
        this.modal = document.getElementById("account-modal");

        document.getElementById("account-btn").onclick = () => this.open();
        document.getElementById("account-close").onclick = () => this.close();
        document.getElementById("account-logout").onclick = () => Session.logout();
        document.querySelector("#account-modal .m-modal-backdrop").onclick = () => this.close();

        AccountDeletion.init({
            passwordId: "account-delete-password",
            phraseId: "account-delete-phrase",
            buttonId: "account-delete-confirm",
            errorId: "account-delete-error"
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return this.modal.classList.contains("open");
    },

    open() {
        const nickname = Session.nickname();
        const username = Session.username();
        document.getElementById("account-user").textContent =
            username ? `${nickname} · ${username}` : nickname;

        AccountDeletion.reset();
        this.modal.querySelector(".m-danger").open = false;
        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        document.getElementById("account-close").focus();
    },

    close() {
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
        AccountDeletion.reset();
    }
};
