/**
 * Display title for a mapped room. Rooms seen in verbose mode often have no stored `title`,
 * so the title falls back to the first sentence of the description. Combat rounds, NPC speech
 * and other stream lines that leaked into the top of a stored description
 * (`Drow punches you with zeal, but doing no damage.`, `Bartender asks in drow : …`) must never
 * become the title, so leading non-prose lines are skipped first.
 */
import { isLeadingDescriptionFragment, isRoomDescriptionNoiseLine } from "../game/roomDescriptionNoise.js";
import type { MapRoom } from "./types.js";

/** Combat / speech lines that are never room prose (complements roomDescriptionNoise). */
const NON_TITLE_LINE: RegExp[] = [
  /\bwith zeal\b|\bdoing no damage\b|\bcausing (?:\w+ )?damage\b|\btakes? (?:some |\w+ )?damage\b/i,
  /\b(?:misses|hits|attacks|launches at|rams into|lashes out at|breathes \w+ at) you\b/i,
  /^You (?:slash|pierce|stab|punch|kick|hit|miss|crush|smash|claw|bite|backstab|kill(?:ed)?)\b/i,
  /^.+? (?:says|asks|exclaims|shouts|whispers|yells|tells you|replies)\b[^:]*:/i,
  /^\[[^\]]+\]\s/,
  // Exclamations aimed at you (`The spider slams into you!`) are combat/flavor, not room prose.
  /\byou\b.*!\s*$/i,
];

export function isNonTitleLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (NON_TITLE_LINE.some((re) => re.test(t))) return true;
  return isRoomDescriptionNoiseLine(t);
}

/** First sentence of the description after skipping leaked combat / speech / noise lines. */
export function titleFromDescription(description: string | undefined, max = 60): string | undefined {
  if (!description) return undefined;
  const lines = description.split("\n");
  let i = 0;
  while (i < lines.length && isNonTitleLine(lines[i]!)) i++;
  // Prefer a real prose opener over a replayed mid-sentence fragment, but keep the fragment
  // when the whole description is fragments (better than no title).
  let j = i;
  while (j < lines.length && (isNonTitleLine(lines[j]!) || isLeadingDescriptionFragment(lines[j]!.trim()))) j++;
  const firstSentence = (from: number) => lines.slice(from).join("\n").split(/[.\n]/)[0]?.trim().slice(0, max) || undefined;
  return firstSentence(j < lines.length ? j : i);
}

/** `room.title`, else a clean first sentence of the description. */
export function roomDisplayTitle(room: Pick<MapRoom, "title" | "description">, max = 60): string | undefined {
  return room.title?.trim() || titleFromDescription(room.description, max);
}
