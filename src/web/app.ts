import { parseSlashAliasesLine } from "../aliases/slashCommands.js";
import { AliasStore } from "../client/aliases.js";
import { HotkeyRulesStore } from "../client/hotkeyRules.js";
import { WhenRulesStore } from "../client/whenRules.js";
import {
  applyClientConfigToLocalStorage,
  buildClientConfig,
  collectPlaypowermudLocalStorage,
  configExportFilename,
  parseClientConfig,
} from "../client/clientConfig.js";
import { defaultRelayUrl, type RelayStatus } from "../client/connection.js";
import { createMudConnection } from "../client/relayClient.js";
import { createMapApi } from "../client/mapApi.js";
import { BrowserMapStore } from "../client/mapStore.js";
import { ClientRuntime } from "../client/runtime.js";
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
import { createWorldPanel } from "./worldPanel.js";
import { createWikiOverlay } from "./wikiOverlay.js";

/** Replaced at build time (scripts/build.mjs); empty = this site's own /api/ws. */
declare const __RELAY_URL__: string;

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
const form = byId<HTMLFormElement>("form");
const input = byId<HTMLInputElement>("input");
const aliasAcEl = byId("alias-ac");
const wireHintEl = byId("wire-hint");
const mapPanelMount = byId("map-panel-mount");
const sidePanelMount = byId("chat-panel-mount");
const wikiOpenBtn = byId<HTMLButtonElement>("wiki-open");

const mudTerm = createMudTerminal(logEl, 10_000);
const aliases = new AliasStore();
const whenRules = new WhenRulesStore();
const hotkeyRules = new HotkeyRulesStore();
const connection = createMudConnection(defaultRelayUrl(location, __RELAY_URL__));

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

// ---- config export / import -------------------------------------------------------------

async function exportClientConfig(): Promise<void> {
  try {
    const map = runtime ? await runtime.mapStore.exportSnapshot() : undefined;
    const doc = buildClientConfig({
      localStorage: collectPlaypowermudLocalStorage(localStorage),
      map,
    });
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = configExportFilename(doc.exportedAt);
    a.click();
    URL.revokeObjectURL(url);
    meta(
      `Config exported (${Object.keys(doc.localStorage).length} localStorage keys${map ? ", map included" : ""}).`,
    );
  } catch (err) {
    errorLine(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function importClientConfigFile(file: File): Promise<void> {
  try {
    const doc = parseClientConfig(JSON.parse(await file.text()) as unknown);
    applyClientConfigToLocalStorage(doc, localStorage);
    if (doc.map) await BrowserMapStore.importSaved(doc.map);
    meta("Config imported — reloading…");
    window.location.reload();
  } catch (err) {
    errorLine(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    configImportInput.value = "";
  }
}

configExportBtn.addEventListener("click", () => void exportClientConfig());
configImportBtn.addEventListener("click", () => configImportInput.click());
configImportInput.addEventListener("change", () => {
  const file = configImportInput.files?.[0];
  if (file) void importClientConfigFile(file);
});

// ---- panels -----------------------------------------------------------------------------

let runtime: ClientRuntime | null = null;

const sidePanel = createSidePanel({
  mount: sidePanelMount,
  onCommsClear: () => runtime?.clearComms(),
});

let worldPanel: ReturnType<typeof createWorldPanel> | null = null;

const wikiOverlay = createWikiOverlay({
  defaultPath: "/wiki/reference/",
  onClose: () => {
    mudTerm.scrollToBottom();
    input.focus();
  },
});

wikiOpenBtn.addEventListener("click", () => wikiOverlay.toggle());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && wikiOverlay.isOpen()) {
    e.preventDefault();
    wikiOverlay.close();
    return;
  }
  if (!passwordMode()) {
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
    wikiOverlay.toggle();
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

connection.on("status", (status, reason) => {
  if (status === "connected") mudSessionEstablished = true;
  renderStatus(status);
  if (status === "connected") {
    meta("Connected to Powermud.");
    runtime?.onConnected();
  } else if (status === "closed") {
    serverEcho = false;
    syncPasswordMode();
    meta(`Disconnected${reason ? ` (${reason})` : ""}. Press Enter or Reconnect to reconnect.`);
    runtime?.onDisconnected();
  }
});
connection.on("data", (text) => {
  mudTerm.write(text);
  runtime?.onMudData(text);
  if (!passwordMode() && runtime?.state.phase === "in-game") {
    for (const wire of whenRules.commandsForOutput(text)) sendAutomationLine(wire);
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
type HistoryEntry = { wire: string; display: string };
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

function refreshAliasAutocompleteUi(): void {
  const open = passwordMode() ? (aliasAc.hide(), false) : aliasAc.refresh();
  input.setAttribute("aria-expanded", open ? "true" : "false");
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
  return !node.closest("button, a, select, textarea, input, label, .map-panel-root, .side-panel-root, .chat-panel-root");
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

  if (e.key === "Tab" && aliasAc.isOpen()) {
    e.preventDefault();
    aliasAc.acceptSelected();
    syncInputFromEditor();
    return;
  }
  if (e.key === "Escape" && aliasAc.isOpen()) {
    e.preventDefault();
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
    else if (aliasAc.isOpen()) aliasAc.moveSelection(-1);
    else browseCommandHistory(true);
  } else if (e.key === "ArrowDown") {
    if (isWireArrowKeydown(e)) lineEditor.insertWireCursorDown();
    else if (aliasAc.isOpen()) aliasAc.moveSelection(1);
    else browseCommandHistory(false);
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

/** Alias-expanded send without echo (for `/when` auto-replies). */
function sendAutomationLine(wire: string): void {
  if (!connection.connected) return;
  try {
    const { commands, error } = aliases.resolve(wire);
    if (error) {
      errorLine(error);
      return;
    }
    connection.sendLines(commands.length ? commands : [""]);
  } catch (err) {
    errorLine(err instanceof Error ? err.message : String(err));
  }
}

/** Expand aliases and write to the MUD; echo what you typed (never a password). */
function submitLine(wire: string, display: string): void {
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
    connection.sendLines(commands.length ? commands : [""]);
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
    else {
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
    } else if (lastSubmit && !passwordMode()) submitLine(lastSubmit.wire, lastSubmit.display);
    else submitLine("", "");
    return;
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

for (const btn of document.querySelectorAll<HTMLElement>("[data-quick-cmd]")) {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.quickCmd?.trim();
    if (!cmd) return;
    pushCommandHistory({ wire: cmd, display: cmd });
    lastSubmit = { wire: cmd, display: cmd };
    submitLine(cmd, cmd);
  });
}
document.getElementById("mobile-map")?.addEventListener("click", () => worldPanel?.toggleExpanded());
document.getElementById("mobile-comms")?.addEventListener("click", () => sidePanel.toggleExpanded());

// ---- boot ---------------------------------------------------------------------------------

async function boot(): Promise<void> {
  renderStatus("idle");
  meta("Loading world map…");
  const { store, source } = await BrowserMapStore.open((err) =>
    console.warn("[playpowermud] map storage:", err),
  );
  runtime = new ClientRuntime(store);
  runtime.on((msg) => worldPanel?.onMessage(msg));
  runtime.onComms((entry, all) => {
    if (entry) sidePanel.appendCommsEntry(entry);
    else sidePanel.syncComms(all);
  });
  runtime.state.on(() => syncPasswordMode());
  sidePanel.syncComms(runtime.commsSnapshot());
  worldPanel = createWorldPanel({ mount: mapPanelMount, api: createMapApi(runtime) });
  meta(
    `Map ready: ${store.map.roomCount()} rooms (${source === "saved" ? "with what this browser learned" : source}). ` +
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
