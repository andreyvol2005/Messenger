// Входная точка десктопной версии: проверяет сессию и собирает виджеты.

import { Session } from "../shared/session.js";
import { Menu } from "./menu.js";
import { Profile } from "./profile.js";
import { Sidebar } from "./sidebar.js";
import { Chat } from "./chat.js";

document.addEventListener("DOMContentLoaded", () => {
    if (!Session.requireAuth()) return;

    Menu.init();
    Profile.init();
    Sidebar.init();
    Chat.init();
});
