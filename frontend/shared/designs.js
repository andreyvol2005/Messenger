// Дизайны интерфейса. Каждый дизайн — набор CSS-переменных и правил в
// shared/designs.css, включаемых атрибутом data-design на <body>, плюс
// собственные параметры (акцент, градиент, размытие и т. п.). Параметры
// превращаются в CSS-переменные --ds-* и атрибуты data-ds-*, поэтому
// переключение происходит мгновенно и без перезагрузки страницы.
// Всё хранится в localStorage, как тема, обои и масштаб.

import { CONFIG } from "./config.js";
import { Session } from "./session.js";
import { Theme } from "./theme.js";

const FONT_LINK_ID = "design-font";
const FONTS_URL = "https://fonts.googleapis.com/css2?";

// Готовые градиенты для Liquid Glass: основа и четыре цветовых пятна.
const GLASS_GRADIENTS = {
    aurora: { base: "#140e3a", c1: "#ff548c", c2: "#ffaa3c", c3: "#2e6eff", c4: "#823cff" },
    sunset: { base: "#2a0e1f", c1: "#ff7a45", c2: "#ffc75f", c3: "#d6336c", c4: "#6a1b9a" },
    ocean: { base: "#061a2e", c1: "#00b4d8", c2: "#7ae7c7", c3: "#0353a4", c4: "#3a0ca3" },
    forest: { base: "#0b1f14", c1: "#2d9f6b", c2: "#c5e063", c3: "#126e82", c4: "#1b4332" },
    graphite: { base: "#121316", c1: "#5e6472", c2: "#a3a9b6", c3: "#2f333b", c4: "#7c8494" }
};

const GLASS_LABELS = {
    aurora: "Аврора",
    sunset: "Закат",
    ocean: "Океан",
    forest: "Лес",
    graphite: "Графит"
};

function gradientSwatch(g) {
    return `linear-gradient(135deg, ${g.c1}, ${g.c2} 35%, ${g.c3} 70%, ${g.c4})`;
}

const TERMINAL_COLORS = {
    green: { fg: "#9cff9c", dim: "#5faf6f", alt: "#ffb347", bg: "#070b07", line: "#2e7a40" },
    amber: { fg: "#ffb347", dim: "#b88038", alt: "#9cff9c", bg: "#0d0905", line: "#7a5420" },
    cyan: { fg: "#7fe7ff", dim: "#4f9fb3", alt: "#ffd36b", bg: "#05090c", line: "#235e6e" },
    white: { fg: "#e8e8e8", dim: "#9a9a9a", alt: "#7fd8ff", bg: "#0a0a0a", line: "#4a4a4a" }
};

function hex(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

// Описание дизайнов. options — параметры, которые показываются в настройках:
//   swatch — выбор из готовых цветов; choice — выбор варианта;
//   color — произвольный цвет; range — ползунок; toggle — переключатель.
// showIf скрывает параметр, пока другой параметр не равен заданному значению.
export const DESIGNS = {
    classic: {
        name: "Классика",
        hint: "Исходный вид приложения. Светлая и тёмная тема на выбор.",
        mode: null,
        preview: { bg: "#1e1e1e", panel: "#232323", in: "#2a2a2a", out: "#1f4d80" },
        options: {}
    },

    midnight: {
        name: "Midnight",
        hint: "Глубокий графит, один яркий акцент и мягкие пузыри.",
        mode: "dark",
        font: "family=Manrope:wght@400;500;600;700;800",
        preview: { bg: "#0b0d12", panel: "#11141a", in: "#1c212b", out: "#3a5bdb" },
        options: {
            accent: {
                type: "swatch", label: "Акцент", default: "#3a5bdb",
                values: ["#3a5bdb", "#7a4fd6", "#0e7c66", "#c2410c"]
            },
            dots: { type: "toggle", label: "Точечный узор в переписке", default: true }
        },
        vars: (o) => ({ "--ds-accent": hex(o.accent, "#3a5bdb") }),
        flags: (o) => ({ dots: o.dots })
    },

    glass: {
        name: "Liquid Glass",
        hint: "Стеклянные панели с размытием поверх цветного градиента.",
        mode: "dark",
        font: "family=Inter:wght@400;500;600;700",
        preview: { bg: "#3a1f6e", panel: "rgba(255, 255, 255, 0.22)", in: "rgba(255, 255, 255, 0.28)", out: "#0a63d6" },
        options: {
            gradient: {
                type: "choice", label: "Градиент фона", default: "aurora",
                values: [
                    ...Object.keys(GLASS_GRADIENTS).map((id) => ({
                        id,
                        label: GLASS_LABELS[id],
                        swatch: gradientSwatch(GLASS_GRADIENTS[id])
                    })),
                    { id: "custom", label: "Свой" }
                ]
            },
            color1: { type: "color", label: "Цвет 1", default: "#ff548c", showIf: { gradient: "custom" } },
            color2: { type: "color", label: "Цвет 2", default: "#ffaa3c", showIf: { gradient: "custom" } },
            color3: { type: "color", label: "Цвет 3", default: "#2e6eff", showIf: { gradient: "custom" } },
            angle: {
                type: "range", label: "Поворот градиента", default: 0,
                min: 0, max: 360, step: 15, unit: "°"
            },
            blur: {
                type: "range", label: "Размытие стекла", default: 30,
                min: 0, max: 60, step: 2, unit: "px"
            },
            tint: {
                type: "range", label: "Затемнение стекла", default: 32,
                min: 0, max: 80, step: 2, unit: "%"
            },
            accent: {
                type: "swatch", label: "Цвет своих сообщений", default: "#0a63d6",
                values: ["#0a63d6", "#7b3de0", "#c2185b", "#0b7a5e"]
            },
            animate: { type: "toggle", label: "Плавное движение фона", default: false }
        },
        vars: (o) => {
            const preset = GLASS_GRADIENTS[o.gradient];
            const colors = preset || {
                base: "#120e26",
                c1: hex(o.color1, "#ff548c"),
                c2: hex(o.color2, "#ffaa3c"),
                c3: hex(o.color3, "#2e6eff"),
                c4: hex(o.color1, "#823cff")
            };
            const blur = Math.min(60, Math.max(0, Number(o.blur) || 0));
            const tint = Math.min(80, Math.max(0, Number(o.tint) || 0));
            const angle = Math.min(360, Math.max(0, Number(o.angle) || 0));
            return {
                "--ds-g-base": colors.base,
                "--ds-g1": colors.c1,
                "--ds-g2": colors.c2,
                "--ds-g3": colors.c3,
                "--ds-g4": colors.c4,
                "--ds-g-angle": `${angle}deg`,
                "--ds-glass-blur": `${blur}px`,
                "--ds-glass-tint": String(tint / 100),
                "--ds-accent": hex(o.accent, "#0a63d6")
            };
        },
        flags: (o) => ({ animate: o.animate })
    },

    paper: {
        name: "Бумага",
        hint: "Светлый строгий стиль: крупный шрифт, тонкие линии, лента сообщений.",
        mode: "light",
        font: "family=Golos+Text:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600",
        preview: { bg: "#f3f1ec", panel: "#faf9f6", in: "#faf9f6", out: "#151515" },
        options: {
            accent: {
                type: "swatch", label: "Акцент", default: "#d23f00",
                values: ["#d23f00", "#1f45d1", "#151515", "#0b7a5e"]
            },
            feed: { type: "toggle", label: "Лента без пузырей", default: true }
        },
        vars: (o) => ({ "--ds-accent": hex(o.accent, "#d23f00") }),
        flags: (o) => ({ feed: o.feed })
    },

    brutal: {
        name: "Брутализм",
        hint: "Яркие цвета, толстые обводки и жёсткие тени.",
        mode: "light",
        font: "family=Rubik:wght@400;500;600;700;800",
        preview: { bg: "#e6deff", panel: "#ffffff", in: "#ffffff", out: "#ffd84d" },
        options: {
            accent: {
                type: "swatch", label: "Свои сообщения и кнопки", default: "#ffd84d",
                values: ["#ffd84d", "#ff9ec7", "#9ee6c4", "#a8c7ff"]
            },
            background: {
                type: "swatch", label: "Фон", default: "#e6deff",
                values: ["#e6deff", "#fff4d6", "#d9f5e8", "#ffe1ec"]
            },
            shadow: {
                type: "range", label: "Глубина тени", default: 5,
                min: 0, max: 10, step: 1, unit: "px"
            }
        },
        vars: (o) => ({
            "--ds-accent": hex(o.accent, "#ffd84d"),
            "--ds-backdrop": hex(o.background, "#e6deff"),
            "--ds-shadow": `${Math.min(10, Math.max(0, Number(o.shadow) || 0))}px`
        })
    },

    terminal: {
        name: "Терминал",
        hint: "Моноширинный шрифт и светящийся текст старого монитора.",
        mode: "dark",
        font: "family=IBM+Plex+Mono:wght@400;500;600;700",
        preview: { bg: "#070b07", panel: "#070b07", in: "#0f1a10", out: "#3a2a10" },
        options: {
            phosphor: {
                type: "choice", label: "Цвет люминофора", default: "green",
                values: [
                    { id: "green", label: "Зелёный" },
                    { id: "amber", label: "Янтарный" },
                    { id: "cyan", label: "Голубой" },
                    { id: "white", label: "Белый" }
                ]
            },
            scanlines: { type: "toggle", label: "Строки развёртки", default: true },
            glow: { type: "toggle", label: "Свечение текста", default: true }
        },
        vars: (o) => {
            const c = TERMINAL_COLORS[o.phosphor] || TERMINAL_COLORS.green;
            return {
                "--ds-fg": c.fg,
                "--ds-dim": c.dim,
                "--ds-alt": c.alt,
                "--ds-term-bg": c.bg,
                "--ds-line": c.line
            };
        },
        flags: (o) => ({ scanlines: o.scanlines, glow: o.glow })
    },

    retro: {
        name: "Ретро-98",
        hint: "Серые объёмные окна и синие заголовки, как в мессенджерах нулевых.",
        mode: "light",
        font: null,
        preview: { bg: "#008080", panel: "#c0c0c0", in: "#ffffff", out: "#ffffe1" },
        options: {
            titlebar: {
                type: "swatch", label: "Заголовки окон", default: "#000080",
                values: ["#000080", "#800000", "#006400", "#400080"]
            },
            desktop: {
                type: "swatch", label: "Рабочий стол", default: "#008080",
                values: ["#008080", "#3a6ea5", "#5a4a7a", "#4a6a3a"]
            }
        },
        vars: (o) => ({
            "--ds-accent": hex(o.titlebar, "#000080"),
            "--ds-desktop": hex(o.desktop, "#008080")
        })
    },

    air: {
        name: "Воздух",
        hint: "Светлый и спокойный: много воздуха, мягкие тени.",
        mode: "light",
        font: "family=Onest:wght@400;500;600;700",
        preview: { bg: "#f2f3f0", panel: "#ffffff", in: "#dfe3dc", out: "#2b6e51" },
        options: {
            accent: {
                type: "swatch", label: "Акцент", default: "#2b6e51",
                values: ["#2b6e51", "#3a55c8", "#b4472d", "#1d2321"]
            }
        },
        vars: (o) => ({ "--ds-accent": hex(o.accent, "#2b6e51") })
    }
};

export const DEFAULT_DESIGN = "classic";

function readAllOptions() {
    try {
        const parsed = JSON.parse(localStorage.getItem(CONFIG.STORAGE.DESIGN_OPTIONS) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function loadFont(query) {
    const existing = document.getElementById(FONT_LINK_ID);
    if (!query) {
        if (existing) existing.remove();
        return;
    }
    const href = FONTS_URL + query + "&display=swap";
    if (existing && existing.getAttribute("href") === href) return;

    const link = existing || document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = href;
    if (!existing) document.head.appendChild(link);
}

export const Design = {
    list() {
        return Object.entries(DESIGNS).map(([id, def]) => ({ id, ...def }));
    },

    current() {
        const id = localStorage.getItem(CONFIG.STORAGE.DESIGN);
        return DESIGNS[id] ? id : DEFAULT_DESIGN;
    },

    // Сохранённые параметры дизайна поверх значений по умолчанию.
    options(id = this.current()) {
        const def = DESIGNS[id];
        if (!def) return {};
        const saved = readAllOptions()[id] || {};
        const result = {};
        Object.entries(def.options).forEach(([key, option]) => {
            result[key] = key in saved ? saved[key] : option.default;
        });
        return result;
    },

    // Тема дизайна фиксирована (mode) или выбирается пользователем (classic).
    forcedMode(id = this.current()) {
        return DESIGNS[id]?.mode || null;
    },

    select(id) {
        if (!DESIGNS[id]) return this.current();
        localStorage.setItem(CONFIG.STORAGE.DESIGN, id);
        this.apply(id);
        return id;
    },

    setOption(key, value, id = this.current()) {
        const def = DESIGNS[id];
        if (!def || !def.options[key]) return;
        const all = readAllOptions();
        all[id] = { ...(all[id] || {}), [key]: value };
        localStorage.setItem(CONFIG.STORAGE.DESIGN_OPTIONS, JSON.stringify(all));
        if (id === this.current()) this.apply(id);
    },

    resetOptions(id = this.current()) {
        const all = readAllOptions();
        delete all[id];
        localStorage.setItem(CONFIG.STORAGE.DESIGN_OPTIONS, JSON.stringify(all));
        if (id === this.current()) this.apply(id);
    },

    apply(id = this.current()) {
        const body = document.body;
        if (!body) return id;
        const def = DESIGNS[id] || DESIGNS[DEFAULT_DESIGN];
        const options = this.options(id);

        // Убираем переменные и флаги прошлого дизайна
        (this.appliedVars || []).forEach((name) => body.style.removeProperty(name));
        Object.keys(body.dataset)
            .filter((key) => key.startsWith("ds") && key !== "ds")
            .forEach((key) => delete body.dataset[key]);

        const vars = def.vars ? def.vars(options) : {};
        Object.entries(vars).forEach(([name, value]) => body.style.setProperty(name, value));
        this.appliedVars = Object.keys(vars);

        const flags = def.flags ? def.flags(options) : {};
        Object.entries(flags).forEach(([key, value]) => {
            const name = "ds" + key.charAt(0).toUpperCase() + key.slice(1);
            body.dataset[name] = value ? "on" : "off";
        });

        // «Классика» — исходный вид: атрибут не ставим, и designs.css не
        // затрагивает ни одного правила base.css.
        if (id === DEFAULT_DESIGN) {
            body.removeAttribute("data-design");
        } else {
            body.dataset.design = id;
        }

        if (def.mode) {
            body.setAttribute("data-theme", def.mode);
            document.documentElement.style.colorScheme = def.mode;
        } else {
            Theme.apply(Session.theme());
        }

        loadFont(def.font);
        document.dispatchEvent(new CustomEvent("messenger:design-changed", {
            detail: { id, options }
        }));
        return id;
    }
};
