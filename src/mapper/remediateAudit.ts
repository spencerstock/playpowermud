import { addVec, DIRECTION_VECTORS, isGeometricDirection } from "../game/directions.js";
import { resolveId } from "./audit.js";
import type { MapPos, WorldGraphDocument } from "./types.js";
import type { WorldMap } from "./WorldMap.js";

export type RemediateReport = {
  redirectsRemoved: number;
  positionsFixed: number;
};

/** Drop merge redirects that never resolve to a live room. */
export function pruneDanglingRedirects(doc: WorldGraphDocument): number {
  const redirects = doc.redirects;
  if (!redirects) return 0;
  let n = 0;
  for (const id of Object.keys(redirects)) {
    const resolved = resolveId(doc, id);
    if (resolved.broken || !resolved.id) {
      delete redirects[id];
      n += 1;
    }
  }
  if (n && Object.keys(redirects).length === 0) delete doc.redirects;
  return n;
}

/**
 * Rooms with coordinates but no plane are re-laid out from a neighbor that has a plane,
 * following confirmed compass links (BFS from that anchor).
 */
export function fixMissingPlaneRooms(map: WorldMap): number {
  const need = map.rooms().filter((r) => r.pos && !r.pos.plane);
  if (!need.length) return 0;
  const needIds = new Set(need.map((r) => r.id));
  let fixed = 0;

  for (const seed of need) {
    if (!needIds.has(seed.id)) continue;
    const anchor = findPlaneAnchor(map, seed.id);
    if (!anchor) continue;

    const layout = new Map<string, MapPos>();
    layout.set(anchor.id, { ...anchor.pos });
    const queue = [anchor.id];
    const seen = new Set([anchor.id]);

    while (queue.length) {
      const id = queue.shift()!;
      const room = map.room(id);
      if (!room?.pos) continue;
      const from = layout.get(id) ?? (room.pos.plane ? room.pos : undefined);
      if (!from?.plane) continue;

      for (const [cmd, link] of Object.entries(room.links)) {
        if (!link.to || !link.confirmed || !isGeometricDirection(cmd)) continue;
        const v = DIRECTION_VECTORS[cmd];
        if (!v) continue;
        const dest = map.room(link.to);
        if (!dest?.pos) continue;
        const expected: MapPos = { plane: from.plane, x: from.x + v.x, y: from.y + v.y, z: from.z + v.z };
        if (!seen.has(dest.id)) {
          seen.add(dest.id);
          queue.push(dest.id);
        }
        if (!dest.pos.plane || needIds.has(dest.id)) layout.set(dest.id, expected);
      }
    }

    for (const id of needIds) {
      if (!layout.has(id)) continue;
      const room = map.room(id);
      const next = layout.get(id)!;
      if (!room) continue;
      const same =
        room.pos.plane === next.plane &&
        room.pos.x === next.x &&
        room.pos.y === next.y &&
        room.pos.z === next.z;
      if (same) {
        needIds.delete(id);
        continue;
      }
      map.setPos(room, next);
      needIds.delete(id);
      fixed += 1;
    }
  }
  return fixed;
}

function findPlaneAnchor(map: WorldMap, roomId: string): ReturnType<WorldMap["room"]> {
  const start = map.room(roomId);
  if (!start) return undefined;
  for (const link of Object.values(start.links)) {
    if (!link.to) continue;
    const other = map.room(link.to);
    if (other?.pos?.plane) return other;
  }
  for (const inc of map.incomingRooms(roomId)) {
    if (inc.pos?.plane) return inc;
  }
  for (const room of map.rooms()) {
    if (room.id === roomId) continue;
    for (const link of Object.values(room.links)) {
      if (link.to === roomId && room.pos?.plane) return room;
    }
  }
  return undefined;
}

export function remediateMapErrors(map: WorldMap): RemediateReport {
  const redirectsRemoved = pruneDanglingRedirects(map.doc);
  const positionsFixed = fixMissingPlaneRooms(map);
  if (redirectsRemoved) map.touch();
  return { redirectsRemoved, positionsFixed };
}
