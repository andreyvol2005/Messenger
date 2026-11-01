// Входная точка десктопной версии: проверяет сессию и собирает виджеты.

import { Session } from "../shared/session.js";
import { Theme } from "../shared/theme.js";
import { Chat } from "./chat.js";
import { Contacts } from "./contacts.js";
import { Menu } from "./menu.js";
import { Profile } from "./profile.js";
import { Sidebar } from "./sidebar.js";
import { PeerInfo } from "./peer-info.js";

document.addEventListener("DOMContentLoaded", () => {
    if (!Session.requireAuth()) return;

    Theme.apply(Session.theme());

    Menu.init();
    Profile.init();
    Contacts.init();
    Sidebar.init();
    PeerInfo.init();
    Chat.init();
});
