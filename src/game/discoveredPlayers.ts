
/**
 * `social` is legacy (any say line — NPCs included); new lines record `tell`/`channel`/`shout`;
 * `path` = seen in a room with a player object path (`std/body/player#…`).
 * Only {@link TRUSTED_SOURCES} prove a name is a player.
 */
export type DiscoverSource = "who" | "announce" | "room" | "social" | "tell" | "channel" | "shout" | "path";

/** Sources that only real players produce (NPCs say, arrive and emote, but never show in `who`). */
export const TRUSTED_SOURCES: ReadonlySet<DiscoverSource> = new Set(["who", "announce", "tell", "channel", "shout", "path"]);

export type DiscoveredPlayer = {
  name: string;
  firstSeen: string;
  lastSeen: string;
  sources: DiscoverSource[];
  /** Last `who` snapshot had this name online (hub-local clock). */
  onlineAt?: number;
};

export type DiscoveredPlayersFile = {
  updated?: string;
  players: DiscoveredPlayer[];
};

/** Powermud `who` row: `[   Newbie   ] Lorax - title … [215 m]` */
export const WHO_ROW = /^\[\s*([^\]]+?)\s*\]\s+(\S+)/;

/** Live channel: `ANNOUNCE : Wybie has reconnected to PowerMud.` */
export const ANNOUNCE_PREFIX = /^ANNOUNCE\s*:\s*(.+)$/i;

/** Login / `announce` history lines (no prefix). */
export const ANNOUNCE_BODY =
  /^(\S+)\s+(?:has entered PowerMud(?: for the first time)?|has left PowerMud|has reconnected to PowerMud|just went linkdead|was killed by)\b/i;

const SKIP_NAMES = new Set(
  ["powermud", "power", "announce", "channels", "autosave", "duergar"].map((s) => s.toLowerCase()),
);

function normName(name: string): string {
  return name.trim().toLowerCase();
}

function canonName(name: string): string {
  const t = name.trim();
  if (!t) return t;
  return t[0]!.toUpperCase() + t.slice(1).toLowerCase();
}

export function parseWhoLine(line: string): { name: string; rank: string } | null {
  const t = line.trim();
  // `[Newbie] Lorax : hi` is a channel line, `[mudwithme] cad: …` a hub note — not `who` rows.
  if (/^\[[^\]]+\]\s+\S*\s*:/.test(t)) return null;
  const m = t.match(WHO_ROW);
  if (!m) return null;
  const name = m[2]!;
  if (SKIP_NAMES.has(normName(name))) return null;
  return { rank: m[1]!.trim(), name: canonName(name) };
}

/** Extract player names from a full `who` command output block. */
export function parseWhoOutput(text: string): { name: string; rank: string }[] {
  const out: { name: string; rank: string }[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const row = parseWhoLine(line);
    if (!row) continue;
    const key = normName(row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function parseAnnounceLine(line: string): string | null {
  let t = line.trim();
  if (!t || /^PowerMud is rebooting/i.test(t)) return null;

  const prefixed = t.match(ANNOUNCE_PREFIX);
  if (prefixed) t = prefixed[1]!.trim();

  const body = t.match(ANNOUNCE_BODY);
  if (!body) return null;
  const name = body[1]!;
  if (SKIP_NAMES.has(normName(name))) return null;
  return canonName(name);
}
