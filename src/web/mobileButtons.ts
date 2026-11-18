export const MOBILE_BUTTONS_LS = "playpowermud-mobile-buttons";
const MAX_CUSTOM = 24;
const MAX_LABEL = 32;
const MAX_COMMAND = 800;
const LONG_PRESS_MS = 500;

export type MobileCommandButton = {
  id: string;
  label: string;
  command: string;
};

export type MobileAliasPick = { name: string; expansion: string };
export type MobileWaypointPick = { name: string; label?: string };

const DEFAULTS: readonly MobileCommandButton[] = [
  { id: "look", label: "look", command: "look" },
  { id: "who", label: "who", command: "who" },
  { id: "score", label: "score", command: "score" },
];

const BUILTIN_IDS = DEFAULTS.map((b) => b.id);

export function isBuiltinMobileButton(id: string): boolean {
  return BUILTIN_IDS.includes(id);
}

export function defaultMobileButton(id: string): MobileCommandButton | undefined {
  const found = DEFAULTS.find((b) => b.id === id);
  return found ? { ...found } : undefined;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/** Built-in look / who / score stay first. Missing ones come back as the defaults. */
export function normalizeMobileButtons(raw: unknown): MobileCommandButton[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { buttons?: unknown }).buttons)
      ? (raw as { buttons: unknown[] }).buttons
      : [];
  const builtins = new Map<string, MobileCommandButton>();
  const custom: MobileCommandButton[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = clean(row.id, 80);
    const label = clean(row.label, MAX_LABEL);
    const command = clean(row.command, MAX_COMMAND);
    if (!id || !label || !command) continue;
    if (isBuiltinMobileButton(id)) {
      builtins.set(id, { id, label, command });
      continue;
    }
    if (custom.some((b) => b.id === id)) continue;
    custom.push({ id, label, command });
  }
  return [
    ...DEFAULTS.map((d) => builtins.get(d.id) ?? { ...d }),
    ...custom.slice(0, MAX_CUSTOM),
  ];
}

export function loadMobileButtons(storage: Pick<Storage, "getItem"> | null): MobileCommandButton[] {
  try {
    const raw = storage?.getItem(MOBILE_BUTTONS_LS);
    if (!raw) return DEFAULTS.map((b) => ({ ...b }));
    return normalizeMobileButtons(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULTS.map((b) => ({ ...b }));
  }
}

export function saveMobileButtons(
  storage: Pick<Storage, "setItem"> | null,
  buttons: MobileCommandButton[],
): void {
  try {
    storage?.setItem(MOBILE_BUTTONS_LS, JSON.stringify({ buttons: normalizeMobileButtons({ buttons }) }));
  } catch {
    /* this tab still shows the buttons */
  }
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function newButtonId(): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  return `btn-${id}`;
}

export function mountMobileCommandButtons(opts: {
  commandsEl: HTMLElement;
  addButton: HTMLButtonElement;
  listAliases: () => MobileAliasPick[];
  listWaypoints: () => Promise<MobileWaypointPick[]>;
  onRun: (command: string) => void;
  onLayout?: () => void;
}): { isEditorOpen: () => boolean; closeEditor: () => void } {
  let buttons = loadMobileButtons(storageOrNull());
  const editor = createEditor({
    listAliases: opts.listAliases,
    listWaypoints: opts.listWaypoints,
    onSave: (button) => {
      const idx = buttons.findIndex((b) => b.id === button.id);
      const next = buttons.slice();
      if (idx >= 0) next[idx] = button;
      else next.push(button);
      persist(next);
    },
    onRemove: (id) => {
      if (isBuiltinMobileButton(id)) return;
      persist(buttons.filter((b) => b.id !== id));
    },
    onReset: (id) => {
      const fresh = defaultMobileButton(id);
      if (!fresh) return;
      persist(buttons.map((b) => (b.id === id ? fresh : b)));
    },
    customCount: () => buttons.filter((b) => !isBuiltinMobileButton(b.id)).length,
  });

  function persist(next: MobileCommandButton[]): void {
    buttons = normalizeMobileButtons({ buttons: next });
    saveMobileButtons(storageOrNull(), buttons);
    render();
    opts.onLayout?.();
  }

  function render(): void {
    opts.commandsEl.replaceChildren();
    for (const button of buttons) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "mobile-command";
      el.textContent = button.label;
      el.title = `${button.command} — long-press to change`;
      el.dataset.command = button.command;
      el.dataset.buttonId = button.id;
      bindLongPress(el, {
        onLongPress: () => editor.openEdit(button),
        onTap: () => opts.onRun(button.command),
      });
      opts.commandsEl.append(el);
    }
  }

  opts.addButton.addEventListener("click", () => editor.openAdd());
  render();

  return {
    isEditorOpen: () => editor.isOpen(),
    closeEditor: () => editor.close(),
  };
}

function bindLongPress(
  el: HTMLElement,
  handlers: { onLongPress: () => void; onTap: () => void },
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;
  let startX = 0;
  let startY = 0;
  let lastLong = 0;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const fireLong = () => {
    const now = Date.now();
    if (now - lastLong < 700) return;
    lastLong = now;
    suppressClick = true;
    handlers.onLongPress();
  };

  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    suppressClick = false;
    startX = e.clientX;
    startY = e.clientY;
    clear();
    timer = setTimeout(() => {
      timer = null;
      fireLong();
    }, LONG_PRESS_MS);
  });
  el.addEventListener("pointermove", (e) => {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 18) clear();
  });
  el.addEventListener("pointerup", clear);
  el.addEventListener("pointercancel", clear);
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    clear();
    fireLong();
  });
  el.addEventListener("click", (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
      return;
    }
    handlers.onTap();
  });
}

function createEditor(opts: {
  listAliases: () => MobileAliasPick[];
  listWaypoints: () => Promise<MobileWaypointPick[]>;
  onSave: (button: MobileCommandButton) => void;
  onRemove: (id: string) => void;
  onReset: (id: string) => void;
  customCount: () => number;
}): {
  openAdd: () => void;
  openEdit: (button: MobileCommandButton) => void;
  close: () => void;
  isOpen: () => boolean;
} {
  const backdrop = document.createElement("div");
  backdrop.className = "client-dialog-backdrop";
  backdrop.hidden = true;

  const dialog = document.createElement("div");
  dialog.className = "client-dialog mobile-btn-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "mobile-btn-dialog-title");

  const head = document.createElement("div");
  head.className = "client-dialog-head";
  const title = document.createElement("h2");
  title.className = "client-dialog-title";
  title.id = "mobile-btn-dialog-title";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "client-dialog-close";
  closeBtn.title = "Close";
  closeBtn.textContent = "×";
  head.append(title, closeBtn);

  const notice = document.createElement("p");
  notice.className = "client-dialog-notice";
  notice.hidden = true;

  const labelRow = fieldRow("Label", "mobile-btn-label", "Shown on the button");
  const commandRow = fieldRow("Command", "mobile-btn-command", "look, buff, /to home, /wp camp");

  const filterRow = fieldRow("Find", "mobile-btn-filter", "Filter aliases and waypoints");

  const aliasHead = document.createElement("p");
  aliasHead.className = "hotkey-add-label";
  aliasHead.textContent = "Aliases";
  const aliasPicks = document.createElement("div");
  aliasPicks.className = "mobile-btn-picks";

  const wpHead = document.createElement("p");
  wpHead.className = "hotkey-add-label";
  wpHead.textContent = "Waypoints";
  const wpPicks = document.createElement("div");
  wpPicks.className = "mobile-btn-picks";

  const actions = document.createElement("div");
  actions.className = "mobile-btn-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "hotkey-add-btn";
  saveBtn.textContent = "Save";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.textContent = "Remove";
  actions.append(saveBtn, resetBtn, removeBtn);

  const foot = document.createElement("p");
  foot.className = "client-dialog-sub";
  foot.innerHTML =
    "A tap runs this like the command line. Aliases expand fully, including nested aliases and <code>@delay</code>. <code>/to name</code> walks to a room or waypoint. <code>/wp name</code> saves where you are. <code>/alias</code> works too.";

  dialog.append(
    head,
    notice,
    labelRow.row,
    commandRow.row,
    filterRow.row,
    aliasHead,
    aliasPicks,
    wpHead,
    wpPicks,
    actions,
    foot,
  );
  backdrop.append(dialog);
  document.body.append(backdrop);

  let open = false;
  let openedAt = 0;
  let mode: "add" | "edit" = "add";
  let editingId = "";
  let aliases: MobileAliasPick[] = [];
  let waypoints: MobileWaypointPick[] = [];
  let waypointNote = "";
  let loadGen = 0;

  function showNotice(text: string, isError = true): void {
    notice.textContent = text;
    notice.hidden = !text;
    notice.classList.toggle("client-dialog-notice-error", isError);
  }

  function setOpen(on: boolean): void {
    open = on;
    if (on) openedAt = Date.now();
    backdrop.hidden = !on;
    document.body.classList.toggle("client-dialog-open", on);
    if (!on) showNotice("", false);
  }

  function renderPicks(): void {
    const q = filterRow.input.value.trim().toLowerCase();
    const hit = (...parts: string[]) => !q || parts.some((p) => p.toLowerCase().includes(q));

    aliasPicks.replaceChildren();
    const aliasRows = aliases.filter((a) => hit(a.name, a.expansion));
    if (!aliasRows.length) {
      aliasPicks.append(emptyPick(aliases.length ? "No aliases match." : "No aliases yet."));
    } else {
      for (const alias of aliasRows) {
        aliasPicks.append(
          pickButton(alias.name, alias.expansion, () => {
            commandRow.input.value = alias.name;
            if (!labelRow.input.value.trim()) labelRow.input.value = alias.name.slice(0, MAX_LABEL);
          }),
        );
      }
    }

    wpPicks.replaceChildren();
    if (waypointNote) wpPicks.append(emptyPick(waypointNote));
    const wpRows = waypoints.filter((w) => hit(w.name, w.label ?? ""));
    if (!waypointNote && !wpRows.length) {
      wpPicks.append(emptyPick(waypoints.length ? "No waypoints match." : "No waypoints yet. Save one with /wp name."));
    }
    for (const wp of wpRows) {
      const shown = (wp.label || wp.name).trim();
      wpPicks.append(
        pickButton(shown, `Walk with /to ${shown}`, () => {
          commandRow.input.value = `/to ${shown}`.slice(0, MAX_COMMAND);
          if (!labelRow.input.value.trim()) labelRow.input.value = shown.slice(0, MAX_LABEL);
        }),
      );
    }
  }

  function fill(button: MobileCommandButton | null): void {
    labelRow.input.value = button?.label ?? "";
    commandRow.input.value = button?.command ?? "";
    filterRow.input.value = "";
    showNotice("", false);
  }

  async function reloadPicks(): Promise<void> {
    const gen = ++loadGen;
    aliases = opts.listAliases();
    waypointNote = "Loading waypoints…";
    waypoints = [];
    renderPicks();
    try {
      const rows = await opts.listWaypoints();
      if (gen !== loadGen || !open) return;
      waypoints = rows;
      waypointNote = "";
    } catch (err) {
      if (gen !== loadGen || !open) return;
      waypoints = [];
      waypointNote = err instanceof Error ? err.message : String(err);
    }
    renderPicks();
  }

  function openWith(next: "add" | "edit", button: MobileCommandButton | null): void {
    mode = next;
    editingId = button?.id ?? "";
    const builtin = mode === "edit" && isBuiltinMobileButton(editingId);
    title.textContent = mode === "add" ? "New button" : builtin ? `Change ${button?.label ?? "button"}` : "Change button";
    resetBtn.hidden = !builtin;
    removeBtn.hidden = mode !== "edit" || builtin;
    fill(button);
    setOpen(true);
    void reloadPicks();
    closeBtn.focus();
  }

  function trySave(): void {
    const label = labelRow.input.value.trim().slice(0, MAX_LABEL);
    const command = commandRow.input.value.trim().slice(0, MAX_COMMAND);
    if (!command) {
      showNotice("Enter a command.");
      commandRow.input.focus();
      return;
    }
    const shown = label || command.slice(0, MAX_LABEL);
    if (mode === "add") {
      if (opts.customCount() >= MAX_CUSTOM) {
        showNotice(`You can add up to ${MAX_CUSTOM} buttons.`);
        return;
      }
      opts.onSave({ id: newButtonId(), label: shown, command });
    } else {
      opts.onSave({ id: editingId, label: shown, command });
    }
    setOpen(false);
  }

  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", (e) => {
    // The long-press finger-up lands on the backdrop that just opened.
    if (Date.now() - openedAt < 500) return;
    if (e.target === backdrop) setOpen(false);
  });
  saveBtn.addEventListener("click", () => trySave());
  resetBtn.addEventListener("click", () => {
    if (!editingId) return;
    opts.onReset(editingId);
    setOpen(false);
  });
  removeBtn.addEventListener("click", () => {
    if (!editingId) return;
    opts.onRemove(editingId);
    setOpen(false);
  });
  for (const input of [labelRow.input, commandRow.input]) {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      trySave();
    });
  }
  filterRow.input.addEventListener("input", () => renderPicks());
  document.addEventListener(
    "keydown",
    (e) => {
      if (!open || e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    },
    true,
  );

  return {
    openAdd: () => openWith("add", null),
    openEdit: (button) => openWith("edit", button),
    close: () => setOpen(false),
    isOpen: () => open,
  };
}

function fieldRow(labelText: string, id: string, placeholder: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement("div");
  row.className = "hotkey-add-row";
  const label = document.createElement("label");
  label.className = "hotkey-add-label";
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.className = "hotkey-command-input";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.placeholder = placeholder;
  row.append(label, input);
  return { row, input };
}

function emptyPick(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "mobile-btn-empty";
  p.textContent = text;
  return p;
}

function pickButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mobile-btn-pick";
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", onClick);
  return btn;
}
