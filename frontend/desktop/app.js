// Входная точка десктопной версии: проверяет сессию и собирает виджеты.

import { Session } from "../shared/session.js";
import { Chat } from "./chat.js";
import { Contacts } from "./contacts.js";
import { Menu } from "./menu.js";
import { Profile } from "./profile.js";
import { Sidebar } from "./sidebar.js";

document.addEventListener("DOMContentLoaded", () => {
    if (!Session.requireAuth()) return;

    Menu.init();
    Profile.init();
    Contacts.init();
    Sidebar.init();
    Chat.init();
});
