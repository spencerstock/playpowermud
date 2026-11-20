import type { AliasStore } from "../client/aliases.js";
import { parseSlashAliasDefineLine } from "../aliases/slashDefine.js";

export type AliasMenu = {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
};

export function createAliasMenu(
  store: AliasStore,
  opts?: { onClose?: () => void },
): AliasMenu {
  const backdrop = document.createElement("div");
  backdrop.className = "client-dialog-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("role", "presentation");

  const dialog = document.createElement("div");
  dialog.className = "client-dialog alias-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "alias-dialog-title");

  const head = document.createElement("div");
  head.className = "client-dialog-head";

  const title = document.createElement("h2");
  title.className = "client-dialog-title";
  title.id = "alias-dialog-title";
  title.textContent = "Aliases";

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

  const nameRow = document.createElement("div");
  nameRow.className = "hotkey-add-row";

  const nameLabel = document.createElement("label");
  nameLabel.className = "hotkey-add-label";
  nameLabel.htmlFor = "alias-name-input";
  nameLabel.textContent = "Name";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "alias-name-input";
  nameInput.className = "hotkey-command-input";
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.placeholder = "cma";

  nameRow.append(nameLabel, nameInput);

  const expRow = document.createElement("div");
  expRow.className = "hotkey-add-row";

  const expLabel = document.createElement("label");
  expLabel.className = "hotkey-add-label";
  expLabel.htmlFor = "alias-expansion-input";
  expLabel.textContent = "Expansion";

  const expInput = document.createElement("input");
  expInput.type = "text";
  expInput.id = "alias-expansion-input";
  expInput.className = "hotkey-command-input";
  expInput.autocomplete = "off";
  expInput.spellcheck = false;
  expInput.placeholder = "cast magic invulnerability";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "hotkey-add-btn";
  addBtn.textContent = "Add or update alias";

  expRow.append(expLabel, expInput, addBtn);
  addForm.append(nameRow, expRow);

  const foot = document.createElement("p");
  foot.className = "client-dialog-sub";
  foot.innerHTML =
    'Same rules as <code>/alias NAME EXPANSION</code> and <code>/unalias NAME</code>. Use <code>;</code> to chain commands. <code>@delay 2</code> waits 2 seconds before the next command. Stored in this browser and included in config export.';

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
    const rows = store.list();
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "hotkey-menu-empty";
      li.textContent = "No aliases yet — add one below or use /alias in the command line.";
      list.append(li);
      return;
    }
    for (const [name, expansion] of rows) {
      const li = document.createElement("li");
      li.className = "hotkey-menu-item";

      const key = document.createElement("code");
      key.className = "hotkey-menu-key";
      key.textContent = name;

      const arrow = document.createElement("span");
      arrow.className = "hotkey-menu-arrow";
      arrow.textContent = "→";

      const body = document.createElement("span");
      body.className = "hotkey-menu-cmd";
      body.textContent = expansion;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "hotkey-menu-remove";
      remove.textContent = "Remove";
      remove.title = `Remove alias ${name}`;
      remove.addEventListener("click", () => {
        store.remove(name);
        showNotice("", false);
        renderList();
      });

      li.append(key, arrow, body, remove);
      list.append(li);
    }
  }

  function setOpen(on: boolean): void {
    if (open === on) return;
    open = on;
    backdrop.hidden = !on;
    document.body.classList.toggle("client-dialog-open", on);
    if (on) {
      nameInput.value = "";
      expInput.value = "";
      showNotice("", false);
      renderList();
      closeBtn.focus();
    } else {
      opts?.onClose?.();
    }
  }

  function tryAdd(): void {
    const name = nameInput.value.trim();
    const expansion = expInput.value.trim();
    const parsed = parseSlashAliasDefineLine(`/alias ${name} ${expansion}`);
    if (!parsed) {
      showNotice("Could not parse alias.");
      return;
    }
    if (!parsed.ok) {
      showNotice(parsed.reason);
      if (parsed.reason.includes("name")) nameInput.focus();
      else expInput.focus();
      return;
    }
    if (parsed.kind !== "define") {
      showNotice("Add an expansion.");
      expInput.focus();
      return;
    }
    store.set(parsed.name, parsed.expansion);
    showNotice(`Saved: ${parsed.name} → ${parsed.expansion}`, false);
    nameInput.value = "";
    expInput.value = "";
    renderList();
    nameInput.focus();
  }

  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) setOpen(false);
  });
  addBtn.addEventListener("click", () => tryAdd());
  expInput.addEventListener("keydown", (e) => {
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