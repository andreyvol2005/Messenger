// Полноэкранный просмотр изображений: открывается по клику на картинку в
// переписке. Масштаб меняется кнопками, колесом мыши и жестом «щипок»,
// увеличенное изображение можно перетаскивать, чтобы рассмотреть детали.

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

let viewer = null;
let zoom = 1;
let panX = 0;
let panY = 0;
let lastFocus = null;
let pointers = new Map();
let drag = null;
let pinch = null;
let ignoreClickUntil = 0;

function makeButton(className, text, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.title = label;
    button.setAttribute("aria-label", label);
    return button;
}

function buildViewer() {
    const overlay = document.createElement("div");
    overlay.className = "image-viewer hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Просмотр изображения");
    overlay.setAttribute("aria-hidden", "true");

    const stage = document.createElement("div");
    stage.className = "image-viewer-stage";

    const image = document.createElement("img");
    image.className = "image-viewer-image";
    image.alt = "Изображение";
    image.draggable = false;
    stage.appendChild(image);

    const close = makeButton("image-viewer-close", "×", "Закрыть просмотр");
    close.setAttribute("aria-label", "Закрыть просмотр");
    close.title = "Закрыть";

    const toolbar = document.createElement("div");
    toolbar.className = "image-viewer-toolbar";
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Масштаб изображения");

    const zoomOut = makeButton("image-viewer-button", "−", "Уменьшить");
    const zoomLabel = document.createElement("span");
    zoomLabel.className = "image-viewer-zoom";
    zoomLabel.textContent = "100%";
    const zoomIn = makeButton("image-viewer-button", "+", "Увеличить");
    const reset = makeButton(
        "image-viewer-button image-viewer-reset", "⟲", "Сбросить масштаб"
    );

    toolbar.append(zoomOut, zoomLabel, zoomIn, reset);
    overlay.append(stage, close, toolbar);
    document.body.appendChild(overlay);

    viewer = { overlay, stage, image, close, zoomLabel };

    zoomOut.addEventListener("click", () => setZoom(zoom / ZOOM_STEP));
    zoomIn.addEventListener("click", () => setZoom(zoom * ZOOM_STEP));
    reset.addEventListener("click", resetView);
    close.addEventListener("click", closeViewer);

    stage.addEventListener("pointerdown", handlePointerDown);
    stage.addEventListener("pointermove", handlePointerMove);
    stage.addEventListener("pointerup", handlePointerUp);
    stage.addEventListener("pointercancel", handlePointerUp);
    stage.addEventListener("click", handleStageClick);
    image.addEventListener("dblclick", handleDoubleClick);
    image.addEventListener("load", () => {
        clampPan();
        applyTransform();
    });

    overlay.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", () => {
        if (!viewer || viewer.overlay.classList.contains("hidden")) return;
        clampPan();
        applyTransform();
    });
    return viewer;
}

function ensureViewer() {
    return viewer || buildViewer();
}

function applyTransform() {
    if (!viewer) return;
    viewer.image.style.transform =
        `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
    viewer.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    viewer.stage.classList.toggle("is-zoomed", zoom > 1.001);
}

function clampPan() {
    if (!viewer) return;
    const maxX = Math.max(
        0, (viewer.image.offsetWidth * zoom - viewer.stage.clientWidth) / 2
    );
    const maxY = Math.max(
        0, (viewer.image.offsetHeight * zoom - viewer.stage.clientHeight) / 2
    );
    panX = Math.min(maxX, Math.max(-maxX, panX));
    panY = Math.min(maxY, Math.max(-maxY, panY));
}

function setZoom(value) {
    if (!Number.isFinite(value)) return;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    clampPan();
    applyTransform();
}

function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyTransform();
}

export function openImageLightbox(src, alt) {
    if (!src) return;
    const current = ensureViewer();
    lastFocus = document.activeElement;
    current.image.src = src;
    current.image.alt = alt || "Изображение";
    resetView();
    current.overlay.classList.remove("hidden");
    current.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("image-viewer-open");
    current.close.focus({ preventScroll: true });
}

export function closeImageLightbox() {
    closeViewer();
}

function closeViewer() {
    if (!viewer || viewer.overlay.classList.contains("hidden")) return;
    viewer.overlay.classList.add("hidden");
    viewer.overlay.setAttribute("aria-hidden", "true");
    viewer.overlay.classList.remove("is-dragging");
    document.body.classList.remove("image-viewer-open");
    pointers.clear();
    drag = null;
    pinch = null;
    resetView();
    if (lastFocus && typeof lastFocus.focus === "function") {
        lastFocus.focus({ preventScroll: true });
    }
    lastFocus = null;
}

function pointerDistance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
}

function capturePointer(pointerId) {
    try {
        viewer.stage.setPointerCapture(pointerId);
    } catch (err) {
        // Синтетические события и старые браузеры могут не поддерживать захват
    }
}

function releasePointer(pointerId) {
    try {
        if (viewer.stage.hasPointerCapture(pointerId)) {
            viewer.stage.releasePointerCapture(pointerId);
        }
    } catch (err) {
        // см. capturePointer
    }
}

function handlePointerDown(event) {
    if (!viewer || viewer.overlay.classList.contains("hidden")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target !== viewer.stage && event.target !== viewer.image) return;

    // Захват указателя включаем только при перетаскивании: иначе клик по
    // картинке перенаправляется на подложку и просмотр закрывается сам собой.
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
        drag = {
            startX: event.clientX,
            startY: event.clientY,
            startPanX: panX,
            startPanY: panY,
            moved: false
        };
        pinch = null;
    } else if (pointers.size === 2) {
        const [first, second] = pointers.values();
        pinch = {
            distance: pointerDistance(first, second),
            zoom,
            moved: false
        };
        drag = null;
    }
}

function handlePointerMove(event) {
    if (!viewer || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2 && pinch) {
        const [first, second] = pointers.values();
        const distance = pointerDistance(first, second);
        if (pinch.distance > 0 && distance > 0) {
            const factor = distance / pinch.distance;
            if (Math.abs(factor - 1) > 0.01 && !pinch.moved) {
                pinch.moved = true;
                for (const pointerId of pointers.keys()) {
                    capturePointer(pointerId);
                }
            }
            setZoom(pinch.zoom * factor);
            if (pinch.moved) ignoreClickUntil = performance.now() + 350;
        }
        return;
    }

    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) >= 4) {
        drag.moved = true;
        capturePointer(event.pointerId);
        viewer.overlay.classList.add("is-dragging");
    }
    if (!drag.moved) return;

    panX = drag.startPanX + dx;
    panY = drag.startPanY + dy;
    clampPan();
    applyTransform();
}

function handlePointerUp(event) {
    if (!viewer || !pointers.has(event.pointerId)) return;
    const dragged = Boolean(drag && drag.moved);
    const pinched = Boolean(pinch && pinch.moved);

    pointers.delete(event.pointerId);
    releasePointer(event.pointerId);

    if (pointers.size === 0) {
        drag = null;
        pinch = null;
        viewer.overlay.classList.remove("is-dragging");
        if (dragged || pinched) {
            ignoreClickUntil = performance.now() + 350;
        }
    } else if (pointers.size === 1) {
        const [remaining] = pointers.values();
        drag = {
            startX: remaining.x,
            startY: remaining.y,
            startPanX: panX,
            startPanY: panY,
            moved: true
        };
        pinch = null;
    }
}

function handleStageClick(event) {
    if (!viewer) return;
    if (performance.now() < ignoreClickUntil) return;
    if (event.target !== viewer.stage) return;

    // Клик по затемнённому фону закрывает просмотр, по самой картинке — нет.
    // Координаты нужны на случай захвата указателя при перетаскивании.
    const rect = viewer.image.getBoundingClientRect();
    const insideImage = event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
    if (!insideImage) closeViewer();
}

function handleDoubleClick(event) {
    event.preventDefault();
    if (zoom > 1.001) {
        resetView();
    } else {
        setZoom(2.5);
    }
}

function handleWheel(event) {
    if (!viewer || viewer.overlay.classList.contains("hidden")) return;
    if (event.target.closest(".image-viewer-toolbar, .image-viewer-close")) return;
    event.preventDefault();
    const unit = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
            ? viewer.stage.clientHeight
            : 1;
    const delta = event.deltaY * unit;
    setZoom(zoom * Math.exp(-delta * 0.0015));
}

function handleKeyDown(event) {
    if (!viewer || viewer.overlay.classList.contains("hidden")) return;

    if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
        return;
    }
    if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom(zoom * ZOOM_STEP);
        return;
    }
    if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom(zoom / ZOOM_STEP);
        return;
    }
    if (event.key === "0") {
        event.preventDefault();
        resetView();
        return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...viewer.overlay.querySelectorAll("button")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}
