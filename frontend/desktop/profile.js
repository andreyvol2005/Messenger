// Диалог профиля: данные тянем с сервера, правим username, nickname, bio и дату рождения.

import { API } from "../shared/api.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import { Validation } from "../shared/validation.js";

export const Profile = {
    init() {
        this.modal = document.getElementById("profile-modal");

        document.getElementById("profile-backdrop").onclick = () => this.close();
        document.getElementById("profile-close").onclick = () => this.close();
        document.getElementById("profile-save").onclick = () => this.save();
        document.getElementById("profile-logout").onclick = () => Session.logout();

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

        // Сразу показываем ник из сессии, остальное подгрузим
        this.dirty = false;
        this.fillBasic();
        document.getElementById("profile-birth").value = "";
        document.getElementById("profile-bio").value = "";
        document.getElementById("profile-since").textContent = "";

        try {
            const me = await API.getMe();
            if (!this.dirty) this.fill(me);
        } catch (err) {
            UI.showError("profile-error", err.message);
        }

        document.getElementById("profile-close").focus();
    },

    fillBasic() {
        const nickname = Session.nickname();
        document.getElementById("profile-avatar").textContent = UI.initial(nickname);
        document.getElementById("profile-name").textContent = nickname;
        document.getElementById("profile-username").value = Session.username().replace(/^@/, "");
        document.getElementById("profile-nickname").value = nickname;
    },

    fill(me) {
        document.getElementById("profile-avatar").textContent = UI.initial(me.nickname);
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
