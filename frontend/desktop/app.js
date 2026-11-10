// Входная точка десктопной версии: проверяет сессию и собирает виджеты.

import { Session } from "../shared/session.js";
import { Theme } from "../shared/theme.js";
import { GroupCreate } from "../shared/group-create.js";
import { GroupInfo } from "../shared/group-info.js";
import { Chat } from "./chat.js";
import { Contacts } from "./contacts.js";
import { Menu } from "./menu.js";
import { Profile } from "./profile.js";
import { Sidebar } from "./sidebar.js";
import { PeerInfo } from "./peer-info.js";

document.addEventListener("DOMContentLoaded", () => {
    if (!Session.requireAuth()) return;

    Theme.apply(Session.theme());

    GroupInfo.init({
        onChanged: () => Chat.refreshCurrentChat(),
        onRemovedSelf: () => Chat.closeChat()
    });
    GroupCreate.init({
        onCreated: (chat) => Chat.openChatFromResponse(chat)
    });

    Menu.init();
    Profile.init();
    Contacts.init();
    Sidebar.init();
    PeerInfo.init();
    Chat.init();
});
