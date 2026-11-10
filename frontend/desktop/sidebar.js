// Изменение ширины левой панели: перетаскивание разделителя и двойной клик.

import { Preferences } from "../shared/preferences.js";

export const Sidebar = {
    // Минимальная ширина — колонка только с аватарками чатов
    MIN: 72,
    MAX: 560,
    DEFAULT: 280,
    // При сужении панель останавливается на 200 px, а при дальнейшем
    // движении курсора влево сразу сворачивается до одних аватарок.
    SNAP: 200,
    KEY: "messenger_sidebar_width",

    init() {
        this.sidebar = document.querySelector(".chat-sidebar");
        this.handle = document.getElementById("sidebar-resizer");
        if (!this.sidebar || !this.handle) return;

        this.handle.setAttribute("aria-valuemin", String(this.MIN));
        this.handle.setAttribute("aria-valuemax", String(this.MAX));

        // 0 из старой версии больше не сворачивает панель полностью:
        // минимальное состояние — колонка с иконками чатов.
        const raw = localStorage.getItem(this.KEY);
        const saved = raw !== null && raw !== "" ? Number(raw) : NaN;
        this.apply(Number.isFinite(saved) ? saved : this.DEFAULT);

        this.handle.addEventListener("pointerdown", (e) => this.start(e));

        this.handle.addEventListener("dblclick", () => {
            localStorage.removeItem(this.KEY);
            this.apply(this.DEFAULT);
        });
    },

    clamp(width) {
        return Math.min(this.MAX, Math.max(this.MIN, Math.round(width)));
    },

    snap(width) {
        // Промежуточные ширины не показываем: панель либо остаётся
        // 200-пиксельной, либо сворачивается до колонки с аватарками.
        if (width <= 0) return this.MIN;
        if (width < this.SNAP) return this.SNAP;
        return this.clamp(width);
    },

    apply(width) {
        const snapped = this.snap(width);
        document.documentElement.style.setProperty(
            "--sidebar-width",
            `${snapped}px`
        );
        // В узком состоянии прячем поиск и подписи, оставляя только аватарки
        this.sidebar.classList.toggle("icons", snapped <= this.MIN);
        this.handle.setAttribute("aria-valuenow", String(snapped));
    },

    start(e) {
        e.preventDefault();
        const factor = Preferences.factor();
        this.startX = e.clientX;
        // Ширина хранится в CSS-пикселях, а указатель двигается в экранных:
        // при масштабе 160% один экранный пиксель — это 0.625 CSS-пикселя.
        this.startWidth = this.sidebar.getBoundingClientRect().width / factor;
        this.factor = factor;
        document.body.classList.add("resizing");
        this.handle.classList.add("active");
        this.handle.setPointerCapture(e.pointerId);

        this.onMove = (ev) => {
            this.apply(this.startWidth + (ev.clientX - this.startX) / this.factor);
        };
        this.onUp = () => this.stop();

        this.handle.addEventListener("pointermove", this.onMove);
        this.handle.addEventListener("pointerup", this.onUp);
        this.handle.addEventListener("pointercancel", this.onUp);
    },

    stop() {
        document.body.classList.remove("resizing");
        this.handle.classList.remove("active");
        this.handle.removeEventListener("pointermove", this.onMove);
        this.handle.removeEventListener("pointerup", this.onUp);
        this.handle.removeEventListener("pointercancel", this.onUp);

        const width = Math.round(
            this.sidebar.getBoundingClientRect().width / Preferences.factor()
        );
        // Свёрнутое состояние храним как 0 — так же, как старая версия,
        // чтобы после перезагрузки снова открыться колонкой с аватарками.
        localStorage.setItem(this.KEY, width <= this.MIN ? "0" : String(width));
    }
};
