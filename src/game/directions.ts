/** Canonical exit names and geometry for the mapper (x east, y north, z up). */

export type Vec3 = { x: number; y: number; z: number };

const CANONICAL: Record<string, string> = {
  n: "n",
  north: "n",
  s: "s",
  south: "s",
  e: "e",
  east: "e",
  w: "w",
  west: "w",
  ne: "ne",
  northeast: "ne",
  nw: "nw",
  northwest: "nw",
  se: "se",
  southeast: "se",
  sw: "sw",
  southwest: "sw",
  u: "u",
  up: "u",
  d: "d",
  down: "d",
};

export const DIRECTION_VECTORS: Record<string, Vec3> = {
  n: { x: 0, y: 1, z: 0 },
  s: { x: 0, y: -1, z: 0 },
  e: { x: 1, y: 0, z: 0 },
  w: { x: -1, y: 0, z: 0 },
  ne: { x: 1, y: 1, z: 0 },
  nw: { x: -1, y: 1, z: 0 },
  se: { x: 1, y: -1, z: 0 },
  sw: { x: -1, y: -1, z: 0 },
  u: { x: 0, y: 0, z: 1 },
  d: { x: 0, y: 0, z: -1 },
};

const REVERSE: Record<string, string> = {
  n: "s",
  s: "n",
  e: "w",
  w: "e",
  ne: "sw",
  sw: "ne",
  nw: "se",
  se: "nw",
  u: "d",
  d: "u",
  in: "out",
  out: "in",
  enter: "out",
};

const LONG: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
  u: "up",
  d: "down",
};

/** Lowercase, collapse whitespace, strip a leading `go `. */
export function normalizeCommand(cmd: string): string {
  return cmd.trim().toLowerCase().replace(/\s+/g, " ").replace(/^go /, "");
}

/** `north` / `n` / `go north` → `n`; null when not a compass/vertical direction. */
export function canonicalDirection(cmd: string): string | null {
  return CANONICAL[normalizeCommand(cmd)] ?? null;
}

/** Canonical exit token: directions abbreviated, named exits (`out`, `lair`) lowercased. */
export function canonicalExit(token: string): string {
  const n = normalizeCommand(token);
  return CANONICAL[n] ?? n;
}

export function isGeometricDirection(exit: string): boolean {
  return exit in DIRECTION_VECTORS;
}

export function isVertical(exit: string): boolean {
  return exit === "u" || exit === "d";
}

export function reverseDirection(exit: string): string | null {
  return REVERSE[exit] ?? null;
}

export function longDirection(exit: string): string {
  return LONG[exit] ?? exit;
}

/** Split `north, east and out` / `n, s, e` into canonical exit tokens. */
export function parseExitList(raw: string): string[] {
  const t = raw
    .trim()
    .replace(/[.\s]+$/, "")
    .replace(/\band\b/gi, ",");
  if (!t || /^none$/i.test(t)) return [];
  const out: string[] = [];
  for (const part of t.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const ex = canonicalExit(p);
    if (!out.includes(ex)) out.push(ex);
  }
  return out;
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function sameExitSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}
