// Мобильный профиль: нижняя панель с теми же возможностями, что в десктопном
// диалоге, — аватарка, username, имя, дата рождения, «о себе», выход
// и безвозвратное удаление аккаунта.

import { API } from "../shared/api.js";
import { AccountDeletion } from "../shared/account-deletion.js";
import { CONFIG } from "../shared/config.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import { Validation } from "../shared/validation.js";

export const Profile = {
    init() {
        this.modal = document.getElementById("profile-modal");

        this.modal.querySelector(".m-modal-backdrop").onclick = () => this.close();
        document.getElementById("profile-close").onclick = () => this.close();
        document.getElementById("profile-save").onclick = () => this.save();
        document.getElementById("profile-logout").onclick = () => Session.logout();

        this.avatarInput = document.getElementById("profile-avatar-input");
        this.avatarButton = document.getElementById("profile-avatar-btn");
        this.avatarButton.onclick = () => this.avatarInput.click();
        this.avatarInput.onchange = (e) => this.uploadAvatar(e.target);

        AccountDeletion.init({
            passwordId: "profile-delete-password",
            phraseId: "profile-delete-phrase",
            buttonId: "profile-delete-confirm",
            errorId: "profile-delete-error"
        });

        // Календарь не должен предлагать будущие даты
        document.getElementById("profile-birth").max = new Date().toISOString().slice(0, 10);

        // Пока профиль грузится, пользователь уже может начать редактировать
        // поля. Тогда ответ сервера не должен затирать его ввод.
        this.dirty = false;
        for (const id of ["profile-username", "profile-nickname", "profile-bio", "profile-birth"]) {
            document.getElementById(id).addEventListener("input", () => {
                this.dirty = true;
            });
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return this.modal.classList.contains("open");
    },

    async open() {
        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        UI.hideError("profile-error");
        document.getElementById("profile-danger").open = false;
        AccountDeletion.reset();

        // Сразу показываем ник из сессии, остальное подгрузим
        this.dirty = false;
        this.fillBasic();
        document.getElementById("profile-birth").value = "";
        document.getElementById("profile-bio").value = "";
        document.getElementById("profile-since").textContent = "";

        try {
            const me = await API.getMe();
            Session.setAvatar(me.avatar_url);
            // Аватарку обновляем всегда, даже если пользователь уже начал
            // редактировать остальные поля.
            this.renderAvatar(me.nickname, me.avatar_url);
            if (!this.dirty) this.fill(me);
        } catch (err) {
            UI.showError("profile-error", err.message);
        }

        document.getElementById("profile-close").focus();
    },

    renderAvatar(nickname, avatarUrl) {
        UI.setAvatar(
            document.getElementById("profile-avatar"),
            nickname,
            avatarUrl
        );
    },

    fillBasic() {
        const nickname = Session.nickname();
        this.renderAvatar(nickname, Session.avatar());
        document.getElementById("profile-name").textContent = nickname;
        document.getElementById("profile-username").value = Session.username().replace(/^@/, "");
        document.getElementById("profile-nickname").value = nickname;
    },

    fill(me) {
        this.renderAvatar(me.nickname, me.avatar_url);
        document.getElementById("profile-name").textContent = me.nickname;
        document.getElementById("profile-username").value = (me.username || "").replace(/^@/, "");
        document.getElementById("profile-nickname").value = me.nickname;
        document.getElementById("profile-bio").value = me.bio || "";
        document.getElementById("profile-birth").value = me.birth_date || "";

        const since = document.getElementById("profile-since");
        since.textContent = me.created_at
            ? "В Messenger с " + new Date(me.created_at).toLocaleDateString("ru-RU", {
                day: "numeric", month: "long", year: "numeric"
            })
            : "";
        this.dirty = false;
    },

    async uploadAvatar(input) {
        const file = input.files && input.files[0];
        // Сбрасываем значение, иначе повторный выбор того же файла не сработает
        input.value = "";
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            UI.showError("profile-error", "Можно загружать только изображения");
            return;
        }
        if (file.size > CONFIG.MAX_IMAGE_BYTES) {
            UI.showError("profile-error", "Файл больше 5 МБ");
            return;
        }

        const button = this.avatarButton;
        button.disabled = true;
        button.textContent = "Загрузка…";
        UI.hideError("profile-error");

        try {
            const me = await API.uploadAvatar(file);
            Session.setAvatar(me.avatar_url);
            this.renderAvatar(me.nickname, me.avatar_url);
            document.getElementById("profile-name").textContent = me.nickname;
            UI.toast("Аватар обновлён");
        } catch (err) {
            UI.showError("profile-error", err.message);
        } finally {
            button.disabled = false;
            button.textContent = "Сменить фото";
        }
    },

    async save() {
        const button = document.getElementById("profile-save");
        const username = document.getElementById("profile-username").value.trim();
        const nickname = document.getElementById("profile-nickname").value.trim();
        const birthDate = document.getElementById("profile-birth").value;
        const bio = document.getElementById("profile-bio").value.trim();

        const error = Validation.username(username) || Validation.nickname(nickname);
        if (error) {
            UI.showError("profile-error", error);
            return;
        }

        button.disabled = true;
        UI.hideError("profile-error");

        try {
            const me = await API.updateMe({
                username,
                nickname,
                bio,
                birth_date: birthDate || null
            });

            // JWT привязан к id пользователя, поэтому сессия остаётся живой
            Session.setIdentity(me.username, me.nickname);
            Session.setAvatar(me.avatar_url);
            this.fill(me);
            UI.toast("Профиль сохранён");
            this.close();
        } catch (err) {
            UI.showError("profile-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    close() {
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
    }
};