import { parseDoubleQuotedString } from "../when/slashWhen.js";

export type SlashHotkeyParse =
  | { kind: "list" }
  | { kind: "define"; key: string; command: string }
  | { kind: "error"; reason: string };

export type SlashUnhotkeyParse = { ok: true; index: number } | { ok: false; reason: string };

/** `/hotkey "KEY" "COMMAND"` or `/hotkey` to list. */
export function parseSlashHotkeyLine(text: string): SlashHotkeyParse | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/hotkey")) return null;
  const afterCmd = trimmed.slice("/hotkey".length);
  if (afterCmd.length > 0 && !/^\s/.test(afterCmd)) return null;
  const rest = afterCmd.trimStart();
  if (!rest) return { kind: "list" };

  const first = parseDoubleQuotedString(rest);
  if (!first) {
    return { kind: "error", reason: 'usage: /hotkey "KEY" "COMMAND" (or /hotkey to list)' };
  }
  const between = first.rest.trimStart();
  const second = parseDoubleQuotedString(between);
  if (!second) {
    return { kind: "error", reason: 'usage: /hotkey "KEY" "COMMAND"' };
  }
  if (second.rest.trim()) {
    return { kind: "error", reason: 'usage: /hotkey "KEY" "COMMAND"' };
  }
  const key = first.value.trim();
  const command = second.value.trim();
  if (!key) return { kind: "error", reason: "missing key" };
  if (!command) return { kind: "error", reason: "missing command" };
  return { kind: "define", key, command };
}

/** `/unhotkey NUMBER` — index from `/hotkey` list (1-based). */
export function parseSlashUnhotkeyLine(text: string): SlashUnhotkeyParse | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/unhotkey")) return null;
  const afterCmd = trimmed.slice("/unhotkey".length);
  if (afterCmd.length > 0 && !/^\s/.test(afterCmd)) return null;
  const rest = afterCmd.trimStart();
  if (!rest) return { ok: false, reason: "usage: /unhotkey NUMBER" };
  const m = /^(\d+)\s*$/.exec(rest);
  if (!m) return { ok: false, reason: "usage: /unhotkey NUMBER" };
  const index = Number(m[1]);
  if (!Number.isInteger(index) || index < 1) return { ok: false, reason: "usage: /unhotkey NUMBER" };
  return { ok: true, index };
}

export function isSlashHotkeyPrefix(text: string): boolean {
  const t = text.trimStart();
  return /^\/hotkey(\s|$)/i.test(t);
}

export function isSlashUnhotkeyPrefix(text: string): boolean {
  const t = text.trimStart();
  return /^\/unhotkey(\s|$)/i.test(t);
}

export function isSlashHotkeyManageLine(text: string): boolean {
  const t = text.trim();
  return isSlashHotkeyPrefix(t) || isSlashUnhotkeyPrefix(t) || parseSlashHotkeyLine(t)?.kind === "list";
}
