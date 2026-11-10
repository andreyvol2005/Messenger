// Экран настроек: профиль, тема/обои чата и масштаб интерфейса.
// Модуль сам создаёт разметку, поэтому одинаково работает на десктопе и
// мобильных страницах — достаточно вызвать Settings.init().

import { API } from "./api.js";
import { CONFIG } from "./config.js";
import { Preferences } from "./preferences.js";
import { Session } from "./session.js";
import { Theme } from "./theme.js";
import { UI } from "./ui.js";
import { Validation } from "./validation.js";

const FIELD_CONFIG = {
    username: {
        label: "Имя пользователя",
        type: "text",
        maxlength: 30,
        autocomplete: "username",
        placeholder: "username"
    },
    nickname: {
        label: "Никнейм",
        type: "text",
        maxlength: 30,
        autocomplete: "nickname",
        placeholder: "Как вас называть"
    },
    bio: {
        label: "О себе",
        type: "textarea",
        maxlength: 150,
        placeholder: "Пара слов о себе"
    },
    birth_date: {
        label: "Дата рождения",
        type: "date",
        placeholder: ""
    }
};

function fieldRow(field) {
    const config = FIELD_CONFIG[field];
    const input = config.type === "textarea"
        ? `<textarea data-settings-input="${field}" rows="3" maxlength="${config.maxlength}" placeholder="${config.placeholder}"></textarea>`
        : `<input type="${config.type}" data-settings-input="${field}"
                ${config.maxlength ? `maxlength="${config.maxlength}"` : ""}
                ${config.autocomplete ? `autocomplete="${config.autocomplete}"` : ""}
                placeholder="${config.placeholder}">`;

    const prefix = field === "username"
        ? `<div class="settings-input-with-prefix"><span class="input-prefix">@</span>${input}</div>`
        : input;

    return `
        <div class="settings-field" data-settings-field="${field}">
            <div class="settings-field-head">
                <span class="settings-field-label">${config.label}</span>
                <button type="button" class="settings-pencil" data-settings-edit="${field}"
                        title="Редактировать" aria-label="Редактировать: ${config.label}">✏️</button>
            </div>
            <div class="settings-field-value" data-settings-value="${field}"></div>
            <form class="settings-field-editor hidden" data-settings-editor="${field}">
                ${prefix}
                <p class="error hidden" data-settings-field-error></p>
                <div class="settings-editor-actions">
                    <button type="button" class="settings-btn-ghost" data-settings-cancel="${field}">Отмена</button>
                    <button type="submit" class="settings-btn-primary">Сохранить</button>
                </div>
            </form>
        </div>`;
}

const TEMPLATE = `
    <div id="settings-modal" class="settings-modal" aria-hidden="true">
        <div class="settings-backdrop" data-settings-close></div>
        <section class="settings-dialog" role="dialog" aria-modal="true"
                 aria-labelledby="settings-title">
            <header class="settings-header">
                <h2 id="settings-title" class="settings-title">Настройки</h2>
                <button type="button" class="settings-close" data-settings-close
                        aria-label="Закрыть настройки" title="Закрыть">×</button>
            </header>

            <div class="settings-body">
                <nav class="settings-nav" role="tablist" aria-label="Разделы настроек">
                    <button type="button" class="settings-nav-item active"
                            data-settings-tab="profile" role="tab"
                            aria-selected="true" aria-controls="settings-panel-profile">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="8" r="4"></circle>
                            <path d="M4 21c0-4 3.6-6.2 8-6.2s8 2.2 8 6.2"></path>
                        </svg>
                        <span>Профиль</span>
                    </button>
                    <button type="button" class="settings-nav-item"
                            data-settings-tab="chats" role="tab"
                            aria-selected="false" aria-controls="settings-panel-chats">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.7 9.7 0 0 1-3.6-.7L3 21l1.8-4.7a8.1 8.1 0 0 1-1.3-4.5 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.5 8.1z"></path>
                        </svg>
                        <span>Настройки чатов</span>
                    </button>
                    <button type="button" class="settings-nav-item"
                            data-settings-tab="scale" role="tab"
                            aria-selected="false" aria-controls="settings-panel-scale">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
                            <rect x="8" y="8" width="8" height="8" rx="1"></rect>
                        </svg>
                        <span>Масштаб</span>
                    </button>
                </nav>

                <div class="settings-panels">
                    <section id="settings-panel-profile" class="settings-panel"
                             data-settings-panel="profile" role="tabpanel"
                             aria-labelledby="settings-tab-profile">
                        <div class="settings-profile-head">
                            <div class="settings-avatar-wrap">
                                <div id="settings-avatar" class="avatar avatar-xl">?</div>
                                <button type="button" id="settings-avatar-btn" class="settings-pencil"
                                        title="Изменить аватар" aria-label="Изменить аватар">✏️</button>
                            </div>
                            <input type="file" id="settings-avatar-input" accept="image/*" hidden>
                            <div class="settings-profile-info">
                                <h3 id="settings-profile-name" class="settings-profile-name"></h3>
                                <p id="settings-profile-username" class="settings-profile-username"></p>
                                <p id="settings-profile-since" class="settings-profile-since"></p>
                            </div>
                        </div>

                        <p id="settings-profile-error" class="error hidden"></p>

                        <div class="settings-fields">
                            ${fieldRow("username")}
                            ${fieldRow("nickname")}
                            ${fieldRow("bio")}
                            ${fieldRow("birth_date")}
                        </div>
                    </section>

                    <section id="settings-panel-chats" class="settings-panel hidden"
                             data-settings-panel="chats" role="tabpanel"
                             aria-labelledby="settings-tab-chats">
                        <h3 class="settings-panel-title">Настройки чатов</h3>

                        <div class="settings-card">
                            <div class="settings-card-head">
                                <div>
                                    <div class="settings-card-title">Тема интерфейса</div>
                                    <p class="settings-card-hint">Применяется сразу ко всем экранам.</p>
                                </div>
                            </div>
                            <div class="settings-segmented" role="group" aria-label="Тема интерфейса">
                                <button type="button" data-settings-theme="light">Светлая</button>
                                <button type="button" data-settings-theme="dark">Тёмная</button>
                            </div>
                        </div>

                        <div class="settings-card">
                            <div class="settings-card-head">
                                <div>
                                    <div class="settings-card-title">Обои чата</div>
                                    <p class="settings-card-hint">Фон области сообщений. Файл хранится на сервере, путь — в этом браузере.</p>
                                </div>
                            </div>
                            <div id="settings-wallpaper-preview" class="settings-wallpaper-preview">
                                <span>Обои не выбраны</span>
                            </div>
                            <div class="settings-actions-row">
                                <button type="button" id="settings-wallpaper-upload" class="settings-btn-primary">
                                    Загрузить обои
                                </button>
                                <button type="button" id="settings-wallpaper-remove" class="settings-btn-ghost hidden">
                                    Убрать обои
                                </button>
                            </div>
                            <input type="file" id="settings-wallpaper-input" accept="image/*" hidden>
                            <p id="settings-wallpaper-error" class="error hidden"></p>
                        </div>
                    </section>

                    <section id="settings-panel-scale" class="settings-panel hidden"
                             data-settings-panel="scale" role="tabpanel"
                             aria-labelledby="settings-tab-scale">
                        <h3 class="settings-panel-title">Масштаб</h3>

                        <div class="settings-card">
                            <div class="settings-scale-head">
                                <span>Масштаб интерфейса</span>
                                <output id="settings-scale-value" class="settings-scale-value">160%</output>
                            </div>
                            <input type="range" id="settings-scale" class="settings-range"
                                   min="100" max="250" step="10" value="160"
                                   aria-label="Масштаб интерфейса">
                            <div class="settings-scale-marks" aria-hidden="true">
                                <span>100%</span>
                                <span>250%</span>
                            </div>
                            <p class="settings-card-hint">Значение сохраняется в браузере и применяется при следующем входе.</p>
                            <button type="button" id="settings-scale-reset" class="settings-btn-ghost">
                                Сбросить (160%)
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </section>
    </div>`;

export const Settings = {
    init() {
        if (this.initialized) return;
        this.initialized = true;

        const holder = document.getElementById("app-root") || document.body;
        holder.insertAdjacentHTML("beforeend", TEMPLATE);

        this.modal = document.getElementById("settings-modal");
        this.avatarInput = document.getElementById("settings-avatar-input");
        this.wallpaperInput = document.getElementById("settings-wallpaper-input");
        this.scaleInput = document.getElementById("settings-scale");
        this.scaleValue = document.getElementById("settings-scale-value");
        this.me = null;

        this.modal.querySelectorAll("[data-settings-close]").forEach((node) => {
            node.addEventListener("click", () => this.close());
        });

        this.modal.querySelectorAll("[data-settings-tab]").forEach((button) => {
            button.addEventListener("click", () => this.showTab(button.dataset.settingsTab));
        });

        this.modal.querySelectorAll("[data-settings-edit]").forEach((button) => {
            button.addEventListener("click", () => this.startEdit(button.dataset.settingsEdit));
        });

        this.modal.querySelectorAll("[data-settings-cancel]").forEach((button) => {
            button.addEventListener("click", () => this.cancelEdit(button.dataset.settingsCancel));
        });

        this.modal.querySelectorAll("[data-settings-editor]").forEach((form) => {
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                this.saveField(form.dataset.settingsEditor, form);
            });
        });

        document.getElementById("settings-avatar-btn").onclick = () => this.avatarInput.click();
        this.avatarInput.onchange = (event) => this.uploadAvatar(event.target);

        document.querySelectorAll("[data-settings-theme]").forEach((button) => {
            button.addEventListener("click", () => {
                Theme.apply(button.dataset.settingsTheme);
                this.renderChatSettings();
            });
        });

        document.getElementById("settings-wallpaper-upload").onclick = () => this.wallpaperInput.click();
        this.wallpaperInput.onchange = (event) => this.uploadWallpaper(event.target);
        document.getElementById("settings-wallpaper-remove").onclick = () => this.removeWallpaper();

        this.scaleInput.addEventListener("input", () => {
            const value = Preferences.applyScale(this.scaleInput.value);
            this.scaleValue.textContent = `${value}%`;
        });
        document.getElementById("settings-scale-reset").onclick = () => {
            Preferences.applyScale(Preferences.DEFAULT_SCALE);
            this.renderScale();
        };

        // Календарь не должен предлагать будущие даты
        const birthInput = this.modal.querySelector('[data-settings-input="birth_date"]');
        if (birthInput) birthInput.max = new Date().toISOString().slice(0, 10);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && this.isOpen()) this.close();
        });
    },

    isOpen() {
        return Boolean(this.modal && this.modal.classList.contains("open"));
    },

    async open(tab = "profile") {
        if (!this.modal) return;

        this.modal.classList.add("open");
        this.modal.setAttribute("aria-hidden", "false");
        this.showTab(tab);
        this.renderChatSettings();
        this.renderScale();
        this.closeEditors();
        UI.hideError("settings-profile-error");
        UI.hideError("settings-wallpaper-error");

        const closeButton = this.modal.querySelector(".settings-close");
        if (closeButton) closeButton.focus();

        await this.loadProfile();
    },

    close() {
        if (!this.modal) return;
        this.closeEditors();
        this.modal.classList.remove("open");
        this.modal.setAttribute("aria-hidden", "true");
    },

    showTab(name) {
        this.modal.querySelectorAll("[data-settings-tab]").forEach((button) => {
            const active = button.dataset.settingsTab === name;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", String(active));
        });
        this.modal.querySelectorAll("[data-settings-panel]").forEach((panel) => {
            panel.classList.toggle("hidden", panel.dataset.settingsPanel !== name);
        });
    },

    async loadProfile() {
        this.renderProfile({
            nickname: Session.nickname(),
            username: Session.username(),
            avatar_url: Session.avatar(),
            bio: null,
            birth_date: null,
            created_at: null
        });

        try {
            const me = await API.getMe();
            Session.setIdentity(me.username, me.nickname);
            Session.setAvatar(me.avatar_url);
            this.renderProfile(me);
        } catch (err) {
            UI.showError("settings-profile-error", err.message);
        }
    },

    renderProfile(me) {
        this.me = me;
        UI.setAvatar(
            document.getElementById("settings-avatar"),
            me.nickname,
            me.avatar_url
        );

        document.getElementById("settings-profile-name").textContent = me.nickname || "Без имени";
        document.getElementById("settings-profile-username").textContent =
            me.username ? `@${String(me.username).replace(/^@/, "")}` : "";

        const since = document.getElementById("settings-profile-since");
        since.textContent = me.created_at
            ? "В Messenger с " + new Date(me.created_at).toLocaleDateString("ru-RU", {
                day: "numeric", month: "long", year: "numeric"
            })
            : "";

        this.setValue("username", me.username ? `@${String(me.username).replace(/^@/, "")}` : "Не указано");
        this.setValue("nickname", me.nickname || "Не указано");
        this.setValue("bio", me.bio || "Не указано");
        this.setValue("birth_date", this.formatBirthDate(me.birth_date));
    },

    setValue(field, text) {
        const node = this.modal.querySelector(`[data-settings-value="${field}"]`);
        if (!node) return;
        node.textContent = text;
        node.classList.toggle("is-empty", !text || text === "Не указано" || text === "Не указана");
    },

    formatBirthDate(value) {
        if (!value) return "Не указана";
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString("ru-RU", {
            day: "numeric", month: "long", year: "numeric"
        });
    },

    startEdit(field) {
        this.closeEditors();

        const row = this.modal.querySelector(`[data-settings-field="${field}"]`);
        const editor = this.modal.querySelector(`[data-settings-editor="${field}"]`);
        const value = this.modal.querySelector(`[data-settings-value="${field}"]`);
        const input = editor?.querySelector("[data-settings-input]");
        if (!row || !editor || !input) return;

        const current = this.me || {};
        if (field === "username") {
            input.value = String(current.username || "").replace(/^@/, "");
        } else if (field === "birth_date") {
            input.value = current.birth_date || "";
        } else {
            input.value = current[field] || "";
        }

        row.classList.add("editing");
        value.classList.add("hidden");
        editor.classList.remove("hidden");
        const error = editor.querySelector("[data-settings-field-error]");
        if (error) error.classList.add("hidden");

        input.focus();
        if (input.select && input.type !== "date") input.select();
    },

    cancelEdit(field) {
        const row = this.modal.querySelector(`[data-settings-field="${field}"]`);
        const editor = this.modal.querySelector(`[data-settings-editor="${field}"]`);
        const value = this.modal.querySelector(`[data-settings-value="${field}"]`);
        if (!row || !editor || !value) return;
        row.classList.remove("editing");
        editor.classList.add("hidden");
        value.classList.remove("hidden");
    },

    closeEditors() {
        if (!this.modal) return;
        this.modal.querySelectorAll("[data-settings-field].editing").forEach((row) => {
            this.cancelEdit(row.dataset.settingsField);
        });
    },

    showFieldError(form, message) {
        const node = form.querySelector("[data-settings-field-error]");
        if (!node) return;
        node.textContent = message;
        node.classList.remove("hidden");
    },

    async saveField(field, form) {
        const input = form.querySelector("[data-settings-input]");
        if (!input) return;

        let value = input.value;
        let error = "";

        if (field === "username") {
            value = value.trim().replace(/^@/, "");
            error = Validation.username(value);
        } else if (field === "nickname") {
            value = value.trim();
            error = Validation.nickname(value);
        } else if (field === "bio") {
            value = value.trim();
            if (value.length > 150) {
                error = "О себе не может быть длиннее 150 символов";
            }
        }

        if (error) {
            this.showFieldError(form, error);
            return;
        }

        const payload = {};
        if (field === "birth_date") {
            payload.birth_date = value || null;
        } else if (field === "bio") {
            payload.bio = value;
        } else {
            payload[field] = value;
        }

        const button = form.querySelector('button[type="submit"]');
        if (button) button.disabled = true;

        try {
            const me = await API.updateMe(payload);
            this.renderProfile(me);
            Session.setIdentity(me.username, me.nickname);
            Session.setAvatar(me.avatar_url);
            this.cancelEdit(field);
            this.dispatchProfileUpdated(me);
            UI.toast("Профиль сохранён");
        } catch (err) {
            this.showFieldError(form, err.message);
        } finally {
            if (button) button.disabled = false;
        }
    },

    async uploadAvatar(input) {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            UI.showError("settings-profile-error", "Можно загружать только изображения");
            return;
        }
        if (file.size > CONFIG.MAX_IMAGE_BYTES) {
            UI.showError("settings-profile-error", "Файл больше 5 МБ");
            return;
        }

        const button = document.getElementById("settings-avatar-btn");
        button.disabled = true;
        UI.hideError("settings-profile-error");

        try {
            const me = await API.uploadAvatar(file);
            this.renderProfile(me);
            Session.setAvatar(me.avatar_url);
            this.dispatchProfileUpdated(me);
            UI.toast("Аватар обновлён");
        } catch (err) {
            UI.showError("settings-profile-error", err.message);
        } finally {
            button.disabled = false;
        }
    },

    dispatchProfileUpdated(me) {
        document.dispatchEvent(new CustomEvent("messenger:profile-updated", {
            detail: me
        }));
    },

    renderChatSettings() {
        const current = Theme.current();
        this.modal.querySelectorAll("[data-settings-theme]").forEach((button) => {
            button.classList.toggle("active", button.dataset.settingsTheme === current);
        });

        const preview = document.getElementById("settings-wallpaper-preview");
        const removeButton = document.getElementById("settings-wallpaper-remove");
        const url = Preferences.wallpaper();
        preview.classList.toggle("has-image", Boolean(url));
        preview.style.backgroundImage = url ? `url("${url.replace(/["\\\n\r]/g, "")}")` : "";
        preview.textContent = url ? "" : "Обои не выбраны";
        removeButton.classList.toggle("hidden", !url);
    },

    async uploadWallpaper(input) {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            UI.showError("settings-wallpaper-error", "Можно загружать только изображения");
            return;
        }
        if (file.size > CONFIG.MAX_WALLPAPER_BYTES) {
            UI.showError("settings-wallpaper-error", "Файл больше 10 МБ");
            return;
        }

        const button = document.getElementById("settings-wallpaper-upload");
        const label = button.textContent;
        button.disabled = true;
        button.textContent = "Загрузка…";
        UI.hideError("settings-wallpaper-error");

        try {
            const data = await API.uploadWallpaper(file);
            Preferences.applyWallpaper(data.url);
            this.renderChatSettings();
            UI.toast("Обои загружены");
        } catch (err) {
            UI.showError("settings-wallpaper-error", err.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    },

    removeWallpaper() {
        Preferences.applyWallpaper("");
        this.renderChatSettings();
        UI.toast("Обои убраны");
    },

    renderScale() {
        const value = Preferences.scale();
        this.scaleInput.value = String(value);
        this.scaleValue.textContent = `${value}%`;
    }
};
