import assert from "node:assert/strict";
import test from "node:test";
import { WorldMap } from "./WorldMap.js";
import { resolvePathOptions, setGlobalPreferAvoid } from "./pathPolicy.js";

test("resolvePathOptions clears empty avoid lists", () => {
  assert.deepEqual(resolvePathOptions({ avoid: [] }), {});
});

test("preferAvoid chooses a longer route when one exists", () => {
  const map = WorldMap.empty("t");
  const mk = (x: number, y: number, exits: string[]) => {
    const r = map.createRoom({ plane: "p1", x, y, z: 0 });
    map.applyObservation(r, { mode: "brief", title: `${x},${y}`, exits, contents: [] });
    return r;
  };
  const a = mk(0, 0, ["e", "s"]);
  const b = mk(1, 0, ["w", "e"]);
  const d = mk(0, 1, ["n", "e"]);
  const c = mk(2, 0, ["w"]);
  map.link(a.id, "e", b.id, { kind: "dir", confirmed: true });
  map.link(b.id, "e", c.id, { kind: "dir", confirmed: true });
  map.link(a.id, "s", d.id, { kind: "dir", confirmed: true });
  map.link(d.id, "e", c.id, { kind: "dir", confirmed: true });
  const direct = map.findPath(a.id, (r) => r.id === c.id, {})!;
  assert.equal(direct.length, 2);
  assert.equal(direct[0]!.to, b.id);
  const soft = map.findPath(a.id, (r) => r.id === c.id, { preferAvoid: [b.id] })!;
  assert.equal(soft.length, 2);
  assert.equal(soft[0]!.to, d.id);
});

test("setGlobalPreferAvoid merges into resolvePathOptions", () => {
  setGlobalPreferAvoid(["r10"]);
  assert.deepEqual(resolvePathOptions({}).preferAvoid, ["r10"]);
  setGlobalPreferAvoid([]);
});
