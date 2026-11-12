import assert from "node:assert/strict";
import test from "node:test";
import { WorldMap } from "./WorldMap.js";
import { isHinderedStep, pathWireCommands, splitBatchPath } from "./walkCommands.js";

test("a speedwalk is cut around a hindered exit so one tripped move cannot shift the rest", () => {
  const map = WorldMap.empty("test");
  const ids = [0, 1, 2, 3, 4].map((i) => map.createRoom({ plane: "p1", x: i, y: i, z: 0 }).id);
  for (let i = 0; i < 4; i++) map.link(ids[i]!, "ne", ids[i + 1]!, { kind: "dir", confirmed: true });
  const path = map.findPath(ids[0]!, (r) => r.id === ids[4], {})!;
  assert.equal(path.length, 4);
  assert.deepEqual(splitBatchPath(path, map).map((s) => s.length), [4], "nothing hindered: one batch");

  map.recordHindrance(ids[1]!, "ne");
  assert.ok(isHinderedStep(path[1]!, map));
  const segs = splitBatchPath(path, map);
  assert.deepEqual(segs.map((s) => s.map((x) => x.from)), [[ids[0]], [ids[1]], [ids[2], ids[3]]]);
  assert.deepEqual(segs.flatMap((s) => pathWireCommands(s, map)), ["ne", "ne", "ne", "ne"], "same commands, only grouped");
});

test("pathWireCommands opens a door on the step before the move", () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  map.link(a.id, "e", b.id, { kind: "dir", confirmed: true });
  map.applyDoors(a, [{ name: "stone door", direction: "e", state: "closed" }]);
  const path = map.findPath(a.id, (r) => r.id === b.id)!;
  assert.deepEqual(pathWireCommands(path, map), ["open door", "e"]);
});
