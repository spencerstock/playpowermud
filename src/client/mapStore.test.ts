import assert from "node:assert/strict";
import test from "node:test";
import { mergeShippedBaseline } from "./mapStore.js";
import { emptyWorldGraph } from "../mapper/WorldMap.js";
import type { WorldGraphDocument } from "../mapper/types.js";

function docWithRoom(id: string, extra: Partial<WorldGraphDocument> = {}): WorldGraphDocument {
  const base = emptyWorldGraph("powermud");
  base.rooms[id] = {
    id,
    descKeys: ["test room"],
    exits: ["n"],
    links: {},
    pos: { plane: "p1", x: 0, y: 0, z: 0 },
    contents: {},
    tags: [],
    notes: [],
    meta: {},
    visits: 1,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  };
  base.planes.p1 = { id: "p1", name: "surface", origin: { x: 0, y: 0, z: 0 } };
  return { ...base, ...extra, rooms: { ...base.rooms, ...(extra.rooms ?? {}) } };
}

test("mergeShippedBaseline keeps learned rooms and adds new shipped rooms", () => {
  const learned = docWithRoom("r-learned");
  learned.updatedAt = "2026-01-02T00:00:00.000Z";
  const shipped = docWithRoom("r-shipped");
  shipped.updatedAt = "2026-02-01T00:00:00.000Z";
  shipped.nextRoom = 99;

  const changed = mergeShippedBaseline(learned, shipped);
  assert.equal(changed, true);
  assert.ok(learned.rooms["r-learned"]);
  assert.ok(learned.rooms["r-shipped"]);
  assert.equal(learned.nextRoom, 99);
});

test("mergeShippedBaseline is a no-op when shipped adds nothing new", () => {
  const learned = docWithRoom("r1");
  const shipped = docWithRoom("r1");
  shipped.nextRoom = learned.nextRoom;
  assert.equal(mergeShippedBaseline(learned, shipped), false);
});
