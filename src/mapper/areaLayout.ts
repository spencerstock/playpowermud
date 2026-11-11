import { areaDisplayLabel, effectiveAreaId, OVERWORLD_AREA } from "./areaInfer.js";
import type { WorldMap } from "./WorldMap.js";
import { pickPlaceLabel, roomPhraseText } from "./areaPhrases.js";

/** Legacy client fallback: x/y only (one label per area id, no phrase scoring). */
export type AreaLayoutRoomLegacy = {
  area: string;
  areaLabel: string;
  pos: { x: number; y: number };
};

/** Room fields needed to place phrase-weighted area labels on a map view. */
export type AreaLayoutRoom = {
  id: string;
  area: string;
  areaLabel: string;
  pos: { x: number; y: number; z: number };
  /** Neighbor room ids on the same level (compass / vertical; no teleports). */
  linkIds: string[];
  title?: string | null;
  description?: string | null;
  /** Pre-built prose for corpus (title + description). */
  text?: string;
};

export type AreaOverlayTerm = { text: string; weight: number };

export type AreaOverlay = {
  areaId: string;
  label: string;
  terms?: AreaOverlayTerm[];
  /** Map grid x for label anchor. */
  x: number;
  /** Map grid y for label anchor. */
  y: number;
  roomCount: number;
  /** Suggested SVG font size (px). */
  fontSize: number;
};

type AreaBucket = {
  areaId: string;
  label: string;
  xs: number[];
  ys: number[];
};

type LayoutRow = AreaLayoutRoom;

const MIN_LABEL_SEP = 4;
const MIN_COMPONENT_ROOMS = 2;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function centroid(xs: number[], ys: number[]): { x: number; y: number } {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  return { x: sx / n, y: sy / n };
}

function bounds(xs: number[], ys: number[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Deterministic candidate anchors inside an area's room footprint. */
function labelCandidates(bucket: AreaBucket): { x: number; y: number }[] {
  const { xs, ys } = bucket;
  const c = centroid(xs, ys);
  const b = bounds(xs, ys);
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;
  const q1x = b.minX + (b.maxX - b.minX) * 0.25;
  const q3x = b.minX + (b.maxX - b.minX) * 0.75;
  const q1y = b.minY + (b.maxY - b.minY) * 0.25;
  const q3y = b.minY + (b.maxY - b.minY) * 0.75;
  const out: { x: number; y: number }[] = [
    { x: c.x, y: c.y },
    { x: midX, y: midY },
    { x: q1x, y: q1y },
    { x: q3x, y: q3y },
    { x: q1x, y: q3y },
    { x: q3x, y: q1y },
    { x: b.minX, y: midY },
    { x: b.maxX, y: midY },
    { x: midX, y: b.minY },
    { x: midX, y: b.maxY },
  ];
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function fontSizeForBucket(bucket: AreaBucket): number {
  const b = bounds(bucket.xs, bucket.ys);
  const span = Math.max(b.maxX - b.minX + 1, b.maxY - b.minY + 1, 1);
  const bySpan = 10 + span * 1.35;
  const byRooms = 11 + Math.sqrt(bucket.xs.length) * 2.2;
  return clamp(Math.round(Math.max(bySpan, byRooms)), 13, 26);
}

function bucketFromRows(areaId: string, label: string, rows: LayoutRow[]): AreaBucket {
  const b: AreaBucket = { areaId, label, xs: [], ys: [] };
  for (const r of rows) {
    b.xs.push(r.pos.x);
    b.ys.push(r.pos.y);
  }
  return b;
}

/** Connected components within one area id on a single z level. */
function connectedComponents(rows: LayoutRow[], byId: Map<string, LayoutRow>): LayoutRow[][] {
  const ids = new Set(rows.map((r) => r.id));
  const visited = new Set<string>();
  const components: LayoutRow[][] = [];

  for (const start of rows) {
    if (visited.has(start.id)) continue;
    const stack = [start.id];
    const comp: LayoutRow[] = [];
    visited.add(start.id);
    while (stack.length) {
      const id = stack.pop()!;
      const room = byId.get(id);
      if (!room) continue;
      comp.push(room);
      for (const nid of room.linkIds) {
        if (!ids.has(nid) || visited.has(nid)) continue;
        visited.add(nid);
        stack.push(nid);
      }
    }
    components.push(comp);
  }
  return components;
}

function rowText(r: LayoutRow): string {
  return r.text ?? roomPhraseText(r.title, r.description);
}

export type ComputeAreaOverlaysOpts = {
  /** Only label rooms on this z (required when using link-based components). */
  z: number;
};

/**
 * Group rooms by area id, split into connected blobs on one level, phrase-score each blob,
 * and pick non-overlapping label anchors.
 */
export function computeAreaOverlays(rooms: AreaLayoutRoom[], opts: ComputeAreaOverlaysOpts): AreaOverlay[];
export function computeAreaOverlays(rooms: AreaLayoutRoomLegacy[]): AreaOverlay[];
export function computeAreaOverlays(
  rooms: AreaLayoutRoom[] | AreaLayoutRoomLegacy[],
  opts?: ComputeAreaOverlaysOpts,
): AreaOverlay[] {
  if (!rooms.length) return [];

  if (!opts || !("z" in opts)) {
    return computeLegacyOverlays(rooms as AreaLayoutRoomLegacy[]);
  }

  const z = opts.z;
  const onLevel = (rooms as AreaLayoutRoom[]).filter((r) => r.pos.z === z);
  if (!onLevel.length) return [];

  const byId = new Map(onLevel.map((r) => [r.id, r]));
  const byArea = new Map<string, LayoutRow[]>();
  for (const r of onLevel) {
    const areaId = r.area || OVERWORLD_AREA;
    let list = byArea.get(areaId);
    if (!list) byArea.set(areaId, (list = []));
    list.push(r);
  }

  type Pending = { areaId: string; fallbackLabel: string; rows: LayoutRow[]; bucket: AreaBucket };
  const pending: Pending[] = [];

  for (const [areaId, areaRows] of byArea) {
    let fallbackLabel = "Overworld";
    for (const r of areaRows) {
      if (r.areaLabel && r.areaLabel !== "Overworld") {
        fallbackLabel = r.areaLabel;
        break;
      }
    }
    const components = connectedComponents(areaRows, byId);
    const multi = components.length > 1;
    for (const comp of components) {
      if (multi && comp.length < MIN_COMPONENT_ROOMS) continue;
      pending.push({
        areaId,
        fallbackLabel,
        rows: comp,
        bucket: bucketFromRows(areaId, fallbackLabel, comp),
      });
    }
  }

  pending.sort((a, b) => {
    const dc = b.rows.length - a.rows.length;
    if (dc !== 0) return dc;
    return a.areaId.localeCompare(b.areaId);
  });

  const placed: { x: number; y: number }[] = [];
  const overlays: AreaOverlay[] = [];

  for (const { areaId, fallbackLabel, rows, bucket } of pending) {
    if (bucket.xs.length === 0) continue;
    const pick = pickPlaceLabel(
      rows.map((r) => ({ title: r.title, description: r.description, text: rowText(r) })),
      areaId,
      fallbackLabel,
    );
    const fontSize = fontSizeForBucket(bucket);
    let anchor = labelCandidates(bucket)[0]!;
    for (const cand of labelCandidates(bucket)) {
      if (placed.every((p) => dist(p, cand) >= MIN_LABEL_SEP)) {
        anchor = cand;
        break;
      }
      anchor = cand;
    }
    placed.push(anchor);
    overlays.push({
      areaId,
      label: pick.label,
      terms: pick.terms,
      x: anchor.x,
      y: anchor.y,
      roomCount: rows.length,
      fontSize,
    });
  }

  return overlays.sort((a, b) => a.areaId.localeCompare(b.areaId) || a.label.localeCompare(b.label));
}

function computeLegacyOverlays(rooms: AreaLayoutRoomLegacy[]): AreaOverlay[] {
  const buckets = new Map<string, AreaBucket>();
  for (const r of rooms) {
    const areaId = r.area || OVERWORLD_AREA;
    let b = buckets.get(areaId);
    if (!b) {
      b = { areaId, label: r.areaLabel, xs: [], ys: [] };
      buckets.set(areaId, b);
    }
    if (r.areaLabel && (!b.label || b.label === "Overworld")) b.label = r.areaLabel;
    b.xs.push(r.pos.x);
    b.ys.push(r.pos.y);
  }

  const ordered = [...buckets.values()].sort((a, b) => {
    const dc = b.xs.length - a.xs.length;
    if (dc !== 0) return dc;
    return a.areaId.localeCompare(b.areaId);
  });

  const placed: { x: number; y: number }[] = [];
  const overlays: AreaOverlay[] = [];

  for (const bucket of ordered) {
    if (bucket.xs.length === 0) continue;
    const fontSize = fontSizeForBucket(bucket);
    let anchor = labelCandidates(bucket)[0]!;
    for (const cand of labelCandidates(bucket)) {
      if (placed.every((p) => dist(p, cand) >= MIN_LABEL_SEP)) {
        anchor = cand;
        break;
      }
      anchor = cand;
    }
    placed.push(anchor);
    overlays.push({
      areaId: bucket.areaId,
      label: bucket.label,
      x: anchor.x,
      y: anchor.y,
      roomCount: bucket.xs.length,
      fontSize,
    });
  }

  return overlays.sort((a, b) => a.areaId.localeCompare(b.areaId));
}

/** Phrase-weighted overlays for rooms visible on one map level (display-only). */
export function computeAreaOverlaysForMapView(
  map: WorldMap,
  plane: string,
  z: number,
  viewportRoomIds: Iterable<string>,
): AreaOverlay[] {
  const ids = new Set(viewportRoomIds);
  const planeRooms = map.rooms().filter((r) => r.pos.plane === plane);
  const levelIds = new Set(planeRooms.filter((r) => r.pos.z === z).map((r) => r.id));
  const layoutRows: AreaLayoutRoom[] = [];
  for (const r of planeRooms) {
    if (!ids.has(r.id) || r.pos.z !== z) continue;
    const linkIds = new Set<string>();
    for (const l of Object.values(r.links)) {
      if (l.to && l.kind !== "teleport" && levelIds.has(l.to)) linkIds.add(l.to);
    }
    for (const inc of map.incomingRooms(r.id)) {
      if (inc.pos.plane === plane && inc.pos.z === z && levelIds.has(inc.id)) linkIds.add(inc.id);
    }
    layoutRows.push({
      id: r.id,
      area: effectiveAreaId(r),
      areaLabel: areaDisplayLabel(map.doc, r),
      pos: { ...r.pos },
      linkIds: [...linkIds],
      title: r.title,
      description: r.description,
    });
  }

  return computeAreaOverlays(layoutRows, { z });
}

/** Area labels for a topology layout (`viewLayout.ts`): rooms sit at their view cells, not stored coordinates. */
export function computeAreaOverlaysForLayout(
  map: WorldMap,
  cells: ReadonlyMap<string, { x: number; y: number; z: number }>,
  z: number,
): AreaOverlay[] {
  const onLevel = new Set([...cells].filter(([, p]) => p.z === z).map(([id]) => id));
  const rows: AreaLayoutRoom[] = [];
  for (const id of onLevel) {
    const r = map.room(id);
    if (!r) continue;
    const linkIds = new Set<string>();
    for (const l of Object.values(r.links)) {
      const to = l.to && l.kind !== "teleport" ? map.canonicalId(l.to) : undefined;
      if (to && onLevel.has(to)) linkIds.add(to);
    }
    for (const inc of map.incomingRooms(r.id)) if (onLevel.has(inc.id)) linkIds.add(inc.id);
    rows.push({
      id: r.id,
      area: effectiveAreaId(r),
      areaLabel: areaDisplayLabel(map.doc, r),
      pos: { ...cells.get(id)! },
      linkIds: [...linkIds],
      title: r.title,
      description: r.description,
    });
  }
  return computeAreaOverlays(rows, { z });
}
