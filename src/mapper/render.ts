import { DIRECTION_VECTORS, longDirection } from "../game/directions.js";
import { areaDisplayLabel, effectiveAreaId } from "./areaInfer.js";
import { npcNamesForRoom } from "./npcs.js";
import { roomDisplayTitle } from "./roomTitle.js";
import type { MapRoom } from "./types.js";
import type { WorldMap } from "./WorldMap.js";

/**
 * Text map of one plane/level around a room — what an agent "sees" on a minimap.
 * Cells are `[x]` with `@` = you, `o` = room, `#` = dark, `*` = has aside/secret exits;
 * `^`/`v` beside a cell mark up/down exits.
 */
export function renderAscii(
  map: WorldMap,
  centerId: string,
  opts: { radius?: number; z?: number; youId?: string | null } = {},
): string {
  const center = map.room(centerId);
  if (!center) return "(unknown room)";
  const r = opts.radius ?? 5;
  const z = opts.z ?? center.pos.z;
  const plane = center.pos.plane;
  const W = (2 * r + 1) * 4 + 1;
  const H = (2 * r + 1) * 2 + 1;
  const grid: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => " "));
  const put = (row: number, col: number, ch: string) => {
    if (row >= 0 && row < H && col >= 0 && col < W) grid[row]![col] = ch;
  };
  const asides: string[] = [];
  const cellOf = (x: number, y: number) => ({
    col: (x - center.pos.x + r) * 4 + 2,
    row: (center.pos.y - y + r) * 2 + 1,
  });
  const youId = opts.youId === undefined ? centerId : opts.youId;
  for (const room of map.rooms()) {
    if (room.pos.plane !== plane || room.pos.z !== z) continue;
    if (Math.abs(room.pos.x - center.pos.x) > r || Math.abs(room.pos.y - center.pos.y) > r) continue;
    const { col, row } = cellOf(room.pos.x, room.pos.y);
    const hasAside = Object.values(room.links).some((l) => l.kind === "named" || l.kind === "special");
    const mid = room.id === youId ? "@" : room.dark ? "#" : hasAside ? "*" : "o";
    put(row, col - 1, room.links.u?.to || room.exits.includes("u") ? "^" : "[");
    put(row, col, mid);
    put(row, col + 1, room.links.d?.to || room.exits.includes("d") ? "v" : "]");
    for (const [cmd, link] of Object.entries(room.links)) {
      const v = DIRECTION_VECTORS[cmd];
      if (!v || v.z !== 0 || !link.to) continue;
      const ch = cmd === "e" || cmd === "w" ? "-" : cmd === "n" || cmd === "s" ? "|" : cmd === "ne" || cmd === "sw" ? "/" : "\\";
      put(row - v.y, col + v.x * 2, ch);
    }
    if (hasAside) {
      for (const [cmd, link] of Object.entries(room.links)) {
        if (link.kind !== "named" && link.kind !== "special") continue;
        const dest = map.room(link.to);
        asides.push(
          `  * ${label(room)} --${cmd}${link.hidden ? " (secret)" : ""}--> ${dest ? label(dest) : "?"}`,
        );
      }
    }
  }
  const lines = grid.map((row) => row.join("").replace(/\s+$/, "")).filter((l, i, a) => l || (i > 0 && a[i - 1]));
  const header = `plane ${plane} level z=${z} around ${label(center)}  (@ you, o room, # dark, * aside/secret exit, ^ up, v down)`;
  return [header, ...lines, ...(asides.length ? ["aside/secret exits in view:", ...asides] : [])].join("\n");
}

export function label(room: MapRoom): string {
  const name = roomDisplayTitle(room, 50) ?? (room.dark ? "(dark room)" : "(unnamed)");
  return `${name} [${room.id}]`;
}

/** Compact agent-facing room summary. */
export function describeRoom(map: WorldMap, room: MapRoom) {
  const exits = room.exits ?? [];
  const linksRecord = room.links ?? {};
  const links = Object.entries(linksRecord).map(([cmd, l]) => ({
    cmd,
    dir: longDirection(cmd),
    to: l.to,
    toLabel: l.to ? (map.room(l.to) ? label(map.room(l.to)!) : l.to) : null,
    kind: l.kind,
    hidden: l.hidden ?? false,
    confirmed: l.confirmed,
    blocked: l.blocked?.reason,
    pre: l.pre,
    note: l.note,
  }));
  const unexplored = exits.filter((e) => !linksRecord[e]?.to);
  return {
    id: room.id,
    title: room.title ?? null,
    description: room.description ?? null,
    exits,
    doors: room.doors ?? [],
    unexplored,
    links,
    pos: room.pos,
    area: effectiveAreaId(room),
    areaLabel: areaDisplayLabel(map.doc, room),
    dark: room.dark ?? false,
    danger: room.danger ?? null,
    tags: room.tags ?? [],
    notes: room.notes ?? [],
    meta: room.meta ?? {},
    npcs: npcNamesForRoom(room),
    contents: Object.values(room.contents ?? {})
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 30),
    visits: room.visits,
    lastSeenAt: room.lastSeenAt,
  };
}

/** Planes / components / areas overview for agents and MAP docs. */
export function mapOverview(map: WorldMap) {
  const planeCounts = new Map<string, number>();
  const levels = new Map<string, Set<number>>();
  for (const r of map.rooms()) {
    planeCounts.set(r.pos.plane, (planeCounts.get(r.pos.plane) ?? 0) + 1);
    let s = levels.get(r.pos.plane);
    if (!s) levels.set(r.pos.plane, (s = new Set()));
    s.add(r.pos.z);
  }
  const components = map.components();
  return {
    rooms: map.roomCount(),
    components: components.length,
    largestComponent: components[0]?.length ?? 0,
    planes: Object.values(map.doc.planes)
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        label: p.label ?? null,
        rooms: planeCounts.get(p.id) ?? 0,
        levels: [...(levels.get(p.id) ?? [])].sort((a, b) => a - b),
        parent: p.parent ?? null,
      }))
      .filter((p) => p.rooms > 0)
      .sort((a, b) => b.rooms - a.rooms),
    areas: Object.entries(map.doc.areas).map(([id, a]) => ({ id, ...a })),
    updatedAt: map.doc.updatedAt,
  };
}
