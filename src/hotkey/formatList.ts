import type { HotkeyRule } from "./types.js";

/** Meta text for `/hotkey` with no args (numbered list + how to delete). */
export function formatHotkeyListText(rules: readonly HotkeyRule[]): string {
  if (rules.length === 0) {
    return 'No hotkeys yet. Add one: /hotkey "KEY" "COMMAND" (e.g. /hotkey "F2" "score")';
  }
  const lines = [
    `Hotkeys (${rules.length}):`,
    "Remove a binding with /unhotkey NUMBER (numbers match the list below).",
    ...rules.map((r, i) => `  ${i + 1}. hotkey ${r.key} → ${r.command}`),
  ];
  return lines.join("\n");
}
