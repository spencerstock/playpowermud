import { DIRECTION_VECTORS } from "../game/directions.js";
import type { MapRoom } from "./types.js";
import type { WorldMap } from "./WorldMap.js";

export type ViewPos = { x: number; y: number; z: number };

export type ViewLayout = {
  /** Room id → cell, in the center room's own frame (the center keeps its stored x/y/z). */
  cells: Map<string, ViewPos>;
  /** Rooms laid out beside the room an aside exit (`enter crack`, `out`) leaves, not by compass. */
  aside: Set<string>;
};

type Candidate = { cost: number; seq: number; id: string; pos: ViewPos; from: MapRoom | null; aside: boolean };

const cellKey = (p: ViewPos) => `${p.x},${p.y},${p.z}`;

/** Where an aside room goes relative to the room it hangs off: sideways first, then diagonals. */
const ASIDE_SLOTS = ["e", "w", "s", "n", "se", "sw", "ne", "nw"];

const COST = { walked: 1, inferred: 1.6, aside: 2.2, incoming: 2.6 } as const;

/**
 * Lay out the rooms around `centerId` **from the links**, not from stored coordinates.
 *
 * Stored coordinates are one global guess per plane; a MUD is not a grid, so over thousands of
 * rooms they end up with different rooms stacked on one cell, neighbors drawn far apart, and
 * every secret exit starting a separate "aside" plane with one or two rooms on it. This walks
 * outward from the center, cheapest evidence first (walked compass links, then inferred ones,
 * then named/secret exits, then one-way links into a placed room), and gives each room the cell
 * its link asks for. A cell holds one room: whoever reaches it by the better evidence keeps it,
 * and a link that cannot be honoured is simply left for the renderer to draw as a stub. Rooms
 * behind aside exits are placed on a free cell next to their door, on the same level, so a
 * chimney of `climb up` hops reads as one connected run instead of a dozen one-room maps.
 *
 * Wherever the stored layout was consistent the result is identical to it.
 */
export function layoutAround(
  map: WorldMap,
  centerId: string,
  opts: { radius?: number; zMin?: number; zMax?: number; maxRooms?: number } = {},
): ViewLayout {
  const cells = new Map<string, ViewPos>();
  const aside = new Set<string>();
  const center = map.room(centerId);
  if (!center) return { cells, aside };
  const radius = opts.radius ?? 6;
  const zMin = opts.zMin ?? center.pos.z - 1;
  const zMax = opts.zMax ?? center.pos.z + 1;
  const maxRooms = opts.maxRooms ?? 1500;
  const origin: ViewPos = { x: center.pos.x, y: center.pos.y, z: center.pos.z };
  const inBounds = (p: ViewPos) =>
    Math.abs(p.x - origin.x) <= radius && Math.abs(p.y - origin.y) <= radius && p.z >= zMin && p.z <= zMax;

  const taken = new Map<string, string>();
  const heap: Candidate[] = [];
  let seq = 0;
  const push = (c: Omit<Candidate, "seq">) => {
    heap.push({ ...c, seq: seq++ });
  };
  const pop = (): Candidate | undefined => {
    let best = -1;
    for (let i = 0; i < heap.length; i++) {
      const c = heap[i]!;
      const b = heap[best];
      if (!b || c.cost < b.cost || (c.cost === b.cost && c.seq < b.seq)) best = i;
    }
    return best < 0 ? undefined : heap.splice(best, 1)[0];
  };

  /** A free cell beside `p` for a room reached by a command with no direction. */
  const asideCell = (from: MapRoom, p: ViewPos, dest: MapRoom): ViewPos | undefined => {
    const busy = new Set([...from.exits, ...Object.keys(from.links)]);
    // Where the stored layout already put it right next door, keep that: it is stable.
    if (dest.pos.plane === from.pos.plane && dest.pos.z === from.pos.z) {
      const dx = dest.pos.x - from.pos.x;
      const dy = dest.pos.y - from.pos.y;
      if ((dx || dy) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        const q = { x: p.x + dx, y: p.y + dy, z: p.z };
        if (!taken.has(cellKey(q))) return q;
      }
    }
    // Sides the room has no exit on come first, so the aside does not sit on a real corridor.
    const slots = [...ASIDE_SLOTS.filter((d) => !busy.has(d)), ...ASIDE_SLOTS.filter((d) => busy.has(d))];
    for (const reach of [1, 2]) {
      for (const d of slots) {
        const v = DIRECTION_VECTORS[d]!;
        const q = { x: p.x + v.x * reach, y: p.y + v.y * reach, z: p.z };
        if (!taken.has(cellKey(q))) return q;
      }
    }
    return undefined;
  };

  const expand = (room: MapRoom, p: ViewPos, cost: number) => {
    for (const [cmd, link] of Object.entries(room.links)) {
      if (!link.to || link.kind === "teleport" || link.transit) continue;
      const dest = map.room(link.to);
      if (!dest || dest.id === room.id || cells.has(dest.id)) continue;
      const v = DIRECTION_VECTORS[cmd];
      if (v) {
        push({
          cost: cost + (link.confirmed ? COST.walked : COST.inferred),
          id: dest.id,
          pos: { x: p.x + v.x, y: p.y + v.y, z: p.z + v.z },
          from: null,
          aside: false,
        });
      } else {
        push({ cost: cost + COST.aside, id: dest.id, pos: p, from: room, aside: true });
      }
    }
    // One-way compass links into this room: the other end sits where the link came from.
    for (const src of map.incomingRooms(room.id)) {
      if (cells.has(src.id)) continue;
      for (const [cmd, link] of Object.entries(src.links)) {
        const v = DIRECTION_VECTORS[cmd];
        if (!v || !link.to || link.kind === "teleport" || map.canonicalId(link.to) !== room.id) continue;
        push({
          cost: cost + COST.incoming + (link.confirmed ? 0 : 0.6),
          id: src.id,
          pos: { x: p.x - v.x, y: p.y - v.y, z: p.z - v.z },
          from: null,
          aside: false,
        });
      }
    }
  };

  push({ cost: 0, id: center.id, pos: origin, from: null, aside: false });
  for (let c = pop(); c && cells.size < maxRooms; c = pop()) {
    if (cells.has(c.id)) continue;
    const room = map.room(c.id);
    if (!room || room.tags.includes("vessel")) continue;
    let p: ViewPos | undefined = c.pos;
    if (c.aside && c.from) p = asideCell(c.from, c.pos, room);
    if (!p || !inBounds(p) || taken.has(cellKey(p))) continue;
    cells.set(room.id, p);
    taken.set(cellKey(p), room.id);
    if (c.aside) aside.add(room.id);
    expand(room, p, c.cost);
  }
  return { cells, aside };
}
