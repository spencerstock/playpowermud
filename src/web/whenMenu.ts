import type { WhenRulesStore } from "../client/whenRules.js";

export type WhenMenu = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
};

export function createWhenMenu(
  store: WhenRulesStore,
  opts?: { onClose?: () => void },
): WhenMenu {
  const backdrop = document.createElement("div");
  backdrop.className = "client-dialog-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("role", "presentation");

  const dialog = document.createElement("div");
  dialog.className = "client-dialog when-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "when-dialog-title");

  const head = document.createElement("div");
  head.className = "client-dialog-head";

  const title = document.createElement("h2");
  title.className = "client-dialog-title";
  title.id = "when-dialog-title";
  title.textContent = "When commands";

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

  const matchRow = document.createElement("div");
  matchRow.className = "hotkey-add-row";

  const matchLabel = document.createElement("label");
  matchLabel.className = "hotkey-add-label";
  matchLabel.htmlFor = "when-match-input";
  matchLabel.textContent = "Trigger (substring in MUD output)";

  const matchInput = document.createElement("input");
  matchInput.type = "text";
  matchInput.id = "when-match-input";
  matchInput.className = "hotkey-command-input";
  matchInput.autocomplete = "off";
  matchInput.spellcheck = false;
  matchInput.placeholder = "You are hungry";

  matchRow.append(matchLabel, matchInput);

  const cmdRow = document.createElement("div");
  cmdRow.className = "hotkey-add-row";

  const cmdLabel = document.createElement("label");
  cmdLabel.className = "hotkey-add-label";
  cmdLabel.htmlFor = "when-command-input";
  cmdLabel.textContent = "Command";

  const cmdInput = document.createElement("input");
  cmdInput.type = "text";
  cmdInput.id = "when-command-input";
  cmdInput.className = "hotkey-command-input";
  cmdInput.autocomplete = "off";
  cmdInput.spellcheck = false;
  cmdInput.placeholder = "eat bread";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "hotkey-add-btn";
  addBtn.textContent = "Add when rule";

  cmdRow.append(cmdLabel, cmdInput, addBtn);
  addForm.append(matchRow, cmdRow);

  const foot = document.createElement("p");
  foot.className = "client-dialog-sub";
  foot.innerHTML =
    'Same rules as <code>/when "TRIGGER" "COMMAND"</code> and <code>/unwhen NUMBER</code>. Rules run in list order when output matches. <code>@delay 2</code> in the command waits 2 seconds before the rest. Bindings sync with the terminal commands and config export.';

  dialog.append(head, notice, list, addForm, foot);
  backdrop.append(dialog);
  document.body.append(backdrop);

  let open = false;

  function showNotice(text: string, isError = true): void {
    notice.textContent = text;
    notice.hidden = !text;
    notice.classList.toggle("client-dialog-notice-error", isError);
  }

  function renderList(): void {
    list.replaceChildren();
    const rules = store.all();
    if (!rules.length) {
      const li = document.createElement("li");
      li.className = "hotkey-menu-empty";
      li.textContent = "No when rules yet — add one below or use /when in the command line.";
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
      key.textContent = rule.match;

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
      remove.title = `Remove when rule #${i + 1}`;
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
      matchInput.value = "";
      cmdInput.value = "";
      showNotice("", false);
      renderList();
      closeBtn.focus();
    } else {
      opts?.onClose?.();
    }
  }

  function tryAdd(): void {
    const match = matchInput.value.trim();
    const command = cmdInput.value.trim();
    const saved = store.add(match, command);
    if (!saved.ok) {
      showNotice(saved.reason);
      if (saved.reason.includes("trigger") || saved.reason.includes("missing")) matchInput.focus();
      else cmdInput.focus();
      return;
    }
    showNotice(`Saved: "${match}" → ${command}`, false);
    matchInput.value = "";
    cmdInput.value = "";
    renderList();
    matchInput.focus();
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