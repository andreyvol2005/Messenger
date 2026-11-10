// Изменение ширины левой панели: перетаскивание разделителя и двойной клик.

export const Sidebar = {
    // Минимальная ширина — колонка только с аватарками чатов
    MIN: 72,
    MAX: 560,
    DEFAULT: 280,
    // Ниже этой ширины текст в списке скрывается, остаются только иконки
    ICONS: 150,
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

    apply(width) {
        const clamped = this.clamp(width);
        document.documentElement.style.setProperty(
            "--sidebar-width",
            `${clamped}px`
        );
        // В узком состоянии прячем поиск и подписи, оставляя только аватарки
        this.sidebar.classList.toggle("icons", clamped <= this.ICONS);
        this.handle.setAttribute("aria-valuenow", String(clamped));
    },

    start(e) {
        e.preventDefault();
        this.startX = e.clientX;
        this.startWidth = this.sidebar.getBoundingClientRect().width;
        document.body.classList.add("resizing");
        this.handle.classList.add("active");
        this.handle.setPointerCapture(e.pointerId);

        this.onMove = (ev) => {
            this.apply(this.startWidth + ev.clientX - this.startX);
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

        const width = Math.round(this.sidebar.getBoundingClientRect().width);
        localStorage.setItem(this.KEY, String(width));
    }
};
