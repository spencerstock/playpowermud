import type { MapRoom, WorldGraphDocument } from "./types.js";
import type { WorldMap } from "./WorldMap.js";

/** Area ids for the Threshold ↔ Kalinport surface corridor (towns + route + districts). */
export const THRESHOLD_KALINPORT_CORRIDOR_AREAS = new Set([
  "threshold",
  "kalinport",
  "diamond",
  "kalin",
  "route",
  "kraken-alley",
  "crossroads",
  "northern-warrens",
  "southern-warrens",
]);

/** Kulajo / mine north of Threshold — keep mapped when resetting the corridor. */
const NORTH_OF_THRESHOLD = /kulajo|mine tunnel|mine shaft|hole in the ground|cutland|mountain path|mt\. kulajo|path to mine|kal-thax/i;

function skipNorthExtension(room: MapRoom): boolean {
  if (room.area && THRESHOLD_KALINPORT_CORRIDOR_AREAS.has(room.area)) return false;
  const text = `${room.title ?? ""}\n${room.description ?? ""}`;
  return NORTH_OF_THRESHOLD.test(text);
}

function yBounds(doc: WorldGraphDocument): { yMin: number; yMax: number } {
  let yMin = 0;
  let yMax = 0;
  let haveMin = false;
  let haveMax = false;
  for (const room of Object.values(doc.rooms)) {
    if (!room.area) continue;
    const y = room.pos?.y ?? 0;
    if (room.area === "threshold") {
      yMax = haveMax ? Math.max(yMax, y) : y;
      haveMax = true;
    }
    if (room.area === "kalinport" || room.area === "diamond" || room.area === "kalin") {
      yMin = haveMin ? Math.min(yMin, y) : y;
      haveMin = true;
    }
  }
  if (!haveMax) yMax = 0;
  if (!haveMin) yMin = -154;
  return { yMin, yMax };
}

/** Room ids to drop when resetting the surface corridor Threshold → Kalinport (inclusive). */
export function collectThresholdKalinportResetIds(map: WorldMap): string[] {
  const doc = map.doc;
  const { yMin, yMax } = yBounds(doc);
  const seeds = Object.values(doc.rooms)
    .filter((r) => r.area && THRESHOLD_KALINPORT_CORRIDOR_AREAS.has(r.area))
    .map((r) => r.id);
  const ids = new Set(seeds);
  const q = [...seeds];
  while (q.length) {
    const id = q.shift()!;
    const room = doc.rooms[id];
    if (!room?.pos || room.pos.plane !== "p35") continue;
    for (const link of Object.values(room.links ?? {})) {
      if (!link.to || ids.has(link.to)) continue;
      const next = doc.rooms[link.to];
      if (!next?.pos || next.pos.plane !== "p35") continue;
      const y = next.pos.y ?? 0;
      if (y < yMin || y > yMax) continue;
      if (skipNorthExtension(next)) continue;
      ids.add(link.to);
      q.push(link.to);
    }
  }
  let aq = [...ids];
  while (aq.length) {
    const id = aq.pop()!;
    const room = doc.rooms[id];
    if (!room) continue;
    for (const link of Object.values(room.links ?? {})) {
      if (!link.to || ids.has(link.to)) continue;
      const next = doc.rooms[link.to];
      if (!next?.pos) continue;
      const kind = doc.planes?.[next.pos.plane]?.kind;
      if (kind !== "aside") continue;
      if (!ids.has(id)) continue;
      ids.add(link.to);
      aq.push(link.to);
    }
  }
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function resetThresholdKalinportCorridor(
  map: WorldMap,
  opts: { protect?: Set<string> } = {},
): { removed: number; kept: number; ids: string[] } {
  const protect = opts.protect ?? new Set<string>();
  const ids = collectThresholdKalinportResetIds(map).filter((id) => !protect.has(id));
  for (const id of ids) map.deleteRoom(id);
  map.heal({ protect: [...protect] });
  map.doc.updatedAt = new Date().toISOString();
  return { removed: ids.length, kept: map.roomCount(), ids };
}
