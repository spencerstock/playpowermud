export type SlashAliasDefineParse =
  | { ok: true; name: string; expansion: string }
  | { ok: false; reason: string };

/** `/alias cma cast magic invulnerability` → local alias `cma`. */
export function parseSlashAliasDefineLine(text: string): SlashAliasDefineParse | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/alias")) return null;
  const afterCmd = trimmed.slice("/alias".length);
  if (afterCmd.length > 0 && !/^\s/.test(afterCmd)) return null;
  const rest = afterCmd.trimStart();
  if (!rest) {
    return { ok: false, reason: "usage: /alias NAME EXPANSION" };
  }
  const space = rest.search(/\s/);
  if (space < 0) {
    return { ok: false, reason: "usage: /alias NAME EXPANSION" };
  }
  const name = rest.slice(0, space).trim();
  const expansion = rest.slice(space + 1).trim();
  if (!name) return { ok: false, reason: "missing alias name" };
  if (!expansion) return { ok: false, reason: "missing alias expansion" };
  if (/\s/.test(name)) return { ok: false, reason: "alias name must be one word" };
  if (name.includes(";")) return { ok: false, reason: "alias name cannot contain ;" };
  return { ok: true, name, expansion };
}

/** True while typing a `/alias …` define line (not plain `/cmi` autocomplete). */
export function isSlashAliasDefinePrefix(text: string): boolean {
  const t = text.trimStart();
  return /^\/alias(\s|$)/i.test(t);
}

export type SlashAliasUndefineParse = { ok: true; name: string } | { ok: false; reason: string };

/** `/unalias cma` removes local alias `cma`. */
export function parseSlashAliasUndefineLine(text: string): SlashAliasUndefineParse | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/unalias")) return null;
  const afterCmd = trimmed.slice("/unalias".length);
  if (afterCmd.length > 0 && !/^\s/.test(afterCmd)) return null;
  const rest = afterCmd.trimStart();
  if (!rest) {
    return { ok: false, reason: "usage: /unalias NAME" };
  }
  if (/\s/.test(rest)) {
    return { ok: false, reason: "usage: /unalias NAME" };
  }
  const name = rest;
  if (name.includes(";")) return { ok: false, reason: "alias name cannot contain ;" };
  return { ok: true, name };
}

/** True while typing `/unalias …` (hide plain `/foo` autocomplete). */
export function isSlashAliasUndefinePrefix(text: string): boolean {
  const t = text.trimStart();
  return /^\/unalias(\s|$)/i.test(t);
}
