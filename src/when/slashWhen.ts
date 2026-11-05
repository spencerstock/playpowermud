export type SlashWhenParse =
  | { kind: "list" }
  | { kind: "define"; trigger: string; command: string }
  | { kind: "error"; reason: string };

export type SlashUnwhenParse = { ok: true; index: number } | { ok: false; reason: string };

/** Parse one double-quoted string; returns null if not starting with `"`. */
export function parseDoubleQuotedString(input: string): { value: string; rest: string } | null {
  const t = input.trimStart();
  if (!t.startsWith('"')) return null;
  let i = 1;
  let value = "";
  while (i < t.length) {
    const ch = t[i]!;
    if (ch === "\\" && i + 1 < t.length) {
      value += t[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { value, rest: t.slice(i + 1) };
    }
    value += ch;
    i += 1;
  }
  return null;
}

/** `/when "trigger" "command"` or `/when` to list. */
export function parseSlashWhenLine(text: string): SlashWhenParse | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/when")) return null;
  const afterCmd = trimmed.slice("/when".length);
  if (afterCmd.length > 0 && !/^\s/.test(afterCmd)) return null;
  const rest = afterCmd.trimStart();
  if (!rest) return { kind: "list" };

  const first = parseDoubleQuotedString(rest);
  if (!first) {
    return { kind: "error", reason: 'usage: /when "TRIGGER" "COMMAND" (or /when to list)' };
  }
  const between = first.rest.trimStart();
  const second = parseDoubleQuotedString(between);
  if (!second) {
    return { kind: "error", reason: 'usage: /when "TRIGGER" "COMMAND"' };
  }
  if (second.rest.trim()) {
    return { kind: "error", reason: 'usage: /when "TRIGGER" "COMMAND"' };
  }
  const trigger = first.value.trim();
  const command = second.value.trim();
  if (!trigger) return { kind: "error", reason: "missing trigger" };
  if (!command) return { kind: "error", reason: "missing command" };
  return { kind: "define", trigger, command };
}

/** `/unwhen NUMBER` — index from `/when` list (1-based). */
export function parseSlashUnwhenLine(text: string): SlashUnwhenParse | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/unwhen")) return null;
  const afterCmd = trimmed.slice("/unwhen".length);
  if (afterCmd.length > 0 && !/^\s/.test(afterCmd)) return null;
  const rest = afterCmd.trimStart();
  if (!rest) return { ok: false, reason: "usage: /unwhen NUMBER" };
  const m = /^(\d+)\s*$/.exec(rest);
  if (!m) return { ok: false, reason: "usage: /unwhen NUMBER" };
  const index = Number(m[1]);
  if (!Number.isInteger(index) || index < 1) return { ok: false, reason: "usage: /unwhen NUMBER" };
  return { ok: true, index };
}

export function isSlashWhenPrefix(text: string): boolean {
  const t = text.trimStart();
  return /^\/when(\s|$)/i.test(t);
}

export function isSlashUnwhenPrefix(text: string): boolean {
  const t = text.trimStart();
  return /^\/unwhen(\s|$)/i.test(t);
}

export function isSlashWhenManageLine(text: string): boolean {
  const t = text.trim();
  return isSlashWhenPrefix(t) || isSlashUnwhenPrefix(t) || parseSlashWhenLine(t)?.kind === "list";
}
