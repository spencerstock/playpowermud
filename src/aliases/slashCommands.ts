/** Client slash commands (shown in input autocomplete). Everything else goes to the MUD. */
export const CLIENT_SLASH_COMMANDS = ["/alias", "/aliases", "/unalias"] as const;

export type ClientSlashCommand = (typeof CLIENT_SLASH_COMMANDS)[number];

/** Score command tokens (without leading `/`) against the first word after `/`. */
export function filterSlashCommands(
  query: string,
  limit = 12,
  scoreFn: (name: string, query: string) => number,
): string[] {
  const trimmed = query.trim();
  const ranked: { name: string; score: number }[] = [];
  for (const cmd of CLIENT_SLASH_COMMANDS) {
    const token = cmd.slice(1);
    const score = scoreFn(token, trimmed);
    if (score < 0) continue;
    ranked.push({ name: cmd, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ranked.slice(0, limit).map((r) => r.name);
}

/**
 * True when the user is entering arguments for a slash command (hide alias autocomplete).
 * Completing the command name itself (e.g. `/al`) still allows suggestions.
 */
export function isSlashCommandArgsEntry(text: string): boolean {
  const t = text.trimStart();
  return /^\/(?:alias|unalias|aliases)\s/i.test(t);
}

/** `/aliases` (optionally with a filter word) lists the alias table. */
export function parseSlashAliasesLine(text: string): { filter: string } | null {
  const m = /^\/aliases(?:\s+(.*))?$/i.exec(text.trim());
  return m ? { filter: (m[1] ?? "").trim() } : null;
}
