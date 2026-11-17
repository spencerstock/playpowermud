import type { HotkeyRulesStore } from "../client/hotkeyRules.js";
import { keySpecFromKeyboardEvent } from "../hotkey/keySpec.js";

export type HotkeyMenu = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
};

export function createHotkeyMenu(
  store: HotkeyRulesStore,
  opts?: { onClose?: () => void; focusInput?: () => void },
): HotkeyMenu {
  const backdrop = document.createElement("div");
  backdrop.className = "client-dialog-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("role", "presentation");

  const dialog = document.createElement("div");
  dialog.className = "client-dialog hotkey-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "hotkey-dialog-title");

  const head = document.createElement("div");
  head.className = "client-dialog-head";

  const title = document.createElement("h2");
  title.className = "client-dialog-title";
  title.id = "hotkey-dialog-title";
  title.textContent = "Hotkeys";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "client-dialog-close";
  closeBtn.title = "Close (Escape)";
  closeBtn.textContent = "×";

  head.append(title, closeBtn);

  const notice = document.createElement("p");
  notice.className = "client-dialog-notice";
  notice.hidden = true;

  const list = document.createElement("ul");
  list.className = "hotkey-menu-list";

  const addForm = document.createElement("div");
  addForm.className = "hotkey-add-form";

  const keyRowEl = document.createElement("div");
  keyRowEl.className = "hotkey-add-row";

  const keyLabel = document.createElement("label");
  keyLabel.className = "hotkey-add-label";
  keyLabel.textContent = "Key";

  const keyField = document.createElement("button");
  keyField.type = "button";
  keyField.className = "hotkey-key-field";
  keyField.textContent = "Click here, then press a key…";
  keyField.setAttribute("aria-describedby", "hotkey-key-hint");

  const keyHint = document.createElement("span");
  keyHint.id = "hotkey-key-hint";
  keyHint.className = "client-dialog-sub";
  keyHint.textContent = "F1–F12 or a chord with Ctrl, Alt, Shift, or Meta. Alt+W/M/C/D are reserved.";

  keyRowEl.append(keyLabel, keyField, keyHint);

  const cmdRow = document.createElement("div");
  cmdRow.className = "hotkey-add-row";

  const cmdLabel = document.createElement("label");
  cmdLabel.className = "hotkey-add-label";
  cmdLabel.htmlFor = "hotkey-command-input";
  cmdLabel.textContent = "Command";

  const cmdInput = document.createElement("input");
  cmdInput.type = "text";
  cmdInput.id = "hotkey-command-input";
  cmdInput.className = "hotkey-command-input";
  cmdInput.autocomplete = "off";
  cmdInput.spellcheck = false;
  cmdInput.placeholder = "score";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "hotkey-add-btn";
  addBtn.textContent = "Add hotkey";

  cmdRow.append(cmdLabel, cmdInput, addBtn);
  addForm.append(keyRowEl, cmdRow);

  const foot = document.createElement("p");
  foot.className = "client-dialog-sub";
  foot.innerHTML =
    'Same rules as <code>/hotkey "KEY" "COMMAND"</code> and <code>/unhotkey NUMBER</code>. Bindings sync with the terminal commands and config export.';

  dialog.append(head, notice, list, addForm, foot);
  backdrop.append(dialog);
  document.body.append(backdrop);

  let open = false;
  let recording = false;
  let capturedKey: string | null = null;

  function showNotice(text: string, isError = true): void {
    notice.textContent = text;
    notice.hidden = !text;
    notice.classList.toggle("client-dialog-notice-error", isError);
  }

  function syncKeyField(): void {
    keyField.classList.toggle("hotkey-key-field-recording", recording);
    if (recording) {
      keyField.textContent = "Press a key… (Escape to cancel)";
    } else if (capturedKey) {
      keyField.textContent = capturedKey;
    } else {
      keyField.textContent = "Click here, then press a key…";
    }
  }

  function stopRecording(): void {
    recording = false;
    syncKeyField();
  }

  function renderList(): void {
    list.replaceChildren();
    const rules = store.all();
    if (!rules.length) {
      const li = document.createElement("li");
      li.className = "hotkey-menu-empty";
      li.textContent = "No hotkeys yet — add one below or use /hotkey in the command line.";
      list.append(li);
      return;
    }
    rules.forEach((rule, i) => {
      const li = document.createElement("li");
      li.className = "hotkey-menu-item";

      const num = document.createElement("span");
      num.className = "hotkey-menu-num";
      num.textContent = `${i + 1}.`;

      const key = document.createElement("code");
      key.className = "hotkey-menu-key";
      key.textContent = rule.key;

      const arrow = document.createElement("span");
      arrow.className = "hotkey-menu-arrow";
      arrow.textContent = "→";

      const cmd = document.createElement("span");
      cmd.className = "hotkey-menu-cmd";
      cmd.textContent = rule.command;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "hotkey-menu-remove";
      remove.textContent = "Remove";
      remove.title = `Remove hotkey #${i + 1}`;
      remove.addEventListener("click", () => {
        store.removeAt(i + 1);
        showNotice("", false);
        renderList();
      });

      li.append(num, key, arrow, cmd, remove);
      list.append(li);
    });
  }

  function setOpen(on: boolean): void {
    if (open === on) return;
    open = on;
    backdrop.hidden = !on;
    document.body.classList.toggle("client-dialog-open", on);
    if (on) {
      capturedKey = null;
      recording = false;
      cmdInput.value = "";
      showNotice("", false);
      syncKeyField();
      renderList();
      closeBtn.focus();
    } else {
      stopRecording();
      opts?.onClose?.();
    }
  }

  function tryAdd(): void {
    const cmd = cmdInput.value.trim();
    if (!capturedKey) {
      showNotice("Choose a key first (click the key field, then press a chord).");
      keyField.focus();
      return;
    }
    if (!cmd) {
      showNotice("Enter a command to send when the hotkey fires.");
      cmdInput.focus();
      return;
    }
    const saved = store.add(capturedKey, cmd);
    if (!saved.ok) {
      showNotice(saved.reason);
      return;
    }
    showNotice(`Saved: ${capturedKey} → ${cmd}`, false);
    capturedKey = null;
    cmdInput.value = "";
    syncKeyField();
    renderList();
  }

  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) setOpen(false);
  });
  addBtn.addEventListener("click", () => tryAdd());
  cmdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryAdd();
    }
  });

  keyField.addEventListener("click", () => {
    recording = true;
    capturedKey = null;
    showNotice("", false);
    syncKeyField();
    keyField.focus();
  });

  function onCaptureKeydown(e: KeyboardEvent): void {
    if (!open || !recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      stopRecording();
      return;
    }
    const spec = keySpecFromKeyboardEvent(e);
    if (!spec.ok) {
      if (spec.reason !== "modifier only" && spec.reason !== "duplicate key repeat") {
        showNotice(spec.reason);
      }
      return;
    }
    capturedKey = spec.key;
    recording = false;
    syncKeyField();
    showNotice("", false);
    cmdInput.focus();
  }

  document.addEventListener("keydown", onCaptureKeydown, true);

  return {
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    isOpen() {
      return open;
    },
  };
}