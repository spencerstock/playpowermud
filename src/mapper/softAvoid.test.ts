import assert from "node:assert/strict";
import test from "node:test";
import { WorldMap } from "./WorldMap.js";

/**
 * Room avoids never block navigation (Spencer 2026-11-19): they route around rooms only when an
 * alternate route exists; otherwise the path goes through the fewest avoided rooms.
 */
function grid() {
  const map = WorldMap.empty("t");
  const mk = (x: number, y: number) => {
    const r = map.createRoom({ plane: "p1", x, y, z: 0 });
    map.applyObservation(r, { mode: "brief", title: `${x},${y}`, exits: [], contents: [] });
    return r.id;
  };
  const both = (a: string, cmd: string, b: string, back: string) => {
    map.link(a, cmd, b, { kind: "dir", confirmed: true });
    map.link(b, back, a, { kind: "dir", confirmed: true });
  };
  return { map, mk, both };
}

test("avoid routes around a room when an alternate route exists", () => {
  const { map, mk, both } = grid();
  const a = mk(0, 0), b = mk(1, 0), c = mk(2, 0), d = mk(0, 1), e = mk(1, 1);
  both(a, "e", b, "w");
  both(b, "e", c, "w");
  both(a, "s", d, "n");
  both(d, "e", e, "w");
  both(e, "ne", c, "sw");
  const p = map.findPath(a, (r) => r.id === c, { avoid: [b] })!;
  assert.ok(p, "path found");
  assert.ok(!p.some((s) => s.to === b), "detours around the avoided room");
});

test("avoid on the only route (r189 → r100 style dead end) still walks through it", () => {
  const { map, mk, both } = grid();
  const trainer = mk(0, 0), lair = mk(1, 0), hall = mk(2, 0), safe = mk(3, 0);
  both(trainer, "e", lair, "w");
  both(lair, "e", hall, "w");
  both(hall, "e", safe, "w");
  const p = map.findPath(trainer, (r) => r.id === safe, { avoid: [lair] });
  assert.ok(p, "never null because of an avoid");
  assert.deepEqual(p!.map((s) => s.to), [lair, hall, safe]);
});

test("strictAvoid keeps the old hard behavior", () => {
  const { map, mk, both } = grid();
  const a = mk(0, 0), b = mk(1, 0), c = mk(2, 0);
  both(a, "e", b, "w");
  both(b, "e", c, "w");
  assert.equal(map.findPath(a, (r) => r.id === c, { avoid: [b], strictAvoid: true }), null);
  assert.ok(map.findPath(a, (r) => r.id === c, { avoid: [b] }));
});

test("fallback prefers the route through the fewest avoided rooms, even if longer", () => {
  const { map, mk, both } = grid();
  const a = mk(0, 0), x1 = mk(1, 0), x2 = mk(2, 0), c = mk(3, 0);
  const y1 = mk(0, 1), y2 = mk(1, 1), y3 = mk(2, 1), y4 = mk(3, 1);
  both(a, "e", x1, "w");
  both(x1, "e", x2, "w");
  both(x2, "e", c, "w");
  both(a, "s", y1, "n");
  both(y1, "e", y2, "w");
  both(y2, "e", y3, "w");
  both(y3, "e", y4, "w");
  both(y4, "n", c, "s");
  const p = map.findPath(a, (r) => r.id === c, { avoid: [x1, x2, y3] })!;
  assert.ok(p);
  assert.ok(p.some((s) => s.to === y3) && !p.some((s) => s.to === x1 || s.to === x2), "one avoided room beats two");
});

test("avoid tags and maxDanger are soft the same way", () => {
  const { map, mk, both } = grid();
  const a = mk(0, 0), b = mk(1, 0), c = mk(2, 0);
  both(a, "e", b, "w");
  both(b, "e", c, "w");
  map.room(b)!.tags.push("lair");
  map.room(b)!.danger = 5;
  assert.ok(map.findPath(a, (r) => r.id === c, { avoid: ["lair"] }));
  assert.ok(map.findPath(a, (r) => r.id === c, { maxDanger: 1 }));
});

test("avoidLinks stay hard (phantom / failed exits are not room avoids)", () => {
  const { map, mk, both } = grid();
  const a = mk(0, 0), b = mk(1, 0);
  both(a, "e", b, "w");
  assert.equal(map.findPath(a, (r) => r.id === b, { avoidLinks: [`${a}:e`] }), null);
  assert.equal(map.findPath(a, (r) => r.id === b, { avoidLinks: [`${a}:e`], avoid: ["zzz"] }), null);
});
