// Входная точка десктопной версии: проверяет сессию и собирает виджеты.

import { Preferences } from "../shared/preferences.js";
import { Session } from "../shared/session.js";
import { Settings } from "../shared/settings.js";
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

    Preferences.applyAll();
    Settings.init();

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
