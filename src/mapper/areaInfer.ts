import type { MapRoom, WorldGraphDocument } from "./types.js";
import { cleanName, OVERWORLD_AREA, slugId } from "./areaText.js";
import { roomDisplayTitle } from "./roomTitle.js";
import type { WorldMap } from "./WorldMap.js";

export { OVERWORLD_AREA } from "./areaText.js";

export type AreaHint = {
  label: string;
  id: string;
  /** Higher wins when multiple hints apply to one room. */
  confidence: number;
};

const GENERIC_AREA =
  /\b(?:this|the|that|an?)\s+area\b|\bfrom\s+the\s+area\b|\baround\s+this\s+area\b|\bin\s+this\s+area\b/i;
/** Up to four title-case words (Nal Shaddar, Rothe Island, Melee-Magthere). */
const PLACE = "([A-Z][a-z]+(?:['\\-][A-Za-z]+)?(?:\\s+[A-Z][a-z]+(?:['\\-][A-Za-z]+)?){0,3})";

/** Slug to show in search meta when it differs from the human label (custom area ids). */
export function areaMetaSlug(areaId: string, areaLabel: string): string | null {
  if (!areaId || areaId === OVERWORLD_AREA || areaLabel === "Overworld") return null;
  if (slugId(areaLabel) === areaId) return null;
  return areaId;
}

function pushHint(hints: AreaHint[], label: string, confidence: number): void {
  const cleaned = cleanName(label);
  if (!cleaned || cleaned.length < 3) return;
  const id = slugId(cleaned);
  if (id === OVERWORLD_AREA) return;
  const prev = hints.find((h) => h.id === id);
  if (prev) prev.confidence = Math.max(prev.confidence, confidence);
  else hints.push({ label: cleaned, id, confidence });
}

/** Pull settlement / region names from room title and description (Powermud-style prose). */
export function parseAreaHints(text: string): AreaHint[] {
  const hints: AreaHint[] = [];
  const t = text.replace(/\s+/g, " ");
  if (!t.trim()) return hints;

  const place = PLACE;
  const rules: { re: RegExp; confidence: number; pick: (m: RegExpMatchArray) => string }[] = [
    {
      re: new RegExp(`\\b(?:drow|duergar|human|elven|dwarven)\\s+city\\s+of\\s+${place}(?=[\\s,.]|$)`, "g"),
      confidence: 10,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b(?:city|town|village)\\s+of\\s+${place}(?=[\\s,.]|$)`, "g"),
      confidence: 10,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b(?:section|part|portion|district|warrens?)\\s+of\\s+(?:the\\s+)?${place}(?=[\\s,.]|$)`, "g"),
      confidence: 9,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\bthis\\s+area\\s+of\\s+${place}(?=[\\s,.]|$)`, "g"),
      confidence: 9,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b[Mm]erchant\\s+[Aa]rea\\s+of\\s+${place}(?=[\\s,.]|$)`, "g"),
      confidence: 9,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b${place}\\s+[Mm]erchant\\s+[Aa]rea\\b`, "g"),
      confidence: 8,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b(?:center|heart|middle)\\s+of\\s+${place}(?=[\\s,.]|$)`, "g"),
      confidence: 8,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b(?:parts?|portion|crowded part)\\s+of\\s+${place}(?=[\\s,.]|$)`, "g"),
      confidence: 8,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b${place},\\s+the\\s+Duergar\\s+city\\b`, "g"),
      confidence: 10,
      pick: (m) => m[1]!,
    },
    {
      re: new RegExp(`\\b${place}\\s+is\\s+quite\\s+large\\b`, "g"),
      confidence: 7,
      pick: (m) => m[1]!,
    },
    { re: /\bRothe\s+Island\b/g, confidence: 8, pick: () => "Rothe Island" },
    { re: /\bthe\s+Island\b/g, confidence: 5, pick: () => "Rothe Island" },
    { re: /\b[Ff]aerny\s+[Cc]ity\b/g, confidence: 9, pick: () => "Faerny" },
    { re: /\bMelee-?Magthere\b/g, confidence: 6, pick: () => "Melee-Magthere" },
    {
      re: /\b(?:the\s+)?(Northern|Southern)\s+Warrens?\b/g,
      confidence: 9,
      pick: (m) => `${m[1]} Warrens`,
    },
    {
      re: new RegExp(`\\b(?:district|warrens?) (?:you are in is )?called the ${place}\\b`, "gi"),
      confidence: 9,
      pick: (m) => m[1]!,
    },
    {
      re: /\bYou are in the treacherous UnderDark\b/g,
      confidence: 10,
      pick: () => "Underdark",
    },
    {
      re: /\bYou are in the UnderDark\b/g,
      confidence: 10,
      pick: () => "Underdark",
    },
    {
      re: /\b(?:maze of tunnels called the|warrens of the|denizens of the)\s+UnderDark\b/gi,
      confidence: 9,
      pick: () => "Underdark",
    },
    {
      re: /\bUnderDark(?! Jewel)\b/g,
      confidence: 7,
      pick: () => "Underdark",
    },
  ];

  for (const { re, confidence, pick } of rules) {
    for (const m of t.matchAll(re)) {
      const name = pick(m);
      if (GENERIC_AREA.test(name)) continue;
      pushHint(hints, name, confidence);
    }
  }

  return hints.sort((a, b) => b.confidence - a.confidence);
}

export function bestHintForRoom(room: MapRoom): AreaHint | null {
  const chunks = [room.title ?? "", room.description ?? ""].filter(Boolean);
  const all: AreaHint[] = [];
  for (const c of chunks) for (const h of parseAreaHints(c)) pushHint(all, h.label, h.confidence);
  return all[0] ?? null;
}

export function areaManual(room: MapRoom): boolean {
  return room.meta.areaManual === true;
}

export function effectiveAreaId(room: MapRoom): string {
  return room.area ?? OVERWORLD_AREA;
}

export function areaDisplayLabel(doc: WorldGraphDocument, room: MapRoom): string {
  const id = effectiveAreaId(room);
  if (id === OVERWORLD_AREA) return "Overworld";
  return doc.areas[id]?.label ?? titleFromSlug(id);
}

function titleFromSlug(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Title line for search UI: `Market - Nal Shaddar`. */
export function roomSearchTitle(doc: WorldGraphDocument, room: MapRoom): string {
  const name =
    roomDisplayTitle(room) ||
    (room.dark ? "(dark room)" : "(unnamed)");
  const area = areaDisplayLabel(doc, room);
  return `${name} - ${area}`;
}

/** Outdoor / connector rooms stay overworld unless they have their own area hint. */
function looksLikeWilderness(room: MapRoom): boolean {
  const text = `${room.title ?? ""} ${room.description ?? ""}`;
  if (parseAreaHints(text).length) return false;
  if (/\b(?:faerny|dunkrist|nal shaddar|rothe island)\b/i.test(text)) return false;
  return /\b(?:tunnel|tunnels|wilderness|shore|shoreline|underdark|cavern|cave|passage|trail|path|road)\b/i.test(text);
}

/** Underdark tunnels connect through generic "tunnel" prose; still stop at other settlements. */
function blocksAreaFlood(room: MapRoom, hint: AreaHint): boolean {
  if (hint.id !== "underdark") return looksLikeWilderness(room);
  const text = `${room.title ?? ""} ${room.description ?? ""}`;
  const local = parseAreaHints(text);
  if (local.some((h) => h.id !== "underdark" && h.confidence >= 9)) return true;
  if (
    /\b(?:faerny|rothe island)\b/i.test(text) ||
    (/\b(?:dunkrist|nal shaddar|granei)\b/i.test(text) && !/\bunderdark\b/i.test(text))
  ) {
    return true;
  }
  return false;
}

function neighbors(map: WorldMap, roomId: string): string[] {
  const room = map.room(roomId);
  if (!room) return [];
  const ids = new Set<string>();
  for (const link of Object.values(room.links)) {
    if (link.to && link.kind !== "teleport") ids.add(link.to);
  }
  for (const r of map.incomingRooms(roomId)) ids.add(r.id);
  return [...ids];
}

function syncAreaRegistry(doc: WorldGraphDocument, id: string, label: string): void {
  if (id === OVERWORLD_AREA) return;
  const prev = doc.areas[id];
  if (!prev) doc.areas[id] = { label, notes: [], meta: { inferred: true } };
  else if (!prev.meta.manual) prev.label = label;
}

/**
 * Parse descriptions for area seeds, flood-fill along map links, default unlabeled rooms to overworld.
 * Skips rooms with `meta.areaManual`. Returns how many rooms got an area assignment or change.
 */
export function propagateAreas(map: WorldMap): number {
  const doc = map.doc;
  const seeds = new Map<string, AreaHint>();
  for (const room of map.rooms()) {
    if (areaManual(room)) continue;
    const hint = bestHintForRoom(room);
    if (hint) seeds.set(room.id, hint);
  }

  const assigned = new Map<string, AreaHint>();
  for (const [id, hint] of seeds) assigned.set(id, hint);

  // Flood from seeds; stop at rooms that belong to a different seeded settlement.
  const queue = [...seeds.entries()].sort((a, b) => b[1].confidence - a[1].confidence);
  while (queue.length) {
    const [id, hint] = queue.shift()!;
    for (const nid of neighbors(map, id)) {
      const room = map.room(nid);
      if (!room || areaManual(room)) continue;
      const foreign = seeds.get(nid);
      if (foreign && foreign.id !== hint.id) continue;
      if (assigned.has(nid)) continue;
      if (blocksAreaFlood(room, hint)) continue;
      assigned.set(nid, hint);
      queue.push([nid, hint]);
    }
  }

  // Components with no seed: overworld. Connected components that only inherited stay labeled.
  let changes = 0;
  for (const room of map.rooms()) {
    if (areaManual(room)) continue;
    const hint = assigned.get(room.id);
    const next = hint?.id ?? OVERWORLD_AREA;
    const prev = room.area ?? OVERWORLD_AREA;
    if (next === prev && (next === OVERWORLD_AREA || doc.areas[next]?.label)) continue;
    if (next === OVERWORLD_AREA) {
      if (room.area !== undefined) {
        delete room.area;
        changes += 1;
      }
    } else {
      syncAreaRegistry(doc, next, hint!.label);
      if (room.area !== next) {
        room.area = next;
        changes += 1;
      }
    }
  }
  if (changes) map.touch();
  return changes;
}
