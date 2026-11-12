import assert from "node:assert/strict";
import test from "node:test";
import { WorldMap } from "./WorldMap.js";
import { collectThresholdKalinportResetIds, resetThresholdKalinportCorridor } from "./surfaceCorridorReset.js";

test("collectThresholdKalinportResetIds includes corridor areas but not kulajo mine prose", () => {
  const map = WorldMap.empty("t");
  map.doc.planes.p35 = { id: "p35", kind: "surface", createdAt: "t" };
  const town = map.createRoom({ plane: "p35", x: 0, y: 0, z: 0 });
  town.area = "threshold";
  town.title = "Threshold Square";
  const route = map.createRoom({ plane: "p35", x: 0, y: -5, z: 0 });
  route.area = "route";
  map.link(town.id, "s", route.id, { kind: "dir", confirmed: true });
  map.link(route.id, "n", town.id, { kind: "dir", confirmed: true });
  const mine = map.createRoom({ plane: "p35", x: -1, y: 1, z: 0 });
  mine.title = "Mine Tunnel";
  map.link(town.id, "n", mine.id, { kind: "dir", confirmed: true });
  const port = map.createRoom({ plane: "p35", x: 0, y: -10, z: 0 });
  port.area = "kalinport";
  map.link(route.id, "s", port.id, { kind: "dir", confirmed: true });
  const ids = new Set(collectThresholdKalinportResetIds(map));
  assert.ok(ids.has(town.id));
  assert.ok(ids.has(route.id));
  assert.ok(ids.has(port.id));
  assert.equal(ids.has(mine.id), false);
});

test("resetThresholdKalinportCorridor deletes collected rooms", () => {
  const map = WorldMap.empty("t");
  map.doc.planes.p35 = { id: "p35", kind: "surface", createdAt: "t" };
  const keep = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  keep.title = "Nal Shaddar";
  const town = map.createRoom({ plane: "p35", x: 0, y: 0, z: 0 });
  town.area = "threshold";
  const { removed } = resetThresholdKalinportCorridor(map);
  assert.equal(removed, 1);
  assert.ok(map.room(keep.id));
  assert.equal(map.room(town.id), undefined);
});
