import { canonicalDirection, isGeometricDirection, parseExitList } from "./directions.js";
import { defaultGameProfile, type GameProfile } from "./profile.js";

/** Named (non-compass) exits accepted in brief room lines like `Dragon's lair (w, out)`. */
const NAMED_EXITS = new Set([
  "out",
  "in",
  "enter",
  "exit",
  "lair",
  "climb",
  "portal",
  "hole",
  "gate",
  "door",
  "cave",
  "tunnel",
  "path",
  "stairs",
  "ladder",
  "jump",
  "leave",
  "board",
  "swim",
  "crawl",
  "none",
]);

export type BriefRoomLine = { title: string; exits: string[] };

/** Strip `[HP:… SP:…]` / `> ` prefixes (same as live stream parsing). */
export function stripLeadingGamePrompt(line: string, profile?: GameProfile): string {
  const p = profile ?? defaultGameProfile();
  let rest = line.trim();
  for (;;) {
    const pm = rest.match(p.promptPrefix);
    if (!pm) break;
    rest = rest.slice(pm[0].length);
  }
  return rest.replace(/^>\s?/, "").trim();
}

function briefExitsLookValid(tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  let anyKnown = false;
  for (const t of tokens) {
    const dir = canonicalDirection(t);
    if (dir && isGeometricDirection(dir)) anyKnown = true;
    else if (NAMED_EXITS.has(t)) anyKnown = true;
  }
  return anyKnown;
}

/** Powermud brief room line: `Melee-Magthere : Grand Melee (s).` */
export function parseBriefRoomLine(line: string, profile?: GameProfile): BriefRoomLine | null {
  const p = profile ?? defaultGameProfile();
  const t = stripLeadingGamePrompt(line, p);
  const brief = t.match(p.briefRoom);
  if (!brief) return null;
  const tokens = brief[2]!.split(",").map((s) => s.trim()).filter(Boolean);
  if (!briefExitsLookValid(tokens) || /^You /.test(brief[1]!)) return null;
  return {
    title: brief[1]!.trim(),
    exits: parseExitList(brief[2]!),
  };
}

export function formatBriefRoomHint(room: BriefRoomLine): string {
  return `${room.title} (${room.exits.join(", ")})`;
}
