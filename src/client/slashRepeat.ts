export type SlashRepeatParse =
  | { kind: "toggle" }
  | { kind: "set"; on: boolean }
  | { kind: "error"; reason: string };

/** `/repeat`, `/repeat on`, or `/repeat off`. */
export function parseSlashRepeatLine(text: string): SlashRepeatParse | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith("/repeat")) return null;
  const afterCmd = trimmed.slice("/repeat".length);
  if (afterCmd.length > 0 && !/^\s/.test(afterCmd)) return null;
  const rest = afterCmd.trimStart();
  if (!rest) return { kind: "toggle" };
  const word = rest.split(/\s+/)[0]!.toLowerCase();
  if (word === "on" || word === "yes" || word === "1" || word === "true") return { kind: "set", on: true };
  if (word === "off" || word === "no" || word === "0" || word === "false") return { kind: "set", on: false };
  return { kind: "error", reason: "usage: /repeat [on|off]" };
}

export function isSlashRepeatManageLine(text: string): boolean {
  return parseSlashRepeatLine(text) !== null;
}