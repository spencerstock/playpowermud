import { parseSlashAliasesLine } from "../aliases/slashCommands.js";
import { runActionSteps } from "../scripting/actionDelay.js";
import { AliasStore } from "../client/aliases.js";
import { HotkeyRulesStore } from "../client/hotkeyRules.js";
import { WhenRulesStore } from "../client/whenRules.js";
import {
  buildClientConfig,
  buildMapFile,
  collectPlaypowermudLocalStorage,
  configExportFilename,
  mapExportFilename,
  parseClientConfig,
  parseMapImport,
} from "../client/clientConfig.js";
import {
  activateSession,
  createSession,
  deleteSession,
  ensureSessions,
  importSession,
  renameSession,
  type SessionIndex,
} from "../client/sessions.js";
import { defaultMudWebSocketUrl, type RelayStatus } from "../client/connection.js";
import { createMudConnection } from "../client/relayClient.js";
import { createMapApi } from "../client/mapApi.js";
import { BrowserMapStore } from "../client/mapStore.js";
import { ClientRuntime } from "../client/runtime.js";
import { EsetLoginSync } from "../game/esetSync.js";
import { setAnsiSkin, type AnsiSkin } from "./ansiHtml.js";
import {
  createAliasAutocomplete,
  isSlashAliasDefinePrefix,
  isSlashAliasUndefinePrefix,
  parseSlashAliasDefineLine,
  parseSlashAliasLine,
  parseSlashAliasUndefineLine,
} from "./aliasAutocomplete.js";
import { formatHotkeyListText } from "../hotkey/formatList.js";
import {
  isSlashHotkeyManageLine,
  parseSlashHotkeyLine,
  parseSlashUnhotkeyLine,
} from "../hotkey/slashHotkey.js";
import { formatWhenListText } from "../when/formatList.js";
import {
  isSlashWhenManageLine,
  parseSlashUnwhenLine,
  parseSlashWhenLine,
} from "../when/slashWhen.js";
import { createMudTerminal } from "./mudTerminal.js";
import { createSidePanel } from "./sidePanel.js";
import { applyTelnetKeyAction, TelnetLineEditor } from "./telnetLineEditor.js";
import {
  createRoomAutocomplete,
  parseSlashToLine,
  parseSlashWpLine,
  rankRoomHits,
  roomHitLabel,
  type RoomSearchHitBrief,
} from "./roomAutocomplete.js";
import { createWorldPanel } from "./worldPanel.js";
import { createAliasMenu } from "./aliasMenu.js";
import { createAppMenu } from "./appMenu.js";
import { createHotkeyMenu } from "./hotkeyMenu.js";
import { createWhenMenu } from "./whenMenu.js";
import { DEFAULT_WIKI_PATH, openWikiInNewTab } from "./wikiOpen.js";
import { mountMobileCommandButtons } from "./mobileButtons.js";

/** Replaced at build time (scripts/build.mjs). Unset build → wss://powermud.com:2000. */
declare const __MUD_WS_URL__: string;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

const logEl = byId("log");
const statusEl = byId("mud-status");
const connectBtn = byId<HTMLButtonElement>("mud-connect");
const disconnectBtn = byId<HTMLButtonElement>("mud-disconnect");
const skinCycleBtn = byId<HTMLButtonElement>("skin-cycle");
const configExportBtn = byId<HTMLButtonElement>("config-export");
const configImportBtn = byId<HTMLButtonElement>("config-import-btn");
const configImportInput = byId<HTMLInputElement>("config-import");
const sessionSelect = byId<HTMLSelectElement>("session-select");
const sessionNewBtn = byId<HTMLButtonElement>("session-new");
const sessionRenameBtn = byId<HTMLButtonElement>("session-rename");
const sessionDeleteBtn = byId<HTMLButtonElement>("session-delete");
const mapExportBtn = byId<HTMLButtonElement>("map-export");
const mapImportBtn = byId<HTMLButtonElement>("map-import-btn");
const mapImportInput = byId<HTMLInputElement>("map-import");
const form = byId<HTMLFormElement>("form");
const input = byId<HTMLInputElement>("input");
const aliasAcEl = byId("alias-ac");
const wireHintEl = byId("wire-hint");
const mapPanelMount = byId("map-panel-mount");
const sidePanelMount = byId("chat-panel-mount");
const appMenuBtn = byId<HTMLButtonElement>("app-menu-btn");
const appMenuPanel = byId("app-menu-panel");
const aliasMenuOpenBtn = byId<HTMLButtonElement>("alias-menu-open");
const whenMenuOpenBtn = byId<HTMLButtonElement>("when-menu-open");
const hotkeyMenuOpenBtn = byId<HTMLButtonElement>("hotkey-menu-open");

const mudTerm = createMudTerminal(logEl, 10_000);
const aliases = new AliasStore();
const whenRules = new WhenRulesStore();
const hotkeyRules = new HotkeyRulesStore();
const connection = createMudConnection(defaultMudWebSocketUrl(location, __MUD_WS_URL__));

const META_ANSI = "\x1b[90m";
const ECHO_ANSI = "\x1b[33m";
const ERROR_ANSI = "\x1b[31m";
const RESET = "\x1b[0m";

function meta(text: string): void {
  mudTerm.write(`\n${META_ANSI}[playpowermud] ${text}${RESET}\n`);
}

function errorLine(text: string): void {
  mudTerm.write(`\n${ERROR_ANSI}[playpowermud] ${text}${RESET}\n`);
}

// ---- skin -----------------------------------------------------------------------------

const SKINS: AnsiSkin[] = ["dark", "light"];
const SKIN_LS = "playpowermud-skin";

function applySkin(skin: string, persist = true): void {
  const next: AnsiSkin = skin === "light" ? "light" : "dark";
  document.documentElement.dataset.skin = next;
  setAnsiSkin(next);
  mudTerm.applyTheme(next);
  if (persist) localStorage.setItem(SKIN_LS, next);
  skinCycleBtn.textContent = next === "dark" ? "Skin: Dark" : "Skin: Light";
}

applySkin(localStorage.getItem(SKIN_LS) ?? "dark", false);
skinCycleBtn.addEventListener("click", () => {
  const cur = document.documentElement.dataset.skin === "light" ? "light" : "dark";
  applySkin(SKINS[(SKINS.indexOf(cur) + 1) % SKINS.length]!);
});

// ---- sessions, config, and map files ----------------------------------------------------

let sessions: SessionIndex | null = null;

function activeSessionName(): string {
  return sessions?.sessions.find((s) => s.id === sessions!.activeId)?.name ?? "Session";
}

function renderSessionSelect(): void {
  const current = sessions?.activeId ?? "";
  sessionSelect.replaceChildren();
  for (const s of sessions?.sessions ?? []) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    sessionSelect.appendChild(opt);
  }
  if (current) sessionSelect.value = current;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function reloadAfter(message: string, fn: () => Promise<void>): Promise<void> {
  await runtime?.mapStore.flush();
  await fn();
  meta(message);
  window.location.reload();
}

async function exportClientConfig(): Promise<void> {
  try {
    const name = activeSessionName();
    const map = runtime ? await runtime.mapStore.exportSnapshot() : undefined;
    const doc = buildClientConfig({
      name,
      localStorage: collectPlaypowermudLocalStorage(localStorage),
      map,
    });
    downloadJson(configExportFilename(doc.exportedAt, name), doc);
    const rooms = map ? Object.keys(map.doc.rooms).length : 0;
    meta(`Exported session “${name}” (${Object.keys(doc.localStorage).length} settings, ${rooms} rooms).`);
  } catch (err) {
    errorLine(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function importClientConfigFile(file: File): Promise<void> {
  try {
    const doc = parseClientConfig(JSON.parse(await file.text()) as unknown);
    const name = doc.name?.trim() || file.name.replace(/\.json$/i, "") || "Imported";
    await reloadAfter(
      doc.map
        ? `Imported session “${name}” with its map — reloading…`
        : `Imported session “${name}” with an empty map — reloading…`,
      () => importSession(name, doc.localStorage, doc.map).then(() => undefined),
    );
  } catch (err) {
    errorLine(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    configImportInput.value = "";
  }
}

async function exportMapFile(): Promise<void> {
  try {
    if (!runtime) throw new Error("Map not ready");
    const name = activeSessionName();
    const map = await runtime.mapStore.exportSnapshot();
    const file = buildMapFile(map);
    downloadJson(mapExportFilename(file.exportedAt, name), file);
    meta(`Map exported for “${name}” (${Object.keys(map.doc.rooms).length} rooms).`);
  } catch (err) {
    errorLine(`Map export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function importMapFile(file: File): Promise<void> {
  try {
    if (!sessions) throw new Error("Session not ready");
    const map = parseMapImport(JSON.parse(await file.text()) as unknown);
    const rooms = Object.keys(map.doc.rooms).length;
    await reloadAfter(`Imported map (${rooms} rooms) into “${activeSessionName()}” — reloading…`, () =>
      BrowserMapStore.importSaved(sessions!.activeId, map),
    );
  } catch (err) {
    errorLine(`Map import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    mapImportInput.value = "";
  }
}

configExportBtn.addEventListener("click", () => void exportClientConfig());
configImportBtn.addEventListener("click", () => configImportInput.click());
configImportInput.addEventListener("change", () => {
  const file = configImportInput.files?.[0];
  if (file) void importClientConfigFile(file);
});
mapExportBtn.addEventListener("click", () => void exportMapFile());
mapImportBtn.addEventListener("click", () => mapImportInput.click());
mapImportInput.addEventListener("change", () => {
  const file = mapImportInput.files?.[0];
  if (file) void importMapFile(file);
});

sessionSelect.addEventListener("change", () => {
  const id = sessionSelect.value;
  if (!sessions || id === sessions.activeId) return;
  const name = sessions.sessions.find((s) => s.id === id)?.name ?? "session";
  void reloadAfter(`Switching to “${name}”…`, () => activateSession(id).then(() => undefined)).catch((err) => {
    errorLine(`Could not switch session: ${err instanceof Error ? err.message : String(err)}`);
    renderSessionSelect();
  });
});

sessionNewBtn.addEventListener("click", () => {
  const name = window.prompt("Name for the new session");
  if (!name?.trim()) return;
  void reloadAfter(`Starting “${name.trim()}”…`, () => createSession(name).then(() => undefined)).catch((err) =>
    errorLine(`Could not start session: ${err instanceof Error ? err.message : String(err)}`),
  );
});

sessionRenameBtn.addEventListener("click", () => {
  if (!sessions) return;
  const current = activeSessionName();
  const name = window.prompt("Rename session", current);
  if (!name?.trim() || name.trim() === current) return;
  void renameSession(sessions.activeId, name)
    .then((index) => {
      sessions = index;
      renderSessionSelect();
      meta(`Session renamed to “${activeSessionName()}”.`);
    })
    .catch((err) => errorLine(`Rename failed: ${err instanceof Error ? err.message : String(err)}`));
});

sessionDeleteBtn.addEventListener("click", () => {
  if (!sessions) return;
  const name = activeSessionName();
  const only = sessions.sessions.length === 1;
  const ok = window.confirm(
    only
      ? `Clear the map and settings for “${name}”? This session stays, empty.`
      : `Delete “${name}”? Its map and settings are removed.`,
  );
  if (!ok) return;
  void reloadAfter(only ? `Cleared “${name}”…` : `Deleted “${name}”…`, () =>
    deleteSession(sessions!.activeId).then(() => undefined),
  ).catch((err) => errorLine(`Could not delete session: ${err instanceof Error ? err.message : String(err)}`));
});

// ---- panels -----------------------------------------------------------------------------

let runtime: ClientRuntime | null = null;

const sidePanel = createSidePanel({
  mount: sidePanelMount,
  onCommsClear: () => runtime?.clearComms(),
});

let worldPanel: ReturnType<typeof createWorldPanel> | null = null;
let mapApiFn: ReturnType<typeof createMapApi> | null = null;

const clientDialogOnClose = () => {
  mudTerm.scrollToBottom();
  input.focus();
};

const appMenu = createAppMenu(appMenuBtn, appMenuPanel);
const aliasMenu = createAliasMenu(aliases, { onClose: clientDialogOnClose });
const whenMenu = createWhenMenu(whenRules, { onClose: clientDialogOnClose });
const hotkeyMenu = createHotkeyMenu(hotkeyRules, { onClose: clientDialogOnClose });
function clientDialogOpen(): boolean {
  return aliasMenu.isOpen() || whenMenu.isOpen() || hotkeyMenu.isOpen();
}

aliasMenuOpenBtn.addEventListener("click", () => {
  appMenu.setOpen(false);
  aliasMenu.open();
});
whenMenuOpenBtn.addEventListener("click", () => {
  appMenu.setOpen(false);
  whenMenu.open();
});
hotkeyMenuOpenBtn.addEventListener("click", () => {
  appMenu.setOpen(false);
  hotkeyMenu.open();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && clientDialogOpen()) {
    e.preventDefault();
    if (aliasMenu.isOpen()) aliasMenu.close();
    else if (whenMenu.isOpen()) whenMenu.close();
    else hotkeyMenu.close();
    return;
  }
  if (e.key === "Escape" && appMenu.isOpen()) {
    e.preventDefault();
    appMenu.setOpen(false);
    return;
  }
  if (!passwordMode() && !clientDialogOpen()) {
    const hotkeyCmd = hotkeyRules.commandForEvent(e);
    if (hotkeyCmd) {
      e.preventDefault();
      e.stopPropagation();
      submitLine(hotkeyCmd, hotkeyCmd);
      return;
    }
  }
  if (!(e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey)) return;
  if (e.code === "KeyW") {
    e.preventDefault();
    openWikiInNewTab(DEFAULT_WIKI_PATH);
  } else if (e.code === "KeyM" && worldPanel) {
    e.preventDefault();
    worldPanel.toggleExpanded();
  } else if (e.code === "KeyC") {
    e.preventDefault();
    sidePanel.toggleExpanded();
  } else if (e.code === "KeyD") {
    e.preventDefault();
    worldPanel?.setExpanded(false);
    mudTerm.scrollToBottom();
    input.focus();
  }
});

// ---- connection -------------------------------------------------------------------------

let serverEcho = false;
/** Once true, the primary action is labeled Reconnect (including while live). */
let mudSessionEstablished = false;

function renderStatus(status: RelayStatus): void {
  const [label, tone] =
    status === "connected"
      ? ["Connected", "conn-ok"]
      : status === "connecting"
        ? ["Connecting…", "conn-warn"]
        : status === "closed"
          ? ["Disconnected", "conn-err"]
          : ["Offline", "conn-muted"];
  statusEl.textContent = label;
  statusEl.classList.remove("conn-ok", "conn-warn", "conn-err", "conn-muted");
  statusEl.classList.add(tone);
  connectBtn.disabled = status === "connected" || status === "connecting";
  disconnectBtn.disabled = !(status === "connected" || status === "connecting");
  if (status === "connecting") {
    connectBtn.textContent = "Connecting…";
    connectBtn.title = "Connecting to powermud.com";
  } else if (mudSessionEstablished) {
    connectBtn.textContent = "Reconnect";
    connectBtn.title = "Reconnect to powermud.com";
  } else {
    connectBtn.textContent = "Connect";
    connectBtn.title = "Connect to powermud.com";
  }
}

const esetSync = new EsetLoginSync();

function sendQuiet(line: string): void {
  if (!connection.connected) return;
  try {
    connection.sendLine(line);
  } catch {
    /* closed between the check and the write */
  }
}

connection.on("status", (status, reason) => {
  if (status === "connected") mudSessionEstablished = true;
  renderStatus(status);
  if (status === "connected") {
    meta("Connected to Powermud.");
    runtime?.onConnected();
  } else if (status === "closed") {
    serverEcho = false;
    syncPasswordMode();
    esetSync.leaveGame();
    meta(`Disconnected${reason ? ` (${reason})` : ""}. Press Enter or Reconnect to reconnect.`);
    runtime?.onDisconnected();
  }
});
connection.on("data", (text) => {
  if (!runtime) {
    mudTerm.write(text);
    return;
  }
  const phaseBefore = runtime.state.phase;
  const { visible, send } = esetSync.consume(text);
  if (visible) {
    mudTerm.write(visible);
    runtime.onMudData(visible);
  }
  if (phaseBefore !== "in-game" && runtime.state.phase === "in-game") {
    const query = esetSync.onEnteredGame();
    if (query) sendQuiet(query);
  } else if (runtime.state.phase !== "in-game") {
    esetSync.leaveGame();
  }
  for (const line of send) sendQuiet(line);
  if (visible && !passwordMode() && runtime.state.phase === "in-game") {
    for (const wire of whenRules.commandsForOutput(visible)) sendAutomationLine(wire);
  }
});
connection.on("echo", (on) => {
  serverEcho = on;
  syncPasswordMode();
});
connection.on("sent", (line) => runtime?.onCommandSent(line));

function connect(): void {
  if (connection.connected || connection.status === "connecting") return;
  meta("Connecting…");
  connection.connect();
}

connectBtn.addEventListener("click", () => connect());
disconnectBtn.addEventListener("click", () => connection.close());

// ---- input line ---------------------------------------------------------------------------

const lineEditor = new TelnetLineEditor();
type HistoryEntry = { wire: string; display: string; expandClient?: boolean };
let lastSubmit: HistoryEntry | null = null;
const commandHistory: HistoryEntry[] = [];
let historyBrowseIndex = -1;
let historyDraft = "";

function passwordMode(): boolean {
  return serverEcho || runtime?.state.phase === "login-password";
}

function loadDisplayIntoEditor(text: string): void {
  lineEditor.reset();
  for (const ch of text) if (ch >= " ") lineEditor.insertChar(ch);
}

function pushCommandHistory(entry: HistoryEntry): void {
  if (passwordMode()) return;
  const last = commandHistory[commandHistory.length - 1];
  if (last && last.display === entry.display && last.wire === entry.wire) return;
  commandHistory.push(entry);
  if (commandHistory.length > 200) commandHistory.shift();
}

function clearHistoryBrowse(): void {
  historyBrowseIndex = -1;
  historyDraft = "";
}

/** Mask the field while the MUD asks for a password; resync when the type flips. */
function syncPasswordMode(): void {
  const want = passwordMode();
  const was = input.type === "password";
  if (was === want) return;
  input.type = want ? "password" : "text";
  if (was && !want) {
    lineEditor.reset();
    clearHistoryBrowse();
  }
  syncInputFromEditor();
}

function browseCommandHistory(up: boolean): boolean {
  if (commandHistory.length === 0) return false;
  if (up) {
    if (historyBrowseIndex === -1) {
      historyDraft = lineEditor.text;
      historyBrowseIndex = commandHistory.length - 1;
    } else if (historyBrowseIndex > 0) {
      historyBrowseIndex -= 1;
    }
    loadDisplayIntoEditor(commandHistory[historyBrowseIndex]!.display);
    return true;
  }
  if (historyBrowseIndex === -1) return false;
  if (historyBrowseIndex < commandHistory.length - 1) {
    historyBrowseIndex += 1;
    loadDisplayIntoEditor(commandHistory[historyBrowseIndex]!.display);
  } else {
    historyBrowseIndex = -1;
    loadDisplayIntoEditor(historyDraft);
  }
  return true;
}

const aliasAc = createAliasAutocomplete({
  listEl: aliasAcEl,
  getNames: () => aliases.names(),
  getLineText: () => lineEditor.text,
  applyName: (name) => {
    const parsed = parseSlashAliasLine(lineEditor.text);
    if (!parsed) return;
    const display = name + parsed.suffix;
    loadDisplayIntoEditor(display);
    lineEditor.cursor = display.length;
  },
});

const roomAc = createRoomAutocomplete({
  listEl: aliasAcEl,
  getLineText: () => lineEditor.text,
  applyHit: (hit) => {
    loadDisplayIntoEditor(`/to ${roomHitLabel(hit)}`);
    lineEditor.cursor = lineEditor.text.length;
  },
  search: async (query) => {
    if (!mapApiFn) return [];
    const res = await mapApiFn<{ hits: RoomSearchHitBrief[] }>(
      `/api/map/search?q=${encodeURIComponent(query)}&limit=40`,
    );
    return res.hits ?? [];
  },
  onPick: () => syncInputFromEditor(),
});

async function resolveSlashToRoomId(line: string): Promise<string | null> {
  const parsed = parseSlashToLine(line);
  if (!parsed) return null;
  const q = parsed.query.trim();
  if (!q || !mapApiFn) return null;
  const resolved = await mapApiFn<{ room?: { id: string } | null }>(
    `/api/map/resolve?ref=${encodeURIComponent(q)}`,
  );
  if (resolved.room?.id) return resolved.room.id;
  const res = await mapApiFn<{ hits: RoomSearchHitBrief[] }>(
    `/api/map/search?q=${encodeURIComponent(q)}&limit=40`,
  );
  const hit = rankRoomHits(res.hits ?? [], q, 1)[0];
  return hit?.id ?? null;
}

function refreshAliasAutocompleteUi(): void {
  if (passwordMode()) {
    aliasAc.hide();
    roomAc.hide(true);
    input.setAttribute("aria-expanded", "false");
    return;
  }
  if (parseSlashToLine(lineEditor.text)) {
    aliasAc.hide(false);
    const open = roomAc.refresh();
    input.setAttribute("aria-expanded", open ? "true" : "false");
    return;
  }
  roomAc.hide({ clearPending: true });
  const open = aliasAc.refresh();
  input.setAttribute("aria-expanded", open ? "true" : "false");
}

function autocompleteIsOpen(): boolean {
  return roomAc.isOpen() || aliasAc.isOpen();
}

function autocompleteMoveSelection(delta: number): boolean {
  if (parseSlashToLine(lineEditor.text)) return roomAc.moveSelection(delta);
  return aliasAc.moveSelection(delta);
}

function autocompleteAcceptSelected(): boolean {
  if (parseSlashToLine(lineEditor.text)) return roomAc.acceptSelected();
  return aliasAc.acceptSelected();
}

/** While browsing history, arrow keys walk prior commands — not slash-command suggestions. */
function commandHistoryArrowUp(): void {
  if (historyBrowseIndex !== -1) {
    browseCommandHistory(true);
    return;
  }
  if (aliasAc.isOpen() && commandHistory.length > 0) {
    browseCommandHistory(true);
    return;
  }
  if (autocompleteIsOpen()) autocompleteMoveSelection(-1);
  else browseCommandHistory(true);
}

function commandHistoryArrowDown(): void {
  if (historyBrowseIndex !== -1) {
    browseCommandHistory(false);
    return;
  }
  if (autocompleteIsOpen() && roomAc.isOpen()) autocompleteMoveSelection(1);
  else browseCommandHistory(false);
}

function syncInputFromEditor(): void {
  input.value = lineEditor.text;
  input.setSelectionRange(lineEditor.cursor, lineEditor.cursor);
  updateWireHint();
  refreshAliasAutocompleteUi();
}

/** Human-readable preview of cursor-move bytes that will be sent (Option+Shift+arrows). */
function updateWireHint(): void {
  const wire = lineEditor.getWireText();
  const readable = wire
    .replace(/\x1b\[A/g, "↑")
    .replace(/\x1b\[B/g, "↓")
    .replace(/\x1b\[D/g, "←")
    .replace(/\x1b\[C/g, "→");
  wireHintEl.textContent = readable === wire ? "" : `On Send: ${JSON.stringify(readable)}`;
}

/** Keep editor state aligned with the visible field (paste / click-to-move caret). */
function ensureEditorFromInput(): void {
  const v = input.value;
  const pos = input.selectionStart ?? v.length;
  if (v !== lineEditor.text) {
    loadDisplayIntoEditor(v);
    updateWireHint();
  }
  lineEditor.cursor = Math.min(Math.max(0, pos), lineEditor.text.length);
}

function syncCursorFromInputIfMatched(): void {
  if (input.value !== lineEditor.text) return;
  const pos = input.selectionStart ?? lineEditor.cursor;
  lineEditor.cursor = Math.min(Math.max(0, pos), lineEditor.text.length);
}

function getCommandInputSelectionSpan(): { from: number; to: number } | null {
  if (input.value !== lineEditor.text) return null;
  const a = input.selectionStart ?? 0;
  const b = input.selectionEnd ?? 0;
  if (a === b) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** MUD-style: click scrollback / chrome to type; leave real controls alone. */
function isCommandTypingChromeTarget(node: Element | null): boolean {
  if (!node) return true;
  if (node.closest("#input")) return false;
  return !node.closest(
    "button, a, select, textarea, input, label, .map-panel-root, .side-panel-root, .chat-panel-root, .client-dialog-backdrop",
  );
}

function shouldRedirectKeyToCommand(e: KeyboardEvent): boolean {
  if (document.activeElement === input) return false;
  if (!isCommandTypingChromeTarget(document.activeElement)) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === "Tab" || e.key === "Escape") return false;
  if (e.key.length === 1) return true;
  return ["Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key);
}

document.addEventListener("mousedown", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (document.body.classList.contains("layout-mobile") && t?.closest("#log")) return;
  if (isCommandTypingChromeTarget(t)) input.focus();
});

input.addEventListener("click", syncCursorFromInputIfMatched);
input.addEventListener("select", syncCursorFromInputIfMatched);
input.addEventListener("paste", (e) => {
  e.preventDefault();
  ensureEditorFromInput();
  clearHistoryBrowse();
  const text = e.clipboardData?.getData("text") ?? "";
  for (const ch of text) if (ch >= " ") applyTelnetKeyAction(lineEditor, { type: "char", ch });
  syncInputFromEditor();
});

function isWireArrowKeydown(e: KeyboardEvent): boolean {
  return e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.key.startsWith("Arrow");
}

function handleCommandLineKeydown(e: KeyboardEvent): void {
  const selectionSpan = getCommandInputSelectionSpan();
  ensureEditorFromInput();
  if (e.key === "Enter") return;

  if (e.key === "Tab" && autocompleteIsOpen()) {
    e.preventDefault();
    autocompleteAcceptSelected();
    syncInputFromEditor();
    return;
  }
  if (e.key === "Escape" && autocompleteIsOpen()) {
    e.preventDefault();
    roomAc.hide(true);
    aliasAc.hide();
    input.setAttribute("aria-expanded", "false");
    return;
  }

  let handled = true;
  if (e.key === "ArrowLeft") {
    if (isWireArrowKeydown(e)) lineEditor.insertWireCursorLeft();
    else lineEditor.cursorLeft();
  } else if (e.key === "ArrowRight") {
    if (isWireArrowKeydown(e)) lineEditor.insertWireCursorRight();
    else lineEditor.cursorRight();
  } else if (e.key === "ArrowUp") {
    if (isWireArrowKeydown(e)) lineEditor.insertWireCursorUp();
    else commandHistoryArrowUp();
  } else if (e.key === "ArrowDown") {
    if (isWireArrowKeydown(e)) lineEditor.insertWireCursorDown();
    else commandHistoryArrowDown();
  } else if (e.key === "Backspace") {
    clearHistoryBrowse();
    if (selectionSpan) lineEditor.deleteRange(selectionSpan.from, selectionSpan.to);
    else if (e.metaKey && !e.altKey) lineEditor.deleteToLineStart();
    else if (e.altKey && !e.metaKey && !e.ctrlKey) lineEditor.deleteWordBackward();
    else if (!e.metaKey && !e.altKey && !e.ctrlKey) lineEditor.backspace();
    else handled = false;
  } else if (e.key === "Delete" && selectionSpan) {
    clearHistoryBrowse();
    lineEditor.deleteRange(selectionSpan.from, selectionSpan.to);
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    clearHistoryBrowse();
    if (selectionSpan) lineEditor.deleteRange(selectionSpan.from, selectionSpan.to);
    applyTelnetKeyAction(lineEditor, { type: "char", ch: e.key });
  } else {
    handled = false;
  }
  if (handled) {
    e.preventDefault();
    syncInputFromEditor();
  }
}

input.addEventListener("keydown", handleCommandLineKeydown);
document.addEventListener(
  "keydown",
  (e) => {
    if (!shouldRedirectKeyToCommand(e)) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    input.focus();
    handleCommandLineKeydown(e);
  },
  true,
);

// ---- submit -------------------------------------------------------------------------------

/** `/wp`, `/to`, `/alias`, `/when`, `/hotkey`, and their list/remove forms. Not a MUD command. */
function isClientSlashAction(line: string): boolean {
  const text = line.trim();
  if (!text.startsWith("/")) return false;
  return !!(
    parseSlashWpLine(text) ||
    parseSlashToLine(text) ||
    isSlashAliasDefinePrefix(text) ||
    isSlashAliasUndefinePrefix(text) ||
    parseSlashAliasesLine(text) ||
    isSlashHotkeyManageLine(text) ||
    isSlashWhenManageLine(text)
  );
}

async function saveWaypoint(name: string): Promise<void> {
  if (!mapApiFn) throw new Error("Map not ready");
  if (!name.trim()) throw new Error("Usage: /wp <name> — save the current room as a waypoint");
  const r = await mapApiFn<{
    roomId: string;
    room?: { label?: string | null; title?: string | null };
  }>("/api/map/waypoint", { name });
  const where = r.room?.label ?? r.room?.title ?? r.roomId;
  meta(`Waypoint "${name.trim()}" → ${where} (${r.roomId})`);
  worldPanel?.refresh?.();
}

/** `/to` from the command line prints the path. From a button (and anything that button expands) it walks. */
async function followSlashTo(line: string, walk: boolean): Promise<void> {
  if (!mapApiFn) throw new Error("Map not ready");
  const roomId = await resolveSlashToRoomId(line);
  if (!roomId) throw new Error("No mapped room matches that /to query.");
  const path = await mapApiFn<{
    found: boolean;
    commands: string[];
    to?: { title?: string | null; id?: string };
  }>("/api/map/path", { to: roomId });
  if (!path.found || path.commands.length === 0) throw new Error("No known path from here to that room.");
  const dest = path.to?.title ?? path.to?.id ?? roomId;
  if (!walk) {
    meta(`Path to ${dest} (${path.commands.length} steps): ${path.commands.join("; ")}`);
    return;
  }
  if (!connection.connected) throw new Error("Not connected.");
  meta(`Walking to ${dest} (${path.commands.length} steps).`);
  connection.sendLines(path.commands);
  mudTerm.scrollToBottom();
}

async function runClientSlashAction(line: string): Promise<void> {
  const wp = parseSlashWpLine(line);
  if (wp) {
    await saveWaypoint(wp.name);
    return;
  }
  if (parseSlashToLine(line)) {
    await followSlashTo(line, true);
    return;
  }
  handleSlashCommand(line);
}

/** Send resolved lines, pausing on `@delay N` before the commands that follow it. */
function sendResolvedCommands(commands: string[], opts?: { expandClient?: boolean }): void {
  void runActionSteps(commands.length ? commands : [""], {
    send: (lines) => connection.sendLines(lines),
    connected: () => connection.connected,
    onError: (err) => errorLine(err instanceof Error ? err.message : String(err)),
    ...(opts?.expandClient
      ? { takes: (command: string) => isClientSlashAction(command), run: (command: string) => runClientSlashAction(command) }
      : {}),
  }).then(() => mudTerm.scrollToBottom());
}

/** Alias-expanded send without echo (for `/when` auto-replies). */
function sendAutomationLine(wire: string): void {
  if (!connection.connected) return;
  try {
    const { commands, error } = aliases.resolve(wire);
    if (error) {
      errorLine(error);
      return;
    }
    sendResolvedCommands(commands);
  } catch (err) {
    errorLine(err instanceof Error ? err.message : String(err));
  }
}

/** Expand aliases and write to the MUD; echo what you typed (never a password). */
function submitLine(wire: string, display: string, opts?: { expandClient?: boolean }): void {
  if (!connection.connected) {
    if (connection.status !== "connecting") connect();
    else errorLine("Still connecting…");
    return;
  }
  const secret = passwordMode();
  if (!secret) mudTerm.write(`${ECHO_ANSI}${display}${RESET}\n`);
  else mudTerm.write("\n");
  try {
    if (secret) {
      connection.sendLine(wire);
      return;
    }
    const { commands, error } = aliases.resolve(wire);
    if (error) {
      errorLine(error);
      return;
    }
    // An empty line still means "press Enter" (pagers, prompts).
    // Buttons ask for client expansion so aliases, /wp, and /to walks run here too.
    sendResolvedCommands(commands, { expandClient: opts?.expandClient === true });
  } catch (err) {
    errorLine(err instanceof Error ? err.message : String(err));
  }
  mudTerm.scrollToBottom();
}

/** Client slash commands (`/alias`, `/when`, …); true when the line was handled locally. */
function handleSlashCommand(line: string): boolean {
  const unhotkey = parseSlashUnhotkeyLine(line);
  if (unhotkey) {
    if (!unhotkey.ok) errorLine(unhotkey.reason);
    else if (hotkeyRules.removeAt(unhotkey.index)) meta(`Hotkey #${unhotkey.index} removed.`);
    else errorLine(`No hotkey #${unhotkey.index}. Type /hotkey to list.`);
    return true;
  }
  const hotkey = parseSlashHotkeyLine(line);
  if (hotkey) {
    if (hotkey.kind === "error") errorLine(hotkey.reason);
    else if (hotkey.kind === "list") meta(formatHotkeyListText(hotkeyRules.all()));
    else {
      const saved = hotkeyRules.add(hotkey.key, hotkey.command);
      if (!saved.ok) errorLine(saved.reason);
      else meta(`Hotkey saved: ${hotkey.key} → ${hotkey.command}`);
    }
    return true;
  }
  const unwhen = parseSlashUnwhenLine(line);
  if (unwhen) {
    if (!unwhen.ok) errorLine(unwhen.reason);
    else if (whenRules.removeAt(unwhen.index)) meta(`When command #${unwhen.index} removed.`);
    else errorLine(`No when command #${unwhen.index}. Type /when to list.`);
    return true;
  }
  const when = parseSlashWhenLine(line);
  if (when) {
    if (when.kind === "error") errorLine(when.reason);
    else if (when.kind === "list") meta(formatWhenListText(whenRules.all()));
    else {
      const saved = whenRules.add(when.trigger, when.command);
      if (!saved.ok) errorLine(saved.reason);
      else meta(`When saved: "${when.trigger}" → ${when.command}`);
    }
    return true;
  }
  const undef = parseSlashAliasUndefineLine(line);
  if (undef) {
    if (!undef.ok) errorLine(undef.reason);
    else if (aliases.remove(undef.name)) meta(`Alias "${undef.name}" removed.`);
    else errorLine(`No alias named "${undef.name}".`);
    return true;
  }
  const list = parseSlashAliasesLine(line);
  if (list) {
    const rows = aliases.list(list.filter);
    if (!rows.length) meta(list.filter ? `No aliases match "${list.filter}".` : "No aliases yet. Add one: /alias NAME EXPANSION");
    else meta(`Aliases (${rows.length}):\n${rows.map(([n, b]) => `  ${n} → ${b}`).join("\n")}`);
    return true;
  }
  const def = parseSlashAliasDefineLine(line);
  if (def) {
    if (!def.ok) errorLine(def.reason);
    else if (def.kind === "lookup") {
      const body = aliases.expansion(def.name);
      if (body == null) errorLine(`No alias named "${def.name}".`);
      else meta(`Alias "${def.name}" → ${body}`);
    } else {
      aliases.set(def.name, def.expansion);
      meta(`Alias "${def.name}" → ${def.expansion}`);
    }
    return true;
  }
  return false;
}

function resetInputLine(): void {
  lineEditor.reset();
  syncInputFromEditor();
  roomAc.hide(true);
  aliasAc.hide();
  input.setAttribute("aria-expanded", "false");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  ensureEditorFromInput();
  // Empty Enter: reconnect when offline, otherwise repeat the last command (as in the original UI).
  if (lineEditor.isEmpty()) {
    if (!connection.connected) {
      if (connection.status !== "connecting") connect();
    } else if (lastSubmit && !passwordMode()) {
      submitLine(lastSubmit.wire, lastSubmit.display, { expandClient: lastSubmit.expandClient === true });
    }
    else submitLine("", "");
    return;
  }
  const slashWp = parseSlashWpLine(lineEditor.text.trim());
  if (slashWp && !passwordMode()) {
    const slashWpLine = lineEditor.text.trim();
    void (async () => {
      try {
        await saveWaypoint(slashWp.name);
        pushCommandHistory({ wire: slashWpLine, display: slashWpLine });
        clearHistoryBrowse();
      } catch (err) {
        errorLine(err instanceof Error ? err.message : String(err));
      } finally {
        resetInputLine();
      }
    })();
    return;
  }
  const slashToLine = lineEditor.text.trim();
  if (parseSlashToLine(slashToLine) && !passwordMode()) {
    void (async () => {
      try {
        await followSlashTo(slashToLine, false);
        pushCommandHistory({ wire: slashToLine, display: slashToLine });
        clearHistoryBrowse();
      } catch (err) {
        errorLine(err instanceof Error ? err.message : String(err));
      } finally {
        resetInputLine();
      }
    })();
    return;
  }
  if (
    autocompleteIsOpen() &&
    !parseSlashToLine(lineEditor.text) &&
    autocompleteAcceptSelected()
  ) {
    syncInputFromEditor();
  }
  const display = lineEditor.text.trim();
  if (
    !passwordMode() &&
    (isSlashAliasDefinePrefix(display) ||
      isSlashAliasUndefinePrefix(display) ||
      parseSlashAliasesLine(display) ||
      isSlashHotkeyManageLine(display) ||
      isSlashWhenManageLine(display))
  ) {
    pushCommandHistory({ wire: display, display });
    clearHistoryBrowse();
    handleSlashCommand(display);
    resetInputLine();
    return;
  }
  // `/name` picks an alias from autocomplete; send it without the slash.
  if (!passwordMode() && lineEditor.text.startsWith("/")) loadDisplayIntoEditor(lineEditor.text.slice(1));
  const wire = lineEditor.getWireText();
  const shown = passwordMode() ? "" : lineEditor.text.trim();
  if (!passwordMode()) {
    lastSubmit = { wire, display: shown };
    pushCommandHistory(lastSubmit);
  }
  clearHistoryBrowse();
  submitLine(wire, shown);
  resetInputLine();
});

// ---- mobile -------------------------------------------------------------------------------

const MOBILE_LAYOUT_MQL = window.matchMedia("(max-width: 720px)");
const mobileActionsEl = document.getElementById("mobile-actions");
const mobileCommandsEl = document.getElementById("mobile-commands");
const DESKTOP_COMMAND_PLACEHOLDER = input.placeholder;

function syncMobileChromeHeight(): void {
  if (!document.body.classList.contains("layout-mobile")) return;
  let h = 0;
  for (const node of [mobileCommandsEl, mobileActionsEl, form, wireHintEl]) {
    if (!node || node.hidden || getComputedStyle(node).display === "none") continue;
    h += node.offsetHeight;
  }
  if (h > 0) document.body.style.setProperty("--mobile-chrome-height", `${h}px`);
}

/** Keep the command field above the keyboard. iOS does not shrink the layout viewport. */
function syncVisualViewport(): void {
  const vv = window.visualViewport;
  const keyboardOpen = vv && document.body.classList.contains("layout-mobile") && window.innerHeight - vv.height > 80;
  document.body.style.height = keyboardOpen ? `${vv.height}px` : "";
  document.body.style.transform = keyboardOpen && vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
}

function syncMobileLayout(): void {
  const on = MOBILE_LAYOUT_MQL.matches;
  document.body.classList.toggle("layout-mobile", on);
  if (mobileActionsEl) mobileActionsEl.hidden = !on;
  if (mobileCommandsEl) mobileCommandsEl.hidden = !on;
  input.placeholder = on ? "Command" : DESKTOP_COMMAND_PLACEHOLDER;
  syncVisualViewport();
  syncMobileChromeHeight();
}

syncMobileLayout();
MOBILE_LAYOUT_MQL.addEventListener("change", syncMobileLayout);
window.visualViewport?.addEventListener("resize", () => {
  syncVisualViewport();
  syncMobileChromeHeight();
});
window.visualViewport?.addEventListener("scroll", syncVisualViewport);
for (const node of [mobileCommandsEl, mobileActionsEl, form, wireHintEl]) {
  if (node) new ResizeObserver(() => syncMobileChromeHeight()).observe(node);
}

function runMobileButton(command: string): void {
  const display = command.trim();
  if (!display) return;
  if (passwordMode()) {
    errorLine("Finish signing in before using command buttons.");
    return;
  }
  const client = isClientSlashAction(display);
  const wire = client || !display.startsWith("/") ? display : display.slice(1);
  const shown = client ? display : wire;
  const entry = { wire, display: shown, expandClient: true as const };
  pushCommandHistory(entry);
  clearHistoryBrowse();
  lastSubmit = entry;
  submitLine(wire, shown, { expandClient: true });
}

const mobileAddBtn = document.getElementById("mobile-add");
if (mobileCommandsEl && mobileAddBtn instanceof HTMLButtonElement) {
  mountMobileCommandButtons({
    commandsEl: mobileCommandsEl,
    addButton: mobileAddBtn,
    listAliases: () => aliases.list().map(([name, expansion]) => ({ name, expansion })),
    listWaypoints: async () => {
      if (!mapApiFn) throw new Error("Map not ready");
      const res = await mapApiFn<{ waypoints: { name: string; label?: string }[] }>("/api/map/waypoints");
      return res.waypoints ?? [];
    },
    onRun: runMobileButton,
    onLayout: () => syncMobileChromeHeight(),
  });
}
document.getElementById("mobile-map")?.addEventListener("click", () => worldPanel?.toggleExpanded());
document.getElementById("mobile-comms")?.addEventListener("click", () => sidePanel.toggleExpanded());

// ---- boot ---------------------------------------------------------------------------------

async function boot(): Promise<void> {
  renderStatus("idle");
  meta("Loading sessions…");
  sessions = await ensureSessions();
  renderSessionSelect();
  const { store, source } = await BrowserMapStore.open(sessions.activeId, (err) =>
    console.warn("[playpowermud] map storage:", err),
  );
  runtime = new ClientRuntime(store);
  runtime.on((msg) => worldPanel?.onMessage(msg));
  runtime.onComms((entry, all, updated) => {
    if (updated && entry) sidePanel.updateCommsEntry(entry);
    else if (entry) sidePanel.appendCommsEntry(entry);
    else sidePanel.syncComms(all);
  });
  runtime.state.on(() => syncPasswordMode());
  sidePanel.syncComms(runtime.commsSnapshot());
  mapApiFn = createMapApi(runtime);
  worldPanel = createWorldPanel({ mount: mapPanelMount, api: mapApiFn });
  const rooms = store.map.roomCount();
  const name = activeSessionName();
  meta(
    `Session “${name}”: ${rooms === 0 || source === "empty" ? "empty map until you explore" : `${rooms} rooms`}. ` +
      `Aliases: ${aliases.names().length}. Type /alias NAME EXPANSION to add one.`,
  );
  window.addEventListener("pagehide", () => void store.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void store.flush();
  });
  if (connection.connected) {
    mudSessionEstablished = true;
    renderStatus("connected");
    runtime.onConnected();
  } else {
    connect();
  }
}

void boot().catch((err) => errorLine(`Startup failed: ${err instanceof Error ? err.message : String(err)}`));
input.focus();
