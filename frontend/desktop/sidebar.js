// Изменение ширины левой панели: перетаскивание разделителя и двойной клик.

export const Sidebar = {
    MIN: 0,
    MAX: 560,
    DEFAULT: 280,
    // При сужении панель останавливается на 150 px, а при дальнейшем
    // движении курсора влево сразу схлопывается полностью — как в Telegram.
    SNAP: 150,
    KEY: "messenger_sidebar_width",

    init() {
        this.sidebar = document.querySelector(".chat-sidebar");
        this.handle = document.getElementById("sidebar-resizer");
        if (!this.sidebar || !this.handle) return;

        // 0 — допустимая ширина (панель свёрнута), поэтому проверяем не на
        // truthy, а на то, что значение вообще сохранено и является числом
        const raw = localStorage.getItem(this.KEY);
        if (raw !== null && raw !== "") {
            const saved = Number(raw);
            if (Number.isFinite(saved)) this.apply(this.snap(saved));
        }

        this.handle.addEventListener("pointerdown", (e) => this.start(e));

        this.handle.addEventListener("dblclick", () => {
            localStorage.removeItem(this.KEY);
            this.apply(this.DEFAULT);
        });
    },

    clamp(width) {
        return Math.min(this.MAX, Math.max(this.MIN, width));
    },

    snap(width) {
        // Ширины от 1 до 149 px не показываем: панель либо остаётся
        // 150-пиксельной полосой, либо закрывается полностью.
        if (width <= 0) return 0;
        if (width < this.SNAP) return this.SNAP;
        return this.clamp(width);
    },

    apply(width) {
        document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
        // На нуле убираем разделительную рамку, чтобы панель исчезла полностью
        if (this.sidebar) {
            this.sidebar.classList.toggle("collapsed", width <= 0);
        }
    },

    start(e) {
        e.preventDefault();
        this.startX = e.clientX;
        this.startWidth = this.sidebar.getBoundingClientRect().width;
        document.body.classList.add("resizing");
        this.handle.classList.add("active");
        this.handle.setPointerCapture(e.pointerId);

        this.onMove = (ev) => {
            this.apply(this.snap(this.startWidth + ev.clientX - this.startX));
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
