import { isGeometricDirection } from "../game/directions.js";
import { flakyBatchRepeatFromCatalog } from "./flakyTravelCatalog.js";
import type { MapLink, MapRoom } from "./types.js";

/**
 * Verbs that take you somewhere. An unlisted command only becomes a secret exit on the strength
 * of one of these (or a noun from the room's own prose, or a place in a travel alias): combat and
 * utility commands (`double-thrust`, `globe of darkness on lich`, `common …`) are often still
 * queued when a room display arrives, and each used to be recorded as an exit.
 */
const TRAVEL_VERB =
  /^(?:enter|exit|leave|out|in|inside|outside|climb|crawl|leap|jump|hop|squeeze|slide|slip|dive|swim|wade|descend|ascend|pass|push|pull|pry|press|touch|turn|twist|lift|move|step|go|grab|force|stand|board|disembark|walk|run|cross|follow|ride|down|up|through|into|over|under|across|around|behind|back|search)\b/i;

/**
 * `cmd` could plausibly be a way out of `room`: a travel verb, a command the travel aliases
 * spam as a move, or one that names something the room's description mentions (`island`, `mist`).
 */
export function looksLikeTravelCommand(cmd: string, room?: Pick<MapRoom, "description" | "exits">): boolean {
  const c = cmd.trim().toLowerCase();
  if (!c) return false;
  if (isGeometricDirection(c) || room?.exits.includes(c)) return true;
  if (TRAVEL_VERB.test(c) || flakyBatchRepeatFromCatalog(c) !== undefined) return true;
  const prose = room?.description?.toLowerCase();
  if (!prose) return false;
  const words = c.split(/[^a-z']+/).filter((w) => w.length >= 4);
  // Every content word must be something the room talks about (`common albodor norg` is not).
  return words.length > 0 && words.length <= 3 && words.every((w) => new RegExp(`\\b${w}`).test(prose));
}

/** A link the mapper learned by itself on an unlisted, non-compass command. */
export function isLearnedSpecial(cmd: string, link: MapLink, room: Pick<MapRoom, "exits">): boolean {
  if (isGeometricDirection(cmd) || link.kind === "teleport" || link.transit || !link.to) return false;
  if (room.exits.includes(cmd)) return false;
  // Scripted or hand-registered exits (`mud_map_link`, the panel editor) are someone's decision.
  if (link.pre?.length || link.verified || (link.confirmed && link.uses === 0)) return false;
  return true;
}

/** Walked often enough that a single odd arrival does not get to rewrite it. */
export const ESTABLISHED_USES = 5;
