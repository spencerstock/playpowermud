/**
 * Read-only audit of a world graph. Walks rooms, links, planes, and redirects
 * and reports structural breaks plus layout patterns that usually mean the map
 * is wrong. Does not modify the document.
 *
 *   node --import tsx scripts/audit-map.ts [--json] [--strict] [--limit N] [--code name] [graph.json]
 *   yarn cli map audit [same flags]
 *
 * Exit 0 when there are no errors. Exit 1 when there are errors, or when
 * `--strict` and there are warnings. Exit 2 when the file cannot be read.
 */
import { addVec, canonicalExit, DIRECTION_VECTORS, isGeometricDirection, isVertical, reverseDirection, sameExitSet } from "../game/directions.js";
import { cleanseRoomDescription } from "../game/roomDescriptionNoise.js";
import { buildNoiseContext, scrubDescription } from "./descriptionIntegrity.js";
import { roomNpcNames } from "./npcs.js";
import { descKey, normalizeDescription } from "./WorldMap.js";
import type { MapLink, MapPos, MapRoom, WorldGraphDocument } from "./types.js";

export type AuditSeverity = "error" | "warn" | "info";

export type AuditFinding = {
  severity: AuditSeverity;
  code: string;
  message: string;
  rooms: string[];
  exit?: string;
};

export type MapAudit = {
  rooms: number;
  links: number;
  planes: number;
  areas: number;
  components: number;
  largestComponent: number;
  unexploredExits: number;
  briefOnlyRooms: number;
  findings: AuditFinding[];
};

const SEVERITY_ORDER: Record<AuditSeverity, number> = { error: 0, warn: 1, info: 2 };

function posLabel(pos: MapPos | undefined): string {
  if (!pos) return "(no position)";
  const plane = pos.plane || "(no plane)";
  return `${plane}:${pos.x},${pos.y},${pos.z}`;
}

function roomLabel(room: MapRoom): string {
  const title = room.title?.trim();
  return title ? `${room.id} "${title}"` : room.id;
}

function signaturesAgree(a: MapRoom, b: MapRoom): boolean {
  if ((a.title ?? "") !== (b.title ?? "")) return false;
  const ak = a.descKeys ?? [];
  const bk = b.descKeys ?? [];
  if (ak.length && bk.length && !ak.some((k) => bk.includes(k))) return false;
  return sameExitSet(a.exits ?? [], b.exits ?? []);
}

function signatureKey(room: MapRoom): string {
  return `${room.title ?? ""}|${[...(room.exits ?? [])].sort().join(",")}`;
}

function bothEndsDeny(doc: WorldGraphDocument, dest: MapRoom, room: MapRoom, cmd: string): boolean {
  const rev = reverseDirection(cmd);
  if (!rev || dest.dark || !(dest.exits ?? []).length || dest.tags?.includes("dynamic-exits")) return false;
  if (dest.exits.includes(rev)) return false;
  return !Object.entries(dest.links ?? {}).some(
    ([c, l]) => !isGeometricDirection(c) && !!l.to && l.confirmed && resolveId(doc, l.to).id === room.id,
  );
}

/** Follow merge redirects. `broken` is set when the chain does not end on a live room. */
export function resolveId(doc: WorldGraphDocument, id: string): { id?: string; broken: "cycle" | "dangling" | null } {
  let cur = id;
  const seen = new Set<string>();
  for (let i = 0; i < 32; i++) {
    if (doc.rooms[cur]) return { id: cur, broken: null };
    const next = doc.redirects?.[cur];
    if (!next) return { broken: "dangling" };
    if (seen.has(cur)) return { broken: "cycle" };
    seen.add(cur);
    cur = next;
  }
  return { broken: "cycle" };
}

function expectedPos(from: MapRoom, cmd: string): MapPos | null {
  const v = DIRECTION_VECTORS[cmd];
  if (!v || !from.pos) return null;
  const p = addVec(from.pos, v);
  return { plane: from.pos.plane ?? "", x: p.x, y: p.y, z: p.z };
}

function samePos(a: MapPos, b: MapPos): boolean {
  return (a.plane ?? "") === (b.plane ?? "") && a.x === b.x && a.y === b.y && a.z === b.z;
}

function posKey(pos: MapPos): string {
  return `${pos.plane ?? ""}:${pos.x},${pos.y},${pos.z}`;
}

function descriptionIndexed(room: MapRoom): boolean {
  if (!room.description?.trim()) return true;
  const norm = normalizeDescription(room.description);
  if (!norm) return true;
  const keys = room.descKeys ?? [];
  if (!keys.length) return false;
  const key = descKey(room.description);
  return keys.some((stored) => {
    const s = normalizeDescription(stored);
    return stored === key || s === key || norm.endsWith(s);
  });
}

function linkUsable(link: MapLink | undefined): boolean {
  return !!link?.to;
}

export function auditWorldGraph(doc: WorldGraphDocument, opts: { codes?: string[] } = {}): MapAudit {
  const findings: AuditFinding[] = [];
  const add = (f: AuditFinding) => findings.push(f);
  const rooms = Object.entries(doc.rooms);
  const planes = doc.planes ?? {};
  const areas = doc.areas ?? {};

  const unregistered = new Map<string, string[]>();
  let noiseCtx: ReturnType<typeof buildNoiseContext> | undefined;
  let links = 0;
  let unexploredExits = 0;
  let briefOnlyRooms = 0;
  const byPos = new Map<string, MapRoom[]>();
  const maxRoomNum = { n: 0 };
  const maxPlaneNum = { n: 0 };

  const noteNum = (id: string, prefix: string, into: { n: number }) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) into.n = Math.max(into.n, Number(m[1]));
  };

  for (const id of Object.keys(planes)) noteNum(id, "p", maxPlaneNum);
  for (const id of Object.keys(doc.redirects ?? {})) {
    if (doc.rooms[id]) {
      add({
        severity: "warn",
        code: "redirect-shadow",
        message: `${id} is a live room and a merge redirect`,
        rooms: [id],
      });
    }
  }

  const redirectProblems = new Set<string>();
  for (const id of Object.keys(doc.redirects ?? {})) {
    if (doc.rooms[id]) continue;
    const resolved = resolveId(doc, id);
    if (resolved.broken) {
      redirectProblems.add(id);
      add({
        severity: "error",
        code: resolved.broken === "cycle" ? "redirect-cycle" : "redirect-dangling",
        message: `redirect ${id} ${resolved.broken === "cycle" ? "cycles without reaching a room" : "does not resolve to a room"}`,
        rooms: [id],
      });
    }
  }

  for (const [id, room] of rooms) {
    noteNum(id, "r", maxRoomNum);
    if (room.id !== id) {
      add({
        severity: "error",
        code: "room-id",
        message: `room key ${id} has id ${room.id || "(empty)"}`,
        rooms: [id],
      });
    }
    if (!room.pos || typeof room.pos.x !== "number" || typeof room.pos.y !== "number" || typeof room.pos.z !== "number") {
      add({ severity: "error", code: "missing-pos", message: `${roomLabel(room)} has no coordinates`, rooms: [id] });
    } else {
      const key = posKey(room.pos);
      let stack = byPos.get(key);
      if (!stack) byPos.set(key, (stack = []));
      stack.push(room);
      if (!room.pos.plane) {
        add({
          severity: "error",
          code: "missing-plane",
          message: `${roomLabel(room)} has coordinates but no plane`,
          rooms: [id],
        });
      } else {
        noteNum(room.pos.plane, "p", maxPlaneNum);
        if (!planes[room.pos.plane]) {
          let ids = unregistered.get(room.pos.plane);
          if (!ids) unregistered.set(room.pos.plane, (ids = []));
          ids.push(id);
        }
      }
    }
    if (room.area && !areas[room.area]) {
      add({
        severity: "warn",
        code: "unknown-area",
        message: `${roomLabel(room)} area "${room.area}" is not in the area registry`,
        rooms: [id],
      });
    }
    if (room.danger !== undefined && (!Number.isInteger(room.danger) || room.danger < 0 || room.danger > 5)) {
      add({
        severity: "warn",
        code: "danger",
        message: `${roomLabel(room)} danger ${String(room.danger)} is outside 0–5`,
        rooms: [id],
      });
    }
    const exits = room.exits ?? [];
    if (new Set(exits).size !== exits.length) {
      add({
        severity: "warn",
        code: "duplicate-exit",
        message: `${roomLabel(room)} lists a direction more than once`,
        rooms: [id],
      });
    }
    if (room.description) {
      const cleaned = cleanseRoomDescription(room.description);
      if ((cleaned ?? "") !== room.description) {
        add({
          severity: "warn",
          code: "dirty-description",
          message: `${roomLabel(room)} description still contains leaked game lines`,
          rooms: [id],
        });
      } else {
        // Lines no pattern knows, found by shape + map evidence (descriptionIntegrity.ts).
        const leaked = scrubDescription(room.description, (noiseCtx ??= buildNoiseContext(doc)), { roomId: id }).removed;
        if (leaked.length) {
          add({
            severity: "warn",
            code: "leaked-line",
            message: `${roomLabel(room)} description has leaked game output: ${leaked.map((l) => `"${l.text.slice(0, 60)}"`).join(", ")}`,
            rooms: [id],
          });
        }
      }
      if (!descriptionIndexed(room)) {
        add({
          severity: "warn",
          code: "desc-key",
          message: `${roomLabel(room)} description is not covered by its descKeys`,
          rooms: [id],
        });
      }
    }
    const npcFromContents = roomNpcNames(room.contents);
    const storedNpcs = [...(room.npcs ?? [])].sort((a, b) => a.localeCompare(b));
    if (storedNpcs.join("\n") !== npcFromContents.join("\n")) {
      add({
        severity: "warn",
        code: "npc-index",
        message: `${roomLabel(room)} npc list does not match its contents`,
        rooms: [id],
      });
    }
    if (!room.title?.trim() && !room.description?.trim() && !(room.descKeys ?? []).length) {
      const linked =
        Object.values(room.links ?? {}).some((l) => l.to) ||
        rooms.some(([otherId, other]) => otherId !== id && Object.values(other.links ?? {}).some((l) => l.to === id));
      if (!linked) {
        add({
          severity: "warn",
          code: "blank-room",
          message: `${id} is a blank room nothing links to`,
          rooms: [id],
        });
      }
    }
    if (room.title?.trim() && !room.description?.trim() && !(room.descKeys ?? []).length) briefOnlyRooms += 1;

    for (const door of room.doors ?? []) {
      if (!exits.includes(door.direction) && !room.links?.[door.direction]) {
        add({
          severity: "warn",
          code: "orphan-door",
          message: `${roomLabel(room)} has a ${door.state} ${door.name} ${door.direction} with no exit or link`,
          rooms: [id],
          exit: door.direction,
        });
      }
    }

    for (const [cmd, link] of Object.entries(room.links ?? {})) {
      links += 1;
      auditLink(doc, byPos, room, cmd, link, redirectProblems, add);
    }
    for (const exit of exits) {
      const link = room.links?.[exit];
      if (!linkUsable(link)) unexploredExits += 1;
    }
  }

  if (doc.nextRoom <= maxRoomNum.n) {
    add({
      severity: "error",
      code: "id-counter",
      message: `nextRoom is ${doc.nextRoom} but a room id already uses ${maxRoomNum.n}`,
      rooms: [],
    });
  }
  if (doc.nextPlane <= maxPlaneNum.n) {
    add({
      severity: "error",
      code: "id-counter",
      message: `nextPlane is ${doc.nextPlane} but a plane id already uses ${maxPlaneNum.n}`,
      rooms: [],
    });
  }

  for (const [id, plane] of Object.entries(planes)) {
    const occupied = rooms.some(([, room]) => room.pos?.plane === id);
    if (!occupied) {
      add({
        severity: "info",
        code: "empty-plane",
        message: `plane ${id}${plane.label ? ` (${plane.label})` : ""} has no rooms`,
        rooms: [],
      });
    }
    if (plane.kind === "aside" && !plane.parent) {
      add({
        severity: "warn",
        code: "aside-parent",
        message: `aside plane ${id} has no parent link`,
        rooms: [],
      });
    }
    const parent = plane.parent;
    if (!parent) continue;
    if (!planes[parent.plane] && !rooms.some(([, room]) => room.pos?.plane === parent.plane)) {
      add({
        severity: "warn",
        code: "aside-parent",
        message: `plane ${id} says it hangs off missing plane ${parent.plane}`,
        rooms: parent.fromRoom ? [parent.fromRoom] : [],
        exit: parent.via,
      });
    }
    const from = parent.fromRoom ? doc.rooms[resolveId(doc, parent.fromRoom).id ?? ""] : undefined;
    if (!from) {
      add({
        severity: "warn",
        code: "aside-parent",
        message: `plane ${id} parent room ${parent.fromRoom} is missing`,
        rooms: [parent.fromRoom],
        exit: parent.via,
      });
      continue;
    }
    const via = from.links?.[parent.via];
    const dest = via?.to ? doc.rooms[resolveId(doc, via.to).id ?? ""] : undefined;
    if (!via?.to || !dest) {
      add({
        severity: "warn",
        code: "aside-parent",
        message: `plane ${id} parent ${from.id} has no link "${parent.via}"`,
        rooms: [from.id],
        exit: parent.via,
      });
    } else if ((dest.pos?.plane ?? "") !== id) {
      add({
        severity: "warn",
        code: "aside-parent",
        message: `plane ${id} via ${from.id}:${parent.via} lands on ${dest.id} (${posLabel(dest.pos)})`,
        rooms: [from.id, dest.id],
        exit: parent.via,
      });
    }
  }

  for (const [plane, ids] of unregistered) {
    const sample = ids.slice(0, 8).map((id) => roomLabel(doc.rooms[id]!)).join(", ");
    const more = ids.length > 8 ? `, … +${ids.length - 8}` : "";
    const roomWord = ids.length === 1 ? "room sits" : "rooms sit";
    add({
      severity: "warn",
      code: "unregistered-plane",
      message: `${ids.length} ${roomWord} on ${plane}, which is not in the plane list: ${sample}${more}`,
      rooms: ids,
    });
  }

  for (const stack of byPos.values()) {
    if (stack.length < 2) continue;
    const names = stack.map(roomLabel).join(", ");
    add({
      severity: "warn",
      code: "overlap",
      message: `${posLabel(stack[0]!.pos)} holds ${stack.length} rooms: ${names}`,
      rooms: stack.map((r) => r.id),
    });
  }

  auditDuplicates(doc, byPos, add);
  const components = auditComponents(doc, add);

  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s) return s;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const ar = a.rooms[0] ?? "";
    const br = b.rooms[0] ?? "";
    if (ar !== br) return ar < br ? -1 : 1;
    return (a.exit ?? "") < (b.exit ?? "") ? -1 : (a.exit ?? "") > (b.exit ?? "") ? 1 : 0;
  });

  const want = opts.codes?.filter(Boolean);
  const filtered = want?.length ? findings.filter((f) => want.includes(f.code)) : findings;
  const sizes = [...components.values()].map((ids) => ids.length);
  return {
    rooms: rooms.length,
    links,
    planes: Object.keys(planes).length,
    areas: Object.keys(areas).length,
    components: components.size,
    largestComponent: sizes.length ? Math.max(...sizes) : 0,
    unexploredExits,
    briefOnlyRooms,
    findings: filtered,
  };
}

function auditLink(
  doc: WorldGraphDocument,
  byPos: Map<string, MapRoom[]>,
  room: MapRoom,
  cmd: string,
  link: MapLink,
  redirectProblems: Set<string>,
  add: (f: AuditFinding) => void,
): void {
  const canonCmd = canonicalExit(cmd);
  if (canonCmd !== cmd && (isGeometricDirection(canonCmd) || (room.exits ?? []).includes(canonCmd))) {
    add({
      severity: "warn",
      code: "noncanonical-exit",
      message: `${roomLabel(room)} link "${cmd}" should be stored as "${canonCmd}"`,
      rooms: [room.id],
      exit: cmd,
    });
  }
  const geometric = isGeometricDirection(cmd);
  const expectedKind = geometric ? (isVertical(cmd) ? "vertical" : "dir") : null;
  if (expectedKind && link.kind !== expectedKind) {
    add({
      severity: "warn",
      code: "link-kind",
      message: `${roomLabel(room)}:${cmd} is a compass exit stored as ${link.kind}`,
      rooms: [room.id],
      exit: cmd,
    });
  } else if (!geometric && (link.kind === "dir" || link.kind === "vertical")) {
    add({
      severity: "warn",
      code: "link-kind",
      message: `${roomLabel(room)}:${cmd} is stored as ${link.kind} but is not a compass direction`,
      rooms: [room.id],
      exit: cmd,
    });
  }
  if (typeof link.failCount === "number" && link.failCount >= 20) {
    add({
      severity: "warn",
      code: "failing-link",
      message: `${roomLabel(room)}:${cmd} has failed ${link.failCount} times and is still on the map`,
      rooms: [room.id],
      exit: cmd,
    });
  }

  if (!link.to) return;
  const resolved = resolveId(doc, link.to);
  if (!resolved.id) {
    if (!redirectProblems.has(link.to)) {
      add({
        severity: "error",
        code: "dangling-link",
        message: `${roomLabel(room)}:${cmd} → ${link.to} (no such room)`,
        rooms: [room.id],
        exit: cmd,
      });
    }
    return;
  }
  if (resolved.id !== link.to) {
    add({
      severity: "error",
      code: "stale-target",
      message: `${roomLabel(room)}:${cmd} points at merged-away ${link.to} (now ${resolved.id}); pathfinding will not follow it`,
      rooms: [room.id, resolved.id],
      exit: cmd,
    });
  }
  const dest = doc.rooms[resolved.id]!;
  if (dest.id === room.id) {
    add({
      severity: "warn",
      code: "self-link",
      message: `${roomLabel(room)}:${cmd} points at itself`,
      rooms: [room.id],
      exit: cmd,
    });
    return;
  }

  const listed = (room.exits ?? []).includes(cmd);
  const agrees = geometric && !!room.pos && !!dest.pos && samePos(dest.pos, expectedPos(room, cmd)!);
  // A real unlisted door is missing from one exit list; a step neither end lists is a display
  // credited to the wrong command, however well the layout built from it "agrees".
  const paired = agrees && (link.confirmed || backPointsHere(doc, room, cmd, dest.id)) && !bothEndsDeny(doc, dest, room, cmd);
  if (
    !listed &&
    !paired &&
    !room.dark &&
    !room.tags?.includes("dynamic-exits") &&
    link.kind !== "special" &&
    link.kind !== "teleport" &&
    !link.hidden &&
    !link.pre?.length
  ) {
    add({
      severity: "warn",
      code: "unlisted-exit",
      message: `${roomLabel(room)}:${cmd} → ${roomLabel(dest)} is not in the room's exit list`,
      rooms: [room.id, dest.id],
      exit: cmd,
    });
  }

  if (geometric && room.pos && dest.pos) {
    const expected = expectedPos(room, cmd)!;
    if (!samePos(dest.pos, expected)) {
      const occupants = (byPos.get(posKey(expected)) ?? []).filter((r) => r.id !== dest.id && r.id !== room.id);
      const occ = occupants.length ? `; that cell holds ${occupants.map(roomLabel).join(", ")}` : "";
      add({
        severity: "warn",
        code: "geometry",
        message: `${roomLabel(room)}:${cmd} → ${roomLabel(dest)} at ${posLabel(dest.pos)}, expected ${posLabel(expected)}${occ}`,
        rooms: [room.id, dest.id],
        exit: cmd,
      });
    }
  }

  const rev = geometric ? reverseDirection(cmd) : null;
  if (rev && dest.links) {
    const back = dest.links[rev];
    if (back?.to) {
      const backId = resolveId(doc, back.to).id;
      if (backId && backId !== room.id) {
        add({
          severity: "warn",
          code: "reverse-conflict",
          message: `${roomLabel(room)}:${cmd} → ${roomLabel(dest)}, but ${dest.id}:${rev} → ${backId}`,
          rooms: [room.id, dest.id, backId],
          exit: cmd,
        });
      }
    } else if (
      link.confirmed &&
      room.pos &&
      dest.pos &&
      samePos(dest.pos, expectedPos(room, cmd)!) &&
      (dest.exits ?? []).includes(rev) &&
      link.kind !== "teleport"
    ) {
      add({
        severity: "warn",
        code: "one-way",
        message: `${roomLabel(room)}:${cmd} → ${roomLabel(dest)} sits on that step, and ${dest.id} lists ${rev} with no link back`,
        rooms: [room.id, dest.id],
        exit: cmd,
      });
    }
  }

}

function backPointsHere(doc: WorldGraphDocument, room: MapRoom, cmd: string, toId: string): boolean {
  const rev = reverseDirection(cmd);
  if (!rev) return false;
  const back = doc.rooms[toId]?.links?.[rev];
  if (!back?.to) return false;
  return resolveId(doc, back.to).id === room.id;
}

function roomsAt(byPos: Map<string, MapRoom[]>, pos: MapPos): MapRoom[] {
  return byPos.get(posKey(pos)) ?? [];
}

function auditUnstitched(
  doc: WorldGraphDocument,
  byPos: Map<string, MapRoom[]>,
  room: MapRoom,
  add: (f: AuditFinding) => void,
): void {
  if (room.dark || room.tags?.includes("dynamic-exits") || !room.pos) return;
  const origin = room.pos;
  for (const exit of room.exits ?? []) {
    if (!isGeometricDirection(exit) || room.links?.[exit]?.to) continue;
    const expected = expectedPos(room, exit);
    if (!expected) continue;
    const rev = reverseDirection(exit)!;
    const there = roomsAt(byPos, expected).filter((q) => {
      if (q.id === room.id || q.dark || !q.pos) return false;
      const back = q.links?.[rev];
      if (back?.to && resolveId(doc, back.to).id !== room.id) return false;
      if ((q.exits ?? []).includes(rev)) return true;
      if (roomsAt(byPos, origin).length !== 1 || roomsAt(byPos, q.pos).length !== 1) return false;
      if (signaturesAgree(room, q)) return false;
      return true;
    });
    if (there.length !== 1) continue;
    const q = there[0]!;
    add({
      severity: "warn",
      code: "unstitched",
      message: `${roomLabel(room)} lists ${exit} with no link, and ${roomLabel(q)} is already on ${posLabel(expected)}`,
      rooms: [room.id, q.id],
      exit,
    });
  }
}

function auditDuplicates(doc: WorldGraphDocument, byPos: Map<string, MapRoom[]>, add: (f: AuditFinding) => void): void {
  for (const room of Object.values(doc.rooms)) auditUnstitched(doc, byPos, room, add);

  const groups = new Map<string, MapRoom[]>();
  for (const room of Object.values(doc.rooms)) {
    if (room.dark || (!room.title && !(room.descKeys ?? []).length)) continue;
    const sig = signatureKey(room);
    let g = groups.get(sig);
    if (!g) groups.set(sig, (g = []));
    g.push(room);
  }
  const reported = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      for (const [cmd, link] of Object.entries(a.links ?? {})) {
        if (!link.to || !link.confirmed || link.kind === "teleport") continue;
        const to = resolveId(doc, link.to).id;
        if (!to) continue;
        for (let j = i + 1; j < group.length; j++) {
          const b = group[j]!;
          if (!signaturesAgree(a, b)) continue;
          const other = b.links?.[cmd];
          if (!other?.to || !other.confirmed) continue;
          if (resolveId(doc, other.to).id !== to) continue;
          const key = [a.id, b.id].sort().join("|") + `|${cmd}`;
          if (reported.has(key)) continue;
          reported.add(key);
          add({
            severity: "warn",
            code: "likely-duplicate",
            message: `${roomLabel(a)} and ${roomLabel(b)} match and both go ${cmd} to ${to}`,
            rooms: [a.id, b.id, to],
            exit: cmd,
          });
        }
      }
    }
  }

  // Distinctive prose (long, never next to itself like forest or desert squares) on more than
  // one room with the same title and exits: copies made while lost, or real twins.
  const norms = new Map<string, string>();
  for (const r of Object.values(doc.rooms)) if (r.description) norms.set(r.id, normalizeDescription(r.description));
  const selfAdjacent = new Set<string>();
  for (const r of Object.values(doc.rooms)) {
    const mine = norms.get(r.id);
    if (!mine) continue;
    for (const l of Object.values(r.links ?? {})) {
      const to = l.to ? resolveId(doc, l.to).id : undefined;
      if (to && to !== r.id && norms.get(to) === mine) selfAdjacent.add(mine);
    }
  }
  const copies = new Map<string, MapRoom[]>();
  for (const r of Object.values(doc.rooms)) {
    const norm = norms.get(r.id);
    if (!norm || norm.length < 120 || selfAdjacent.has(norm) || r.dark) continue;
    const key = `${signatureKey(r)}|${norm}`;
    copies.set(key, [...(copies.get(key) ?? []), r]);
  }
  for (const group of copies.values()) {
    if (group.length < 2) continue;
    add({
      severity: "warn",
      code: "copied-room",
      message: `${group.length} rooms share distinctive prose and exits: ${group.map((r) => `${roomLabel(r)}@${posLabel(r.pos)}`).join(", ")}`,
      rooms: group.map((r) => r.id),
    });
  }
}

function auditComponents(doc: WorldGraphDocument, add: (f: AuditFinding) => void): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const id of Object.keys(doc.rooms)) parent.set(id, id);
  for (const [id, room] of Object.entries(doc.rooms)) {
    for (const link of Object.values(room.links ?? {})) {
      if (!link.to || link.kind === "teleport") continue;
      const to = resolveId(doc, link.to).id;
      if (!to || !parent.has(to)) continue;
      const a = find(id);
      const b = find(to);
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const r = find(id);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(id);
  }
  let largest = 0;
  let largestRoot = "";
  for (const [root, ids] of groups) {
    if (ids.length > largest) {
      largest = ids.length;
      largestRoot = root;
    }
  }
  const main = new Set(groups.get(largestRoot) ?? []);
  const mainRooms = [...main].map((id) => doc.rooms[id]!).filter(Boolean);
  for (const [root, ids] of groups) {
    if (root === largestRoot) continue;
    const copies = ids.filter((id) => {
      const room = doc.rooms[id];
      if (!room) return false;
      return mainRooms.some((other) => other.id !== room.id && signaturesAgree(other, room));
    });
    if (copies.length) {
      add({
        severity: "warn",
        code: "stranded-copy",
        message:
          copies.length === 1
            ? `${copies[0]} matches a room already on the main map and is not connected to it`
            : `${copies.join(", ")} match rooms already on the main map and are not connected to it`,
        rooms: copies,
      });
    } else if (ids.length <= 8) {
      const sample = ids.slice(0, 8);
      add({
        severity: "info",
        code: "fragment",
        message: `disconnected ${ids.length === 1 ? "room" : `group of ${ids.length}`}: ${sample.join(", ")}`,
        rooms: sample,
      });
    }
  }
  return groups;
}

export function formatMapAudit(audit: MapAudit, limit = 20): string {
  const counts = new Map<string, number>();
  let errors = 0;
  let warnings = 0;
  let notes = 0;
  for (const f of audit.findings) {
    counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
    if (f.severity === "error") errors += 1;
    else if (f.severity === "warn") warnings += 1;
    else notes += 1;
  }
  const lines = [
    `${audit.rooms} rooms, ${audit.links} links, ${audit.planes} planes, ${audit.areas} areas, ${audit.components} components (largest ${audit.largestComponent})`,
    `${audit.unexploredExits} listed exits have no destination, ${audit.briefOnlyRooms} brief-only rooms`,
    `${errors} errors, ${warnings} warnings, ${notes} notes`,
    "",
  ];
  const seen = new Set<string>();
  for (const f of audit.findings) {
    const key = `${f.severity}:${f.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = audit.findings.filter((g) => g.severity === f.severity && g.code === f.code);
    lines.push(`${f.severity} ${f.code} (${group.length})`);
    const shown = group.slice(0, limit);
    for (const g of shown) lines.push(`  ${g.message}`);
    if (group.length > shown.length) lines.push(`  … ${group.length - shown.length} more`);
    lines.push("");
  }
  if (!audit.findings.length) lines.push("No issues found.");
  return lines.join("\n").replace(/\n+$/, "\n");
}

export function parseAuditArgs(argv: string[]): { file?: string; json: boolean; strict: boolean; limit: number; codes: string[] } {
  let file: string | undefined;
  let json = false;
  let strict = false;
  let limit = 20;
  const codes: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") json = true;
    else if (a === "--strict") strict = true;
    else if (a === "--limit") {
      limit = Number(argv[++i]);
      if (!Number.isFinite(limit) || limit < 0) throw new Error("--limit expects a non-negative number");
    } else if (a === "--code") {
      const code = argv[++i];
      if (!code) throw new Error("--code expects a finding name");
      codes.push(code);
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag ${a}. Usage: map audit [graph.json] [--json] [--strict] [--limit N] [--code name]`);
    } else if (!file) file = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  return { file, json, strict, limit, codes };
}

export function auditExitCode(audit: MapAudit, strict = false): number {
  const errors = audit.findings.some((f) => f.severity === "error");
  const warnings = audit.findings.some((f) => f.severity === "warn");
  if (errors) return 1;
  if (strict && warnings) return 1;
  return 0;
}
