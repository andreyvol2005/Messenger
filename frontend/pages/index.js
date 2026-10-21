// Единая точка входа: смотрим, есть ли сессия, и уводим на нужную версию.

import { PATHS } from "../shared/config.js";
import { Session } from "../shared/session.js";

window.location.replace(Session.token() ? Session.homePath() : PATHS.LOGIN);
