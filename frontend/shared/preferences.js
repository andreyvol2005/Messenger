// Клиентские настройки интерфейса: тема, обои чата и масштаб.
// Всё хранится в localStorage — база данных и серверные настройки не меняются.

import { CONFIG } from "./config.js";
import { Session } from "./session.js";
import { Theme } from "./theme.js";

const MIN_SCALE = 100;
const MAX_SCALE = 250;
const DEFAULT_SCALE = 160;

function clampScale(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_SCALE;
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(number)));
}

export const Preferences = {
    MIN_SCALE,
    MAX_SCALE,
    DEFAULT_SCALE,

    scale() {
        const raw = localStorage.getItem(CONFIG.STORAGE.SCALE);
        return raw === null || raw === "" ? DEFAULT_SCALE : clampScale(raw);
    },

    wallpaper() {
        return localStorage.getItem(CONFIG.STORAGE.WALLPAPER) || "";
    },

    // Коэффициент для пересчёта координат указателя: события мыши приходят
    // в экранных пикселях, а элементы внутри #app-root живут в уменьшенной
    // системе координат (см. transform: scale в base.css).
    factor() {
        return this.scale() / 100;
    },

    // Масштаб применяется к #app-root через transform: scale(). Ширина и высота
    // корня делятся на тот же коэффициент, поэтому макет остаётся в границах
    // экрана и не появляется лишняя прокрутка.
    applyScale(value = this.scale(), persist = true) {
        const scale = clampScale(value);
        if (persist) {
            localStorage.setItem(CONFIG.STORAGE.SCALE, String(scale));
        }
        if (document.body) {
            document.body.style.setProperty("--ui-scale", String(scale / 100));
            document.body.dataset.uiScale = String(scale);
        }
        return scale;
    },

    applyWallpaper(url = this.wallpaper(), persist = true) {
        const value = url || "";
        if (persist) {
            if (value) {
                localStorage.setItem(CONFIG.STORAGE.WALLPAPER, value);
            } else {
                localStorage.removeItem(CONFIG.STORAGE.WALLPAPER);
            }
        }
        if (!document.body) return value;

        document.body.classList.toggle("has-wallpaper", Boolean(value));
        if (value) {
            // Кавычки и переводы строк не должны разрывать CSS-значение.
            const safe = value.replace(/["\\\n\r]/g, "");
            document.body.style.setProperty("--chat-wallpaper", `url("${safe}")`);
        } else {
            document.body.style.removeProperty("--chat-wallpaper");
        }
        return value;
    },

    // Применяет все сохранённые настройки при загрузке страницы.
    applyAll() {
        Theme.apply(Session.theme());
        this.applyScale(this.scale(), false);
        this.applyWallpaper(this.wallpaper(), false);
    }
};
