import type { WhenRule } from "./types.js";

/** Meta text for `/when` with no args (numbered list + how to delete). */
export function formatWhenListText(rules: readonly WhenRule[]): string {
  if (rules.length === 0) {
    return 'No when commands yet. Add one: /when "TRIGGER" "COMMAND"';
  }
  const lines = [
    `When commands (${rules.length}):`,
    "Remove a rule with /unwhen NUMBER (numbers match the list below).",
    ...rules.map((r, i) => `  ${i + 1}. when "${r.match}" → ${r.command}`),
  ];
  return lines.join("\n");
}
