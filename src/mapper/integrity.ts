/**
 * Whole-map data integrity report (and optional repair) for a world graph.
 *
 * Three questions, each answered from the map alone:
 *
 * 1. **Contaminated descriptions** — game output glued onto room prose
 *    (see `descriptionIntegrity.ts`). Also descriptions that are not rooms at all (character
 *    creation, a pager screen).
 * 2. **Duplicate rooms** — two records of one place. Compared on *scrubbed* prose, so copies
 *    that only differ by a leaked line are found too. Proof comes from the graph: same cell,
 *    the same exit leading to the same room, or a neighbour whose way back points at the other
 *    copy.
 * 3. **Disconnected rooms** — undirected islands (never linked to the main map), and, inside
 *    the main map, rooms you cannot walk to from the anchor (`unreachable`) or cannot walk back
 *    from (`trap`). Each cluster lists the boundary links, and when the room on the far side
 *    lists the way back without a link, the missing reverse link is offered as a fix.
 *
 *   node --import tsx scripts/map-integrity.ts [graph.json] [--json] [--fix] [--out file]
 */
import { isGeometricDirection, reverseDirection, sameExitSet } from "../game/directions.js";
import {
  buildNoiseContext,
  type NoiseConfidence,
  nonRoomMarkers,
  type RemovedBlock,
  scrubDescription,
} from "./descriptionIntegrity.js";
import { linkNeverPathed } from "./pathPolicy.js";
import type { MapLink, MapRoom, WorldGraphDocument } from "./types.js";
import type { WorldMap } from "./WorldMap.js";

export type ContaminatedRoom = {
  room: string;
  removed: RemovedBlock[];
  confidence: NoiseConfidence;
  before: string;
  after: string;
};

/**
 * - `same-cell`: both sit on one grid cell.
 * - `shared-exit`: the same compass exit of both leads to one room.
 * - `reverse-points`: one copy's exit leads to a room whose way back leads to the other copy.
 * - `parallel-chain`: the same exit of both leads to two rooms that are themselves copies (a
 *   corridor mapped twice while the mapper was lost).
 * - `stranded`: one copy is on the main map, the other on an island.
 * - `split-by-noise`: the raw descriptions differ only by leaked lines.
 */
export type DuplicateEvidence = "same-cell" | "shared-exit" | "reverse-points" | "parallel-chain" | "stranded" | "split-by-noise";

export type DuplicateGroup = {
  rooms: string[];
  /** Survivor when merged: on the main map, best wired, most visited, oldest id. */
  keep: string;
  evidence: DuplicateEvidence[];
  confidence: "certain" | "likely" | "twin";
  sample: string;
};

/**
 * Why a boundary link has no way back:
 * - `stitchable`: the far room lists the reverse exit but has no link for it (add it).
 * - `conflict`: the far room's reverse exit leads to a different room (`other`): one of the two
 *   links was recorded from the wrong room, or `other` and the near room are copies.
 * - `not-listed`: the far room does not list the reverse exit (one-way, or a misattributed link).
 * - `named`: a non-compass exit (`climb`, `enter fissure`); its way back is another command.
 */
export type BoundaryWhy = "stitchable" | "conflict" | "not-listed" | "named";

export type BoundaryLink = {
  from: string;
  cmd: string;
  to: string;
  why: BoundaryWhy;
  /** For `conflict`: where the far room's reverse exit leads instead. */
  other?: string;
  /** The reverse link that would join the cluster, when the far room lists that exit. */
  stitch?: { from: string; cmd: string; to: string };
};

export type ReachCluster = { rooms: string[]; boundary: BoundaryLink[]; sample: string };

export type IslandComponent = {
  rooms: string[];
  kind: "stranded-copy" | "island";
  /** For stranded copies: island room → matching main-map room(s). */
  matches: Record<string, string[]>;
  sample: string;
};

export type IntegrityReport = {
  rooms: number;
  anchor: string;
  contaminated: ContaminatedRoom[];
  nonRoom: { room: string; markers: string[]; component: number }[];
  /** Whole description starts mid-sentence (a cut-off capture): the room was never seen whole. */
  truncated: string[];
  duplicates: DuplicateGroup[];
  /** Same prose in many adjacent rooms (forest, desert): text cannot tell them apart. */
  uniformProse: { sample: string; rooms: number; stackedCells: number }[];
  islands: IslandComponent[];
  unreachable: ReachCluster[];
  traps: ReachCluster[];
};

export type IntegrityOptions = {
  /** Room id to measure reachability from (default: the most visited room on the main map). */
  anchor?: string;
  /** Player names whose actions leak into displays (`Elira concentrates intensely…`). */
  players?: Iterable<string>;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\(\s*(?:opened|closed|locked)\s*\)/g, " ").replace(/\s+/g, " ").trim();
}

function resolve(doc: WorldGraphDocument, id: string | null | undefined): string | undefined {
  let cur = id ?? undefined;
  for (let i = 0; cur && i < 32; i++) {
    if (doc.rooms[cur]) return cur;
    cur = doc.redirects?.[cur];
  }
  return undefined;
}

/**
 * A link a walker can use: has a live destination, is not a bare teleport (recall/portal) or a
 * never-path command. Rides (`transit`) count. `blocked` is ignored: blocks expire after
 * `BLOCK_TTL_MS` (10 minutes), so in a saved file they are history, not state.
 */
function walkable(roomId: string, cmd: string, link: MapLink): boolean {
  if (!link.to) return false;
  if (linkNeverPathed(roomId, cmd)) return false;
  return link.kind !== "teleport" || !!link.transit;
}

function snippet(room: MapRoom | undefined, text?: string): string {
  const t = (text ?? room?.description ?? room?.title ?? "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

function confirmedLinks(room: MapRoom): number {
  return Object.values(room.links).filter((l) => l.confirmed && l.to).length;
}

function roomNum(id: string): number {
  const m = /^r(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function analyzeIntegrity(doc: WorldGraphDocument, opts: IntegrityOptions = {}): IntegrityReport {
  const rooms = Object.values(doc.rooms);
  const ctx = buildNoiseContext(doc, { players: opts.players });

  // 1. Contamination: the scrubbed text is what the rest of the analysis compares.
  const clean = new Map<string, string>();
  const contaminated: ContaminatedRoom[] = [];
  const nonRoomIds: { room: string; markers: string[] }[] = [];
  const truncated: string[] = [];
  for (const room of rooms) {
    if (!room.description) continue;
    const markers = nonRoomMarkers(room.description);
    if (markers.length) nonRoomIds.push({ room: room.id, markers });
    const res = scrubDescription(room.description, ctx, { roomId: room.id });
    clean.set(room.id, res.text);
    if (/^[a-z]/.test(res.text.trim())) truncated.push(room.id);
    if (res.removed.length) {
      contaminated.push({
        room: room.id,
        removed: res.removed,
        confidence: res.removed.every((r) => r.confidence === "certain") ? "certain" : "likely",
        before: room.description,
        after: res.text,
      });
    }
  }

  // Adjacency over walkable links (redirects followed).
  const out = new Map<string, { cmd: string; to: string; link: MapLink }[]>();
  const inc = new Map<string, { cmd: string; from: string }[]>();
  for (const room of rooms) {
    const list: { cmd: string; to: string; link: MapLink }[] = [];
    for (const [cmd, link] of Object.entries(room.links ?? {})) {
      if (!walkable(room.id, cmd, link)) continue;
      const to = resolve(doc, link.to);
      if (!to || to === room.id) continue;
      list.push({ cmd, to, link });
      let back = inc.get(to);
      if (!back) inc.set(to, (back = []));
      back.push({ cmd, from: room.id });
    }
    out.set(room.id, list);
  }

  // Undirected components.
  const comp = new Map<string, number>();
  const components: string[][] = [];
  for (const room of rooms) {
    if (comp.has(room.id)) continue;
    const idx = components.length;
    const members: string[] = [];
    const stack = [room.id];
    comp.set(room.id, idx);
    while (stack.length) {
      const id = stack.pop()!;
      members.push(id);
      const next = [...(out.get(id) ?? []).map((e) => e.to), ...(inc.get(id) ?? []).map((e) => e.from)];
      for (const n of next) {
        if (comp.has(n)) continue;
        comp.set(n, idx);
        stack.push(n);
      }
    }
    components.push(members);
  }
  const mainIdx = components.reduce((best, c, i) => (c.length > components[best]!.length ? i : best), 0);
  const onMain = (id: string) => comp.get(id) === mainIdx;

  // 2. Duplicates on scrubbed prose + exits.
  const proseOf = (id: string) => norm(clean.get(id) ?? "");
  const selfAdjacent = new Set<string>();
  for (const room of rooms) {
    const p = proseOf(room.id);
    if (!p) continue;
    for (const e of out.get(room.id) ?? []) if (proseOf(e.to) === p) selfAdjacent.add(p);
  }
  const proseCount = new Map<string, number>();
  for (const room of rooms) {
    const p = proseOf(room.id);
    if (p) proseCount.set(p, (proseCount.get(p) ?? 0) + 1);
  }
  const groups = new Map<string, MapRoom[]>();
  for (const room of rooms) {
    const p = proseOf(room.id);
    if (p.length < 60 || room.dark) continue;
    const key = `${p}|${[...room.exits].sort().join(",")}`;
    groups.set(key, [...(groups.get(key) ?? []), room]);
  }
  const duplicates: DuplicateGroup[] = [];
  const uniform = new Map<string, { sample: string; rooms: number; cells: Map<string, number> }>();
  for (const room of rooms) {
    const p = proseOf(room.id);
    if (!selfAdjacent.has(p)) continue;
    let u = uniform.get(p);
    if (!u) uniform.set(p, (u = { sample: snippet(room, clean.get(room.id)), rooms: 0, cells: new Map() }));
    u.rooms += 1;
    const cell = `${room.pos.plane}:${room.pos.x},${room.pos.y},${room.pos.z}`;
    u.cells.set(cell, (u.cells.get(cell) ?? 0) + 1);
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const prose = key.slice(0, key.lastIndexOf("|"));
    const tile = selfAdjacent.has(prose);
    // Prose on 3+ rooms repeats along a road or maze (Dulaj Road cycles five texts): exits and
    // neighbours line up by period, so only the same cell proves a copy there.
    const repeating = tile || (proseCount.get(prose) ?? 0) >= 3;
    // Union pairs that the graph proves are one place.
    const parent = new Map(group.map((r) => [r.id, r.id]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    const evidence = new Map<string, Set<DuplicateEvidence>>();
    const note = (a: string, b: string, ev: DuplicateEvidence) => {
      parent.set(find(a), find(b));
      for (const id of [a, b]) {
        let s = evidence.get(id);
        if (!s) evidence.set(id, (s = new Set()));
        s.add(ev);
      }
    };
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const ap = a.pos;
        const bp = b.pos;
        if (ap.plane === bp.plane && ap.x === bp.x && ap.y === bp.y && ap.z === bp.z) note(a.id, b.id, "same-cell");
        for (const [cmd, la] of Object.entries(a.links)) {
          if (!isGeometricDirection(cmd) || !la.confirmed) continue;
          const lb = b.links[cmd];
          const ta = resolve(doc, la.to);
          if (lb?.confirmed && ta && ta === resolve(doc, lb.to)) note(a.id, b.id, "shared-exit");
          // a goes cmd to T, and T's way back leads to b.
          const rev = reverseDirection(cmd);
          const t = ta ? doc.rooms[ta] : undefined;
          if (rev && t?.links[rev]?.confirmed && resolve(doc, t.links[rev]!.to) === b.id) note(a.id, b.id, "reverse-points");
        }
        for (const [cmd, lb] of Object.entries(b.links)) {
          if (!isGeometricDirection(cmd) || !lb.confirmed) continue;
          const rev = reverseDirection(cmd);
          const tb = resolve(doc, lb.to);
          const t = tb ? doc.rooms[tb] : undefined;
          if (rev && t?.links[rev]?.confirmed && resolve(doc, t.links[rev]!.to) === a.id) note(a.id, b.id, "reverse-points");
        }
        if (!tile && onMain(a.id) !== onMain(b.id)) note(a.id, b.id, "stranded");
        if (!tile) {
          for (const [cmd, la] of Object.entries(a.links)) {
            if (!isGeometricDirection(cmd)) continue;
            const na = resolve(doc, la.to);
            const nb = resolve(doc, b.links[cmd]?.to);
            if (!na || !nb || na === nb || na === b.id || nb === a.id) continue;
            const pa = proseOf(na);
            if (pa.length >= 60 && pa === proseOf(nb) && !selfAdjacent.has(pa)) note(a.id, b.id, "parallel-chain");
          }
        }
      }
    }
    const sets = new Map<string, string[]>();
    for (const r of group) sets.set(find(r.id), [...(sets.get(find(r.id)) ?? []), r.id]);
    const emit = (ids: string[], evs: DuplicateEvidence[], isTile: boolean) => {
      const rs = ids.map((id) => doc.rooms[id]!);
      const rank = (r: MapRoom) => [onMain(r.id) ? 1 : 0, confirmedLinks(r), r.visits, -roomNum(r.id)];
      const keep = [...rs].sort((x, y) => {
        const a = rank(x);
        const b = rank(y);
        for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return b[k]! - a[k]!;
        return 0;
      })[0]!;
      const raws = new Set(rs.map((r) => norm(r.description ?? "")));
      const all = new Set(evs);
      if (raws.size > 1) all.add("split-by-noise");
      const linked = all.has("shared-exit") || all.has("reverse-points");
      // Uniform tiles (desert, forest mazes) and repeating prose may really funnel several rooms
      // into one, so a shared exit alone proves nothing there: it must also be the same cell.
      const strong = isTile ? linked && all.has("same-cell") : linked || all.has("same-cell");
      duplicates.push({
        rooms: ids,
        keep: keep.id,
        evidence: [...all],
        confidence: strong
          ? "certain"
          : linked || all.has("stranded") || all.has("same-cell") || all.has("parallel-chain")
            ? "likely"
            : "twin",
        sample: snippet(keep, clean.get(keep.id)),
      });
    };
    const loose: string[] = [];
    for (const ids of sets.values()) {
      if (ids.length >= 2) emit(ids, [...new Set(ids.flatMap((id) => [...(evidence.get(id) ?? [])]))], repeating);
      else loose.push(ids[0]!);
    }
    // Identical distinctive prose and exits with no graph proof: real twins or unproven copies.
    if (!tile && loose.length >= 2) emit(loose, [], repeating);
  }

  const sampleOf = (id: string) => snippet(doc.rooms[id], clean.get(id));

  // 3a. Islands.
  const mainSigs = new Map<string, string[]>();
  for (const id of components[mainIdx] ?? []) {
    const p = proseOf(id);
    if (p.length < 60 || selfAdjacent.has(p)) continue;
    mainSigs.set(p, [...(mainSigs.get(p) ?? []), id]);
  }
  const islands: IslandComponent[] = [];
  components.forEach((ids, idx) => {
    if (idx === mainIdx) return;
    const matches: Record<string, string[]> = {};
    for (const id of ids) {
      const m = mainSigs.get(proseOf(id));
      if (m?.length) matches[id] = m;
    }
    const described = ids.filter((id) => proseOf(id).length >= 60).length;
    const kind = described > 0 && Object.keys(matches).length * 2 >= described ? "stranded-copy" : "island";
    const sorted = [...ids].sort((a, b) => roomNum(a) - roomNum(b));
    islands.push({ rooms: sorted, kind, matches, sample: sampleOf(sorted[0]!) });
  });
  islands.sort((a, b) => b.rooms.length - a.rooms.length);

  // 3b. Directed reachability inside the main map.
  const mainRooms = components[mainIdx] ?? [];
  const anchorId =
    (opts.anchor && resolve(doc, opts.anchor)) ||
    [...mainRooms].sort((a, b) => doc.rooms[b]!.visits - doc.rooms[a]!.visits)[0] ||
    "";
  const walk = (start: string, edges: (id: string) => string[]) => {
    const seen = new Set<string>(start ? [start] : []);
    const stack = start ? [start] : [];
    while (stack.length) {
      const id = stack.pop()!;
      for (const n of edges(id)) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return seen;
  };
  const forward = walk(anchorId, (id) => (out.get(id) ?? []).map((e) => e.to));
  const backward = walk(anchorId, (id) => (inc.get(id) ?? []).map((e) => e.from));
  const clusterize = (set: Set<string>, boundaryOf: (id: string) => BoundaryLink[]): ReachCluster[] => {
    const seen = new Set<string>();
    const clusters: ReachCluster[] = [];
    for (const id of [...set].sort((a, b) => roomNum(a) - roomNum(b))) {
      if (seen.has(id)) continue;
      const members: string[] = [];
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const cur = stack.pop()!;
        members.push(cur);
        const nbrs = [...(out.get(cur) ?? []).map((e) => e.to), ...(inc.get(cur) ?? []).map((e) => e.from)];
        for (const n of nbrs) {
          if (!set.has(n) || seen.has(n)) continue;
          seen.add(n);
          stack.push(n);
        }
      }
      members.sort((a, b) => roomNum(a) - roomNum(b));
      clusters.push({ rooms: members, boundary: members.flatMap(boundaryOf), sample: sampleOf(members[0]!) });
    }
    return clusters.sort((a, b) => b.rooms.length - a.rooms.length);
  };
  /** Classify the missing way back along `from --cmd--> to`, i.e. `to --rev--> from` (see {@link BoundaryWhy}). */
  const boundary = (from: string, cmd: string, to: string): BoundaryLink => {
    const near = from;
    const far = to;
    const rev = reverseDirection(cmd);
    const r = doc.rooms[far]!;
    if (!rev) return { from, cmd, to, why: "named" };
    const back = r.links[rev];
    const backTo = resolve(doc, back?.to);
    if (backTo && backTo !== near) return { from, cmd, to, why: "conflict", other: backTo };
    if (r.exits.includes(rev) && !backTo) return { from, cmd, to, why: "stitchable", stitch: { from: far, cmd: rev, to: near } };
    return { from, cmd, to, why: "not-listed" };
  };
  const unreachableSet = new Set(mainRooms.filter((id) => !forward.has(id)));
  const unreachable = clusterize(unreachableSet, (id) =>
    (out.get(id) ?? []).filter((e) => forward.has(e.to)).map((e) => boundary(id, e.cmd, e.to)),
  );
  const trapSet = new Set(mainRooms.filter((id) => forward.has(id) && !backward.has(id)));
  const traps = clusterize(trapSet, (id) =>
    (inc.get(id) ?? []).filter((e) => backward.has(e.from)).map((e) => boundary(e.from, e.cmd, id)),
  );

  return {
    rooms: rooms.length,
    anchor: anchorId,
    contaminated,
    nonRoom: nonRoomIds.map((n) => ({ ...n, component: comp.get(n.room) === mainIdx ? 0 : 1 })),
    truncated,
    duplicates: duplicates.sort((a, b) => b.rooms.length - a.rooms.length),
    uniformProse: [...uniform.values()]
      .map((u) => ({ sample: u.sample, rooms: u.rooms, stackedCells: [...u.cells.values()].filter((n) => n > 1).length }))
      .sort((a, b) => b.rooms - a.rooms),
    islands,
    unreachable,
    traps,
  };
}

export type IntegrityFix = {
  descriptionsScrubbed: number;
  duplicatesMerged: number;
  linksStitched: number;
};

/**
 * Apply the safe part of a report: scrub contaminated descriptions, merge duplicate groups the
 * graph proves (`certain`), and add reverse links the far room itself lists. Likely/twin
 * duplicates, islands and non-room captures are left for a human.
 */
export function repairIntegrity(map: WorldMap, report: IntegrityReport): IntegrityFix {
  const fix: IntegrityFix = { descriptionsScrubbed: 0, duplicatesMerged: 0, linksStitched: 0 };
  for (const c of report.contaminated) {
    const room = map.room(c.room);
    if (!room || room.description !== c.before) continue;
    map.replaceDescription(room, c.after);
    fix.descriptionsScrubbed += 1;
  }
  for (const d of report.duplicates) {
    if (d.confidence !== "certain") continue;
    for (const id of d.rooms) {
      const keep = map.canonicalId(d.keep);
      const drop = map.canonicalId(id);
      if (!keep || !drop || keep === drop) continue;
      const a = map.room(keep)!;
      const b = map.room(drop)!;
      if (!sameExitSet(a.exits, b.exits)) continue;
      if (map.mergeRooms(keep, drop)) fix.duplicatesMerged += 1;
    }
  }
  for (const cluster of [...report.unreachable, ...report.traps]) {
    for (const b of cluster.boundary) {
      if (!b.stitch) continue;
      const from = map.room(b.stitch.from);
      const to = map.canonicalId(b.stitch.to);
      if (!from || !to || from.links[b.stitch.cmd]?.to) continue;
      const kind = b.stitch.cmd === "u" || b.stitch.cmd === "d" ? "vertical" : isGeometricDirection(b.stitch.cmd) ? "dir" : "named";
      const link = map.link(from.id, b.stitch.cmd, to, { kind, confirmed: false });
      link.note = "integrity: reverse of a confirmed link; the room lists this exit";
      fix.linksStitched += 1;
    }
  }
  return fix;
}

export function formatIntegrityReport(r: IntegrityReport, limit = 15): string {
  const lines: string[] = [];
  const certainC = r.contaminated.filter((c) => c.confidence === "certain").length;
  const dupRooms = (conf: DuplicateGroup["confidence"]) =>
    r.duplicates.filter((d) => d.confidence === conf).reduce((n, d) => n + d.rooms.length - 1, 0);
  const sum = (cs: ReachCluster[]) => cs.reduce((n, c) => n + c.rooms.length, 0);
  const stitches = [...r.unreachable, ...r.traps].reduce((n, c) => n + c.boundary.filter((b) => b.stitch).length, 0);
  lines.push(`${r.rooms} rooms; reachability measured from ${r.anchor}`);
  lines.push("");
  lines.push("SUMMARY");
  lines.push(`  contaminated descriptions   ${r.contaminated.length} (${certainC} certain, ${r.contaminated.length - certainC} likely)`);
  lines.push(`  non-room captures           ${r.nonRoom.length}`);
  lines.push(`  truncated descriptions      ${r.truncated.length}${r.truncated.length ? ` (${r.truncated.slice(0, 8).join(", ")})` : ""}`);
  lines.push(
    `  duplicate rooms             ${dupRooms("certain")} proven, ${dupRooms("likely")} likely, ${dupRooms("twin")} unproven twins`,
  );
  lines.push(`  islands                     ${r.islands.length} (${sum(r.islands.map((i) => ({ rooms: i.rooms, boundary: [], sample: "" })))} rooms)`);
  lines.push(`  unreachable from anchor     ${sum(r.unreachable)} rooms in ${r.unreachable.length} clusters`);
  lines.push(`  no way back to anchor       ${sum(r.traps)} rooms in ${r.traps.length} clusters`);
  lines.push(`  stitchable reverse links    ${stitches}`);
  const whys = new Map<string, number>();
  for (const c of [...r.unreachable, ...r.traps]) for (const b of c.boundary) whys.set(b.why, (whys.get(b.why) ?? 0) + 1);
  lines.push(`  boundary links by cause     ${[...whys].map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
  lines.push("");

  const counts = new Map<string, number>();
  for (const c of r.contaminated) for (const x of c.removed) counts.set(x.text, (counts.get(x.text) ?? 0) + 1);
  lines.push(`CONTAMINATED DESCRIPTIONS — most common leaked lines`);
  for (const [t, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)) lines.push(`  ${String(n).padStart(4)}  ${t.slice(0, 100)}`);
  lines.push(`  examples:`);
  for (const c of r.contaminated.slice(0, Math.min(limit, 8))) {
    lines.push(`    ${c.room} [${c.confidence}] ${c.removed.map((x) => `${x.edge}:"${x.text.slice(0, 60)}" (${x.reasons.join("+")})`).join("; ")}`);
  }
  lines.push("");
  if (r.nonRoom.length) {
    lines.push("NON-ROOM CAPTURES");
    for (const n of r.nonRoom) lines.push(`  ${n.room} ${n.component ? "(off main map)" : ""} markers: ${n.markers.join(", ")}`);
    lines.push("");
  }
  lines.push("DUPLICATES");
  for (const d of r.duplicates.filter((x) => x.confidence !== "twin").slice(0, limit)) {
    lines.push(`  [${d.confidence}] keep ${d.keep} ← ${d.rooms.filter((x) => x !== d.keep).join(", ")} (${d.evidence.join(", ")})  "${d.sample.slice(0, 60)}"`);
  }
  const twins = r.duplicates.filter((x) => x.confidence === "twin");
  if (twins.length) lines.push(`  + ${twins.length} groups of identical prose+exits with no graph proof (twins or unproven copies)`);
  lines.push("");
  lines.push("UNIFORM PROSE (cannot be deduplicated by text)");
  for (const u of r.uniformProse.slice(0, 5)) lines.push(`  ${String(u.rooms).padStart(5)} rooms, ${u.stackedCells} stacked cells  "${u.sample.slice(0, 60)}"`);
  lines.push("");
  lines.push("ISLANDS (not linked to the main map)");
  for (const i of r.islands.slice(0, limit)) {
    lines.push(`  ${i.kind.padEnd(13)} ${String(i.rooms.length).padStart(3)} rooms  ${i.rooms.slice(0, 6).join(", ")}${i.rooms.length > 6 ? ", …" : ""}  "${i.sample.slice(0, 50)}"`);
  }
  lines.push("");
  for (const [title, cs] of [
    ["UNREACHABLE FROM ANCHOR (links lead out, none lead in)", r.unreachable],
    ["NO WAY BACK (links lead in, none lead out)", r.traps],
  ] as const) {
    lines.push(title);
    for (const c of cs.slice(0, limit)) {
      const fixes = c.boundary.filter((b) => b.stitch).map((b) => `${b.stitch!.from} ${b.stitch!.cmd}→${b.stitch!.to}`);
      lines.push(`  ${String(c.rooms.length).padStart(3)} rooms  ${c.rooms.slice(0, 5).join(", ")}${c.rooms.length > 5 ? ", …" : ""}  "${c.sample.slice(0, 50)}"`);
      const via = c.boundary.slice(0, 3).map((b) => `${b.from} ${b.cmd}→${b.to} [${b.why}${b.other ? ` ${b.to}→${b.other}` : ""}]`);
      lines.push(`        via ${via.join(", ") || "(nothing)"}${fixes.length ? `; stitch ${fixes.slice(0, 3).join(", ")}` : ""}`);
    }
    if (cs.length > limit) lines.push(`  … ${cs.length - limit} more clusters`);
    lines.push("");
  }
  return lines.join("\n");
}
