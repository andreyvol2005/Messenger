// Экран входа и регистрации.

import { API } from "../shared/api.js";
import { Session } from "../shared/session.js";
import { UI } from "../shared/ui.js";
import { Validation } from "../shared/validation.js";

const LoginPage = {
    mode: "login",

    init() {
        document.getElementById("tab-login").onclick = () => this.setMode("login");
        document.getElementById("tab-register").onclick = () => this.setMode("register");
        document.getElementById("auth-form").onsubmit = (e) => this.submit(e);
        this.setMode("login");
    },

    setMode(mode) {
        this.mode = mode;
        const isLogin = mode === "login";
        document.getElementById("tab-login").classList.toggle("active", isLogin);
        document.getElementById("tab-register").classList.toggle("active", !isLogin);
        document.getElementById("auth-submit").textContent =
            isLogin ? "Войти" : "Зарегистрироваться";
        document.getElementById("password").autocomplete =
            isLogin ? "current-password" : "new-password";
        document.getElementById("auth-hint").textContent = isLogin
            ? "Вход по логину, без символа @"
            : "Имя создастся автоматически из логина";
        UI.hideError("auth-error");
    },

    async submit(e) {
        e.preventDefault();
        const input = document.getElementById("username");
        const username = input.value.trim();
        const password = document.getElementById("password").value;

        UI.hideError("auth-error");

        const usernameError = Validation.username(username);
        if (usernameError) {
            UI.showError("auth-error", usernameError);
            return;
        }
        if (!password) {
            UI.showError("auth-error", "Введите пароль");
            return;
        }

        try {
            if (this.mode === "register") {
                await API.register(username, password);
                alert("Аккаунт создан. Теперь войдите.");
                this.setMode("login");
                input.value = username;
                document.getElementById("password").focus();
            } else {
                const data = await API.login(username, password);
                Session.save(data);
                window.location.replace(Session.homePath());
            }
        } catch (err) {
            UI.showError("auth-error", err.message);
        }
    }
};

LoginPage.init();
