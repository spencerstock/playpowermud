import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaMetaSlug,
  OVERWORLD_AREA,
  parseAreaHints,
  propagateAreas,
  roomSearchTitle,
} from "./areaInfer.js";
import { WorldMap } from "./WorldMap.js";
import type { MapRoom } from "./types.js";

function room(id: string, extras: Partial<MapRoom> = {}): MapRoom {
  return {
    id,
    descKeys: [],
    exits: ["n"],
    links: {},
    pos: { plane: "p1", x: 0, y: 0, z: 0 },
    contents: {},
    tags: [],
    notes: [],
    meta: {},
    visits: 1,
    firstSeenAt: "",
    lastSeenAt: "",
    ...extras,
  };
}

test("parseAreaHints finds Nal Shaddar from common room prose", () => {
  const hints = parseAreaHints(
    "You are in a small shop situated in the Drow city of Nal Shaddar.  Many shelves line the walls.",
  );
  assert.equal(hints[0]?.label, "Nal Shaddar");
  assert.equal(hints[0]?.id, "nal-shaddar");
});

test("parseAreaHints ignores generic 'the area' phrasing", () => {
  const hints = parseAreaHints("You sneak stealthily from the area.\nThe shore is running north and south here.");
  assert.equal(hints.length, 0);
});

test("propagateAreas labels connected rooms and shops", () => {
  const map = WorldMap.empty("test");
  map.doc.rooms.a = room("a", {
    pos: { plane: "p1", x: 0, y: 0, z: 0 },
    description: "This is the market center of Nal Shaddar.  A few shops have been erected here.",
    links: { e: { to: "b", kind: "dir", confirmed: true, uses: 1 } },
    exits: ["e"],
  });
  map.doc.rooms.b = room("b", {
    pos: { plane: "p1", x: 1, y: 0, z: 0 },
    title: "General Store",
    description: "Upon entering this shop, you can see that behind the counter is a wide variety of items.",
    links: { w: { to: "a", kind: "dir", confirmed: true, uses: 1 } },
    exits: ["w"],
  });
  map.doc.rooms.c = room("c", {
    pos: { plane: "p1", x: 5, y: 5, z: 0 },
    description: "A dusty road through the wilderness.",
  });
  map.reindex();

  const n = propagateAreas(map);
  assert.ok(n >= 2);
  assert.equal(map.doc.rooms.a!.area, "nal-shaddar");
  assert.equal(map.doc.rooms.b!.area, "nal-shaddar");
  assert.equal(map.doc.rooms.c!.area, undefined);
  assert.equal(roomSearchTitle(map.doc, map.doc.rooms.c!), "A dusty road through the wilderness - Overworld");
  assert.match(roomSearchTitle(map.doc, map.doc.rooms.b!), / - Nal Shaddar$/);
});

test("manual area is not overwritten", () => {
  const map = WorldMap.empty("test");
  map.doc.rooms.a = room("a", {
    description: "market center of Nal Shaddar",
    meta: { areaManual: true },
    area: "custom",
  });
  map.reindex();
  propagateAreas(map);
  assert.equal(map.doc.rooms.a!.area, "custom");
});

test("OVERWORLD_AREA constant is stable", () => {
  assert.equal(OVERWORLD_AREA, "overworld");
});

test("areaMetaSlug hides slug when it matches the display label", () => {
  assert.equal(areaMetaSlug("nal-shaddar", "Nal Shaddar"), null);
  assert.equal(areaMetaSlug("dunkrist", "Dunkrist"), null);
  assert.equal(areaMetaSlug("overworld", "Overworld"), null);
  assert.equal(areaMetaSlug("market-wing", "Nal Shaddar"), "market-wing");
});
