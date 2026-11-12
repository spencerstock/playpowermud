import type { RoomContent, RoomContentKind } from "../game/types.js";
import type { MapRoom, StoredContent } from "./types.js";

const WANDERING_PATH = /_move\b|\/move\//i;
const PROSE_CONTENT =
  /\b(?:path|passage|trail|pass|leading|shop to the|entrance|door leading|hole in|opening is|stairs run|sign on)\b/i;
const CORPSE_NAME = /^(?:corpses? of|skeletal remains|decayed remains|remains of)\b/i;
/** Room objects that parse as contents but are not NPCs/mobs for map search. */
const OBJECT_NOT_NPC =
  /\b(?:guild board|message board|bulletin board|rowboat|pile of coins|coins)\b|^\s*sign\b/i;

/** Role / shopkeeper-style names Powermud often shows without an LPC path. */
const NPC_NAME =
  /\b(?:merchant|bartender|shopkeeper|trainer|loremaster|loreman|banker|innkeeper|clerk|waiter|bouncer|vendor|keeper|pete|priest|sage|guard|slave|worker|patron)\b/i;
/** Shopkeepers when the MUD still tags them under `/mon/`. */
const SHOP_MON_NPC =
  /\b(?:merchant|bartender|shopkeeper|trainer|loremaster|loreman|banker|innkeeper|clerk|waiter|bouncer|vendor|keeper|pete|priest|sage)\b/i;

export function classifyNpcKind(name: string, path: string | undefined, base: RoomContentKind): RoomContentKind {
  if (base === "corpse" || base === "item" || base === "entrance" || base === "player") return base;
  if (path && WANDERING_PATH.test(path)) return "mob";
  if (path && /\/mon\//.test(path)) return SHOP_MON_NPC.test(name) ? "npc" : "mob";
  if (NPC_NAME.test(name)) return "npc";
  if (base === "unknown" && /^[A-Z]/.test(name.trim()) && !PROSE_CONTENT.test(name)) return "npc";
  return base;
}

export function contentCountsAsRoomNpc(c: Pick<StoredContent | RoomContent, "name" | "kind" | "path">): boolean {
  if (c.kind === "corpse" || c.kind === "item" || c.kind === "entrance" || c.kind === "player") return false;
  if (c.path && WANDERING_PATH.test(c.path)) return false;
  if (CORPSE_NAME.test(c.name) || PROSE_CONTENT.test(c.name) || OBJECT_NOT_NPC.test(c.name)) return false;
  return c.kind === "mob" || c.kind === "npc" || c.kind === "unknown";
}

/** NPC/mob names indexed for search — prefers synced `npcs`, falls back to contents. */
export function npcNamesForRoom(room: Pick<MapRoom, "npcs" | "contents">): string[] {
  if (room.npcs?.length) return room.npcs;
  return roomNpcNames(room.contents);
}

const IRREGULAR_PLURALS: [RegExp, string][] = [
  [/men$/i, "man"], // Highwaymen, Lizard men, Women, Fishermen
  [/children$/i, "child"],
  [/people$/i, "person"],
  [/mice$/i, "mouse"],
  [/geese$/i, "goose"],
  [/teeth$/i, "tooth"],
  [/feet$/i, "foot"],
  [/oxen$/i, "ox"],
  [/ieves$/i, "ief"], // thieves
  [/([lr])ves$/i, "$1f"], // wolves, elves, dwarves
  [/ives$/i, "ife"], // knives, wives
];

function singularWord(word: string): string {
  const keepCase = (out: string) =>
    /^[A-Z]+$/.test(word) ? out.toUpperCase() : /^[A-Z]/.test(word) ? out[0]!.toUpperCase() + out.slice(1) : out;
  for (const [re, to] of IRREGULAR_PLURALS) if (re.test(word)) return keepCase(word.replace(re, to));
  if (word.length > 4 && /ies$/i.test(word)) return keepCase(word.slice(0, -3) + "y");
  if (/(?:ss|sh|ch|x|z)es$/i.test(word)) return word.slice(0, -2);
  if (word.length > 2 && /s$/i.test(word) && !/(?:ss|us|is)$/i.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * One of a group the MUD listed as `There are a couple Highwaymen.` → `Highwayman`, so `/to
 * highwayman` finds rooms first seen with two of them. Only the head noun changes: the last word,
 * or the word before ` of `; a `[Children]`-style tag is singular too.
 */
export function singularNpcName(name: string): string {
  const tag = name.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (tag) return `${singularNpcName(tag[1]!)} [${singularWord(tag[2]!)}]`;
  const of = name.match(/^(.*?)(\S+)( of .*)$/i);
  if (of) return `${of[1]}${singularWord(of[2]!)}${of[3]}`;
  const last = name.match(/^(.*?)(\S+)$/);
  return last ? `${last[1]}${singularWord(last[2]!)}` : name;
}

export function roomNpcNames(contents: Record<string, StoredContent> | undefined): string[] {
  const names = new Map<string, string>();
  for (const c of Object.values(contents ?? {})) {
    if (!contentCountsAsRoomNpc(c)) continue;
    const name = (c.lastCount ?? 1) > 1 ? singularNpcName(c.name) : c.name;
    const key = name.toLowerCase();
    if (!names.has(key)) names.set(key, name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export function syncRoomNpcs(room: MapRoom): void {
  const npcs = roomNpcNames(room.contents ?? {});
  if (npcs.length) room.npcs = npcs;
  else delete room.npcs;
}

/** Best NPC name match when every query term appears in that name. */
export function npcMatchFor(room: MapRoom, terms: string[]): string | undefined {
  const names = npcNamesForRoom(room);
  for (const name of names) {
    const low = name.toLowerCase();
    if (terms.every((t) => low.includes(t))) return name;
  }
  return undefined;
}
