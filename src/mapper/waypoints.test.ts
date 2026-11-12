import assert from "node:assert/strict";
import test from "node:test";
import { WorldMap } from "./WorldMap.js";
test("setWaypoint and resolve via map.resolve", () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "A", description: "room a", exits: ["e"], contents: [] });
  const b = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  map.applyObservation(b, { mode: "brief", title: "B", description: "room b", exits: ["w"], contents: [] });
  map.link(a.id, "e", b.id, { kind: "dir", confirmed: true });
  map.setWaypoint("1", a.id);
  assert.equal(map.resolve("1")?.id, a.id);
  assert.equal(map.resolve("1")?.title, "A");
  map.setWaypoint("1", b.id);
  assert.equal(map.resolve("1")?.id, b.id);
});

test("mergeRooms updates waypoint room ids", () => {
  const map = WorldMap.empty("test");
  const keep = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(keep, { mode: "brief", title: "Keep", description: "k", exits: [], contents: [] });
  const drop = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  map.applyObservation(drop, { mode: "brief", title: "Drop", description: "d", exits: [], contents: [] });
  map.setWaypoint("stash", drop.id);
  map.mergeRooms(keep.id, drop.id);
  assert.equal(map.resolve("stash")?.id, keep.id);
});
