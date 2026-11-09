// Контекстное меню сообщений, выбор нескольких сообщений, ответ, правка,
// удаление и пересылка. Модуль общий для десктопной и мобильной версий:
// отличается только способ вызова меню (ПКМ или долгое нажатие).

import { API } from "./api.js";
import { CONFIG } from "./config.js";
import {
    appendMessage,
    removeMessageRow,
    updateMessageRow
} from "./messages.js";
import { Session } from "./session.js";
import { UI } from "./ui.js";

const LONG_PRESS_MS = 500;

export const MessageActions = {
    mode: "desktop",
    classes: null,
    getChatId: () => null,
    onChanged: null,

    menu: null,
    selectionMode: false,
    selected: new Map(),

    reply: null,
    edit: null,

    forwardMessages: [],
    deleteResolve: null,
    lastLongPressAt: 0,
    suppressClick: false,

    init({ mode, classes, getChatId, onChanged }) {
        this.mode = mode;
        this.classes = classes;
        this.getChatId = getChatId;
        this.onChanged = onChanged || null;

        this.ensureMenu();
        this.ensureDeleteModal();
        this.ensureForwardModal();
        this.bindMessagesBox();
        this.bindSelectionPanel();
        this.bindComposerBanner();
        this.bindKeyboard();
    },

    box() {
        return document.getElementById("messages");
    },

    input() {
        return document.getElementById("message-input");
    },

    // ---------- Настройки общего рендера ----------

    messageOptions() {
        return {
            classes: this.classes,
            showStatus: this.getChatId() !== CONFIG.FAVORITES_CHAT_ID,
            isSelected: (id) => this.selected.has(id),
            onToggleSelect: (msg) => this.toggleSelection(msg),
            onQuoteClick: (id) => this.jumpToMessage(id),
            findMessage: (id) => this.findMessage(id)
        };
    },

    findMessage(messageId) {
        if (messageId === null || messageId === undefined) return null;
        const box = this.box();
        if (!box) return null;
        const row = box.querySelector(`[data-msg-id="${messageId}"]`);
        return row ? row.__message : null;
    },

    jumpToMessage(messageId) {
        const row = this.box()?.querySelector(`[data-msg-id="${messageId}"]`);
        if (!row) {
            UI.toast("Сообщение не загружено");
            return;
        }
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        row.classList.remove("message-jump");
        // Перезапуск анимации, если кликнули по той же цитате дважды
        void row.offsetWidth;
        row.classList.add("message-jump");
        setTimeout(() => row.classList.remove("message-jump"), 1200);
    },

    // ---------- Контекстное меню ----------

    ensureMenu() {
        if (this.menu) return;
        const menu = UI.el("div", "ma-menu hidden");
        menu.id = "message-context-menu";
        menu.setAttribute("role", "menu");
        menu.addEventListener("contextmenu", (event) => event.preventDefault());
        menu.addEventListener("click", (event) => {
            const button = event.target.closest("[data-action]");
            if (!button || button.disabled) return;
            const message = this.menuMessage;
            this.closeMenu();
            this.runAction(button.dataset.action, message);
        });
        document.body.appendChild(menu);
        this.menu = menu;
    },

    openMenu(x, y, msg) {
        this.ensureMenu();
        this.menuMessage = msg;
        const menu = this.menu;
        menu.innerHTML = "";

        const items = msg ? this.contextItems(msg) : [
            { action: "select", label: "Выделить", icon: "☑" }
        ];
        for (const item of items) {
            if (item.hidden) continue;
            const button = UI.el(
                "button",
                "ma-menu-item" + (item.danger ? " danger" : "")
            );
            button.type = "button";
            button.dataset.action = item.action;
            button.disabled = Boolean(item.disabled);
            button.appendChild(UI.el("span", "ma-menu-icon", item.icon || ""));
            button.appendChild(UI.el("span", "ma-menu-label", item.label));
            menu.appendChild(button);
        }

        menu.classList.remove("hidden");
        menu.style.left = "0px";
        menu.style.top = "0px";

        // После отрисовки пододвигаем меню, чтобы оно не вышло за экран
        const rect = menu.getBoundingClientRect();
        const margin = 8;
        const left = Math.min(
            Math.max(margin, x),
            Math.max(margin, window.innerWidth - rect.width - margin)
        );
        const top = Math.min(
            Math.max(margin, y),
            Math.max(margin, window.innerHeight - rect.height - margin)
        );
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    },

    contextItems(msg) {
        const mine = msg.sender_id === Session.userId();
        if (msg.is_deleted) {
            // У заглушки разрешён только ответ
            return [
                { action: "reply", label: "Ответить", icon: "↩" },
                { action: "select", label: "Выделить", icon: "☑" }
            ];
        }

        const items = [
            {
                action: "copy",
                label: "Копировать",
                icon: "⧉",
                disabled: !msg.text
            },
            { action: "reply", label: "Ответить", icon: "↩" },
            { action: "forward", label: "Переслать", icon: "↪" }
        ];
        if (mine) {
            items.push({ action: "edit", label: "Редактировать", icon: "✎" });
            items.push({ action: "delete", label: "Удалить", icon: "🗑", danger: true });
        }
        items.push({ action: "select", label: "Выделить", icon: "☑" });
        return items;
    },

    closeMenu() {
        if (!this.menu) return;
        this.menu.classList.add("hidden");
        this.menuMessage = null;
    },

    runAction(action, msg) {
        if (action === "select") {
            this.enterSelection(msg);
            return;
        }
        if (!msg) return;

        if (action === "copy") this.copyMessages([msg]);
        else if (action === "reply") this.beginReply(msg);
        else if (action === "forward") this.openForwardDialog([msg]);
        else if (action === "edit") this.beginEdit(msg);
        else if (action === "delete") this.confirmAndDelete([msg]);
    },

    // ---------- ПКМ и долгое нажатие ----------

    bindMessagesBox() {
        const box = this.box();
        if (!box) return;

        box.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            if (Date.now() - this.lastLongPressAt < 700) return;
            const row = event.target.closest("[data-msg-id]");
            this.openMenu(
                event.clientX,
                event.clientY,
                row ? row.__message : null
            );
        });

        // В режиме выбора клик по сообщению переключает галочку, а не открывает
        // картинку или цитату.
        box.addEventListener("click", (event) => {
            if (!this.selectionMode) return;
            if (event.target.closest(".message-select")) return;
            const row = event.target.closest("[data-msg-id]");
            if (!row) return;
            event.preventDefault();
            event.stopPropagation();
            this.toggleSelection(row.__message);
        }, true);

        box.addEventListener("scroll", () => this.closeMenu(), { passive: true });
        window.addEventListener("resize", () => this.closeMenu());

        if (this.mode === "mobile") this.bindLongPress(box);
    },

    bindLongPress(box) {
        let timer = null;
        let startX = 0;
        let startY = 0;
        let targetRow = null;

        const cancel = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            targetRow = null;
        };

        box.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "mouse") return;
            if (event.button !== undefined && event.button !== 0) return;
            cancel();
            startX = event.clientX;
            startY = event.clientY;
            targetRow = event.target.closest("[data-msg-id]");
            timer = setTimeout(() => {
                timer = null;
                this.suppressClick = true;
                this.lastLongPressAt = Date.now();
                if (navigator.vibrate) navigator.vibrate(10);
                this.openMenu(
                    startX,
                    startY,
                    targetRow ? targetRow.__message : null
                );
            }, LONG_PRESS_MS);
        }, { passive: true });

        box.addEventListener("pointermove", (event) => {
            if (!timer) return;
            if (
                Math.abs(event.clientX - startX) > 10
                || Math.abs(event.clientY - startY) > 10
            ) {
                cancel();
            }
        }, { passive: true });

        box.addEventListener("pointerup", cancel, { passive: true });
        box.addEventListener("pointercancel", cancel, { passive: true });

        // После долгого нажатия браузер может прислать click — не даём ему
        // открыть картинку или переключить сообщение ещё раз.
        box.addEventListener("click", (event) => {
            if (!this.suppressClick) return;
            this.suppressClick = false;
            event.preventDefault();
            event.stopPropagation();
        }, true);
    },

    // ---------- Выбор нескольких сообщений ----------

    enterSelection(msg = null) {
        this.selectionMode = true;
        this.selected.clear();
        if (msg) this.selected.set(msg.id, msg);
        this.box()?.classList.add("selection-mode");
        this.syncSelectionUI();
    },

    exitSelection() {
        this.selectionMode = false;
        this.selected.clear();
        this.box()?.classList.remove("selection-mode");
        this.syncSelectionUI();
    },

    toggleSelection(msg) {
        if (!msg) return;
        if (!this.selectionMode) {
            this.enterSelection(msg);
            return;
        }
        if (this.selected.has(msg.id)) this.selected.delete(msg.id);
        else this.selected.set(msg.id, msg);
        this.syncSelectionUI();
    },

    selectedMessages() {
        const box = this.box();
        if (!box) return [];
        return [...box.querySelectorAll("[data-msg-id]")]
            .map((row) => row.__message)
            .filter((msg) => msg && this.selected.has(msg.id));
    },

    syncSelectionUI() {
        const box = this.box();
        if (box) {
            for (const row of box.querySelectorAll("[data-msg-id]")) {
                const selected = this.selected.has(row.__message?.id);
                row.classList.toggle("selected", selected);
                const check = row.querySelector(".message-select");
                if (check) {
                    check.classList.toggle("checked", selected);
                    check.setAttribute("aria-checked", selected ? "true" : "false");
                    check.title = selected ? "Снять выбор" : "Выбрать";
                }
            }
        }
        this.renderSelectionPanel();
    },

    bindSelectionPanel() {
        const panel = document.getElementById("selection-panel");
        if (!panel) return;
        panel.addEventListener("click", (event) => {
            const button = event.target.closest("[data-selection-action]");
            if (!button || button.disabled) return;
            const action = button.dataset.selectionAction;
            const items = this.selectedMessages();
            if (action === "cancel") {
                this.exitSelection();
                return;
            }
            if (action === "copy") {
                this.copyMessages(items);
                this.exitSelection();
            } else if (action === "reply" && items.length === 1) {
                this.exitSelection();
                this.beginReply(items[0]);
            } else if (action === "forward" && items.length) {
                this.openForwardDialog(items);
            } else if (action === "edit" && items.length === 1) {
                this.exitSelection();
                this.beginEdit(items[0]);
            } else if (action === "delete" && items.length) {
                this.confirmAndDelete(items);
            }
        });
    },

    renderSelectionPanel() {
        const panel = document.getElementById("selection-panel");
        if (!panel) return;
        panel.classList.toggle("hidden", !this.selectionMode);
        if (!this.selectionMode) return;

        const items = this.selectedMessages();
        const count = document.getElementById("selection-count");
        if (count) {
            count.textContent = items.length
                ? `Выбрано: ${items.length}`
                : "Выберите сообщения";
        }

        const one = items.length === 1 ? items[0] : null;
        const canCopy = items.some((msg) => msg.text && !msg.is_deleted);
        const canForward = items.length > 0 && items.every((msg) => !msg.is_deleted);
        const canDelete = items.length > 0 && items.every(
            (msg) => msg.sender_id === Session.userId() && !msg.is_deleted
        );
        const canReply = Boolean(one);
        const canEdit = Boolean(
            one && one.sender_id === Session.userId() && !one.is_deleted
        );

        const states = {
            copy: canCopy,
            reply: canReply,
            forward: canForward,
            edit: canEdit,
            delete: canDelete
        };
        for (const button of panel.querySelectorAll("[data-selection-action]")) {
            const action = button.dataset.selectionAction;
            if (action in states) button.disabled = !states[action];
        }
    },

    // ---------- Копирование ----------

    async copyMessages(messages) {
        const text = messages
            .filter((msg) => msg && msg.text && !msg.is_deleted)
            .map((msg) => msg.text)
            .join("\n");
        if (!text) {
            UI.toast("Нет текста для копирования");
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            // На http-стенде Clipboard API может быть недоступен
            const area = document.createElement("textarea");
            area.value = text;
            area.setAttribute("readonly", "");
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            area.remove();
        }
        UI.toast("Скопировано");
    },

    // ---------- Ответ и правка в нижнем поле ----------

    banner() {
        return document.getElementById("composer-banner");
    },

    showBanner(kind, label, title, preview) {
        const banner = this.banner();
        if (!banner) return;
        banner.classList.remove("hidden");
        banner.dataset.kind = kind;
        const labelNode = document.getElementById("composer-banner-label");
        const titleNode = document.getElementById("composer-banner-title");
        const previewNode = document.getElementById("composer-banner-preview");
        const fileNode = document.getElementById("composer-banner-file");
        if (labelNode) labelNode.textContent = label;
        if (titleNode) titleNode.textContent = title || "";
        if (previewNode) previewNode.textContent = preview || "";
        if (fileNode) {
            fileNode.textContent = "";
            fileNode.classList.add("hidden");
        }
    },

    hideBannerIfIdle() {
        if (this.reply || this.edit) return;
        const banner = this.banner();
        if (banner) banner.classList.add("hidden");
        const fileNode = document.getElementById("composer-banner-file");
        if (fileNode) {
            fileNode.textContent = "";
            fileNode.classList.add("hidden");
        }
    },

    bindComposerBanner() {
        const cancel = document.getElementById("composer-banner-cancel");
        if (!cancel) return;
        cancel.addEventListener("click", () => {
            if (this.edit) this.cancelEdit();
            else this.clearReply();
        });
    },

    beginReply(msg) {
        if (!msg) return;
        if (this.edit) this.cancelEdit();
        this.reply = msg;
        const preview = msg.is_deleted
            ? "Сообщение удалено"
            : (msg.text || (msg.media_url ? "📷 Изображение" : "Сообщение"));
        this.showBanner(
            "reply",
            "Ответ",
            msg.sender_nickname || "Сообщение",
            preview
        );
        this.input()?.focus();
    },

    replyToId() {
        return this.reply ? this.reply.id : null;
    },

    clearReply() {
        this.reply = null;
        this.hideBannerIfIdle();
    },

    beginEdit(msg) {
        if (!msg) return;
        if (msg.sender_id !== Session.userId() || msg.is_deleted) return;

        if (this.edit && this.edit.message.id === msg.id) {
            this.input()?.focus();
            return;
        }
        if (this.edit) this.cancelEdit();
        this.reply = null;

        const input = this.input();
        this.edit = {
            message: msg,
            file: null,
            draftBackup: input ? input.value : ""
        };

        if (input) {
            input.value = msg.text || "";
            this.resizeInput(input);
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }

        const preview = msg.media_url && !msg.text
            ? "Подпись к изображению"
            : (msg.text || "Без текста");
        this.showBanner("edit", "Редактирование", "Изменение сообщения", preview);
    },

    setEditImage(file) {
        if (!this.edit || !file) return;
        this.edit.file = file;
        const fileNode = document.getElementById("composer-banner-file");
        if (fileNode) {
            fileNode.textContent = `Новое изображение: ${file.name}`;
            fileNode.classList.remove("hidden");
        }
    },

    resizeInput(input) {
        if (!input) return;
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 240) + "px";
    },

    cancelEdit(restoreDraft = true) {
        if (!this.edit) return;
        const input = this.input();
        const backup = this.edit.draftBackup;
        this.edit = null;
        if (input && restoreDraft) {
            input.value = backup || "";
            this.resizeInput(input);
        }
        this.hideBannerIfIdle();
    },

    isEditing() {
        return Boolean(this.edit);
    },

    canSaveEdit(text) {
        if (!this.edit) return false;
        const hasText = Boolean(text && text.trim());
        const hasImage = Boolean(this.edit.file || this.edit.message.media_url);
        if (!hasText && !hasImage) {
            UI.toast("Введите текст или прикрепите изображение");
            return false;
        }
        return true;
    },

    async saveEdit(text) {
        if (!this.edit) return false;
        const { message, file, draftBackup } = this.edit;
        const updated = await API.editMessage(message.id, text, file);

        const box = this.box();
        if (box) updateMessageRow(box, updated, this.messageOptions());
        if (this.selected.has(updated.id)) this.selected.set(updated.id, updated);

        const input = this.input();
        this.edit = null;
        if (input) {
            input.value = draftBackup || "";
            this.resizeInput(input);
        }
        this.hideBannerIfIdle();
        UI.toast("Сообщение изменено");
        await this.changed();
        return true;
    },

    // ---------- Удаление ----------

    async confirmAndDelete(messages) {
        if (!messages.length) return;
        const ok = await this.confirmDelete(messages.length);
        if (!ok) return;

        const ids = messages.map((msg) => msg.id);
        try {
            const response = ids.length === 1
                ? await API.deleteMessage(ids[0])
                : await API.deleteMessages(ids);
            const results = Array.isArray(response) ? response : [response];
            const box = this.box();

            for (const item of results) {
                if (item.removed) removeMessageRow(box, item.id);
                else if (item.message) {
                    updateMessageRow(box, item.message, this.messageOptions());
                }
                this.markQuotesDeleted(box, item.id);
                this.selected.delete(item.id);
            }

            this.exitSelection();
            UI.toast(
                results.length === 1 && results[0].removed
                    ? "Удалено из «Избранного»"
                    : "Сообщение удалено"
            );
            await this.changed();
        } catch (err) {
            UI.toast(err.message);
        }
    },

    markQuotesDeleted(box, messageId) {
        if (!box) return;
        for (const quote of box.querySelectorAll(
            `.message-quote[data-reply-id="${messageId}"]`
        )) {
            const text = quote.querySelector(".message-quote-text");
            if (text) text.textContent = "Сообщение удалено";
            quote.classList.remove("clickable");
            quote.removeAttribute("title");
        }
    },

    // ---------- Обработка событий WebSocket ----------

    onMessageEdited(msg) {
        const chatId = this.getChatId();
        if (Number(msg.chat_id) !== chatId) {
            this.changed();
            return;
        }
        const box = this.box();
        if (box) updateMessageRow(box, msg, this.messageOptions());
        if (this.selected.has(msg.id)) this.selected.set(msg.id, msg);
        this.syncSelectionUI();
        this.changed();
    },

    onMessageDeleted(msg) {
        const chatId = this.getChatId();
        if (Number(msg.chat_id) !== chatId) {
            this.changed();
            return;
        }

        const box = this.box();
        if (msg.removed || chatId === CONFIG.FAVORITES_CHAT_ID) {
            removeMessageRow(box, msg.id);
        } else {
            updateMessageRow(box, msg, this.messageOptions());
        }
        this.markQuotesDeleted(box, msg.id);
        this.selected.delete(msg.id);
        this.syncSelectionUI();
        this.changed();
    },

    // ---------- Диалог пересылки ----------

    ensureForwardModal() {
        if (document.getElementById("ma-forward-modal")) return;
        const modal = UI.el("div", "ma-modal hidden");
        modal.id = "ma-forward-modal";
        modal.setAttribute("aria-hidden", "true");

        const backdrop = UI.el("div", "ma-modal-backdrop");
        backdrop.addEventListener("click", () => this.closeForwardDialog());

        const dialog = UI.el("div", "ma-dialog");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "ma-forward-title");

        const title = UI.el("h2", "ma-dialog-title", "Переслать сообщение");
        title.id = "ma-forward-title";
        const subtitle = UI.el(
            "p",
            "ma-dialog-subtitle",
            "Выберите один или несколько чатов"
        );
        const list = UI.el("div", "ma-forward-chats");
        list.id = "ma-forward-chats";

        const keepLabel = UI.el("label", "ma-check");
        const keep = document.createElement("input");
        keep.type = "checkbox";
        keep.id = "ma-forward-keep-reply";
        keepLabel.appendChild(keep);
        keepLabel.appendChild(document.createTextNode(" Сохранить ответ"));

        const actions = UI.el("div", "ma-dialog-actions");
        const cancel = UI.el("button", "ma-btn ma-btn-ghost", "Отмена");
        cancel.type = "button";
        cancel.addEventListener("click", () => this.closeForwardDialog());
        const submit = UI.el("button", "ma-btn", "Переслать");
        submit.type = "button";
        submit.id = "ma-forward-submit";
        submit.addEventListener("click", () => this.submitForward());
        actions.append(cancel, submit);

        dialog.append(title, subtitle, list, keepLabel, actions);
        modal.append(backdrop, dialog);
        document.body.appendChild(modal);
    },

    async openForwardDialog(messages) {
        const items = messages.filter((msg) => msg && !msg.is_deleted);
        if (!items.length) {
            UI.toast("Удалённое сообщение нельзя переслать");
            return;
        }

        this.forwardMessages = items;
        this.ensureForwardModal();
        const modal = document.getElementById("ma-forward-modal");
        const list = document.getElementById("ma-forward-chats");
        const title = document.getElementById("ma-forward-title");
        const keep = document.getElementById("ma-forward-keep-reply");
        const submit = document.getElementById("ma-forward-submit");

        title.textContent = items.length === 1
            ? "Переслать сообщение"
            : `Переслать ${items.length} сообщений`;
        if (keep) {
            const hasReply = items.some(
                (msg) => msg.reply_to_id != null || msg.reply_to_text || msg.reply_to_nickname
            );
            keep.checked = false;
            keep.disabled = !hasReply;
            keep.parentElement.title = hasReply
                ? "Сохранить цитату ответа в пересланной копии"
                : "В выбранных сообщениях нет ответов";
        }
        if (submit) {
            submit.disabled = false;
            submit.textContent = "Переслать";
        }

        list.innerHTML = "";
        list.appendChild(UI.el("div", "loading", "Загрузка чатов…"));
        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");

        try {
            const { chats } = await API.getChats();
            list.innerHTML = "";
            for (const chat of chats) {
                const label = UI.el("label", "ma-forward-chat");
                const check = document.createElement("input");
                check.type = "checkbox";
                check.value = chat.id;
                check.className = "ma-forward-check";
                const name = UI.el(
                    "span",
                    "ma-forward-chat-title",
                    chat.title
                );
                const type = UI.el(
                    "span",
                    "ma-forward-chat-type",
                    chat.chat_type === "group"
                        ? "группа"
                        : (chat.is_favorites ? "личная папка" : "личный чат")
                );
                const text = UI.el("span", "ma-forward-chat-text");
                text.append(name, type);
                label.append(check, text);
                list.appendChild(label);
            }
        } catch (err) {
            list.innerHTML = "";
            list.appendChild(UI.el("div", "ma-dialog-error", err.message));
        }
    },

    closeForwardDialog() {
        const modal = document.getElementById("ma-forward-modal");
        if (!modal) return;
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        this.forwardMessages = [];
    },

    async submitForward() {
        const modal = document.getElementById("ma-forward-modal");
        if (!modal || modal.classList.contains("hidden")) return;

        const chatIds = [...modal.querySelectorAll(".ma-forward-check:checked")]
            .map((input) => Number(input.value))
            .filter((id) => Number.isInteger(id));
        if (!chatIds.length) {
            UI.toast("Выберите хотя бы один чат");
            return;
        }

        const ids = this.forwardMessages.map((msg) => msg.id);
        const keep = document.getElementById("ma-forward-keep-reply");
        const submit = document.getElementById("ma-forward-submit");
        if (submit) {
            submit.disabled = true;
            submit.textContent = "Пересылка…";
        }

        try {
            const created = await API.forwardMessages(
                ids,
                chatIds,
                Boolean(keep && keep.checked && !keep.disabled)
            );

            const box = this.box();
            for (const msg of created) {
                if (Number(msg.chat_id) !== this.getChatId()) continue;
                if (appendMessage(box, msg, this.messageOptions())) {
                    UI.scrollToBottom(box);
                }
            }

            this.closeForwardDialog();
            this.exitSelection();
            UI.toast(
                created.length === 1
                    ? "Сообщение переслано"
                    : `Переслано сообщений: ${created.length}`
            );
            await this.changed();
        } catch (err) {
            UI.toast(err.message);
            if (submit) {
                submit.disabled = false;
                submit.textContent = "Переслать";
            }
        }
    },

    // ---------- Модальное подтверждение удаления ----------

    ensureDeleteModal() {
        if (document.getElementById("ma-delete-modal")) return;
        const modal = UI.el("div", "ma-modal hidden");
        modal.id = "ma-delete-modal";
        modal.setAttribute("aria-hidden", "true");

        const backdrop = UI.el("div", "ma-modal-backdrop");
        backdrop.addEventListener("click", () => this.closeDeleteModal(false));

        const dialog = UI.el("div", "ma-dialog ma-dialog-small");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "ma-delete-title");

        const title = UI.el("h2", "ma-dialog-title", "Удалить сообщение?");
        title.id = "ma-delete-title";
        const text = UI.el("p", "ma-dialog-text");
        text.id = "ma-delete-text";

        const actions = UI.el("div", "ma-dialog-actions");
        const cancel = UI.el("button", "ma-btn ma-btn-ghost", "Отмена");
        cancel.type = "button";
        cancel.addEventListener("click", () => this.closeDeleteModal(false));
        const confirm = UI.el("button", "ma-btn ma-btn-danger", "Удалить");
        confirm.type = "button";
        confirm.addEventListener("click", () => this.closeDeleteModal(true));
        actions.append(cancel, confirm);

        dialog.append(title, text, actions);
        modal.append(backdrop, dialog);
        document.body.appendChild(modal);
    },

    confirmDelete(count) {
        this.ensureDeleteModal();
        const modal = document.getElementById("ma-delete-modal");
        const title = document.getElementById("ma-delete-title");
        const text = document.getElementById("ma-delete-text");
        title.textContent = count === 1
            ? "Удалить сообщение?"
            : `Удалить ${count} сообщений?`;
        text.textContent = this.getChatId() === CONFIG.FAVORITES_CHAT_ID
            ? "Копии исчезнут из «Избранного». В чатах оригиналы останутся."
            : "В чате появится заглушка «Сообщение удалено».";

        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");

        return new Promise((resolve) => {
            this.deleteResolve = resolve;
        });
    },

    closeDeleteModal(result) {
        const modal = document.getElementById("ma-delete-modal");
        if (!modal) return;
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        const resolve = this.deleteResolve;
        this.deleteResolve = null;
        if (resolve) resolve(Boolean(result));
    },

    // ---------- Клавиатура и сброс при смене чата ----------

    bindKeyboard() {
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (this.menu && !this.menu.classList.contains("hidden")) {
                this.closeMenu();
                return;
            }
            if (this.deleteResolve) {
                this.closeDeleteModal(false);
                return;
            }
            const forward = document.getElementById("ma-forward-modal");
            if (forward && !forward.classList.contains("hidden")) {
                this.closeForwardDialog();
                return;
            }
            if (this.edit) {
                this.cancelEdit();
                return;
            }
            if (this.reply) {
                this.clearReply();
                return;
            }
            if (this.selectionMode) this.exitSelection();
        });

        // Клик вне меню закрывает его
        document.addEventListener("pointerdown", (event) => {
            if (!this.menu || this.menu.classList.contains("hidden")) return;
            if (this.menu.contains(event.target)) return;
            this.closeMenu();
        });
    },

    reset() {
        this.closeMenu();
        this.closeForwardDialog();
        this.closeDeleteModal(false);
        this.exitSelection();
        this.reply = null;
        this.edit = null;
        this.hideBannerIfIdle();
    },

    async changed() {
        if (!this.onChanged) return;
        try {
            await this.onChanged();
        } catch (err) {
            // Список чатов обновится при следующем событии
        }
    }
};
