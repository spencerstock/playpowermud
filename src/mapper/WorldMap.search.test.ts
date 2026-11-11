import assert from "node:assert/strict";
import { test } from "node:test";
import { WorldMap } from "./WorldMap.js";
import type { MapLink, MapRoom } from "./types.js";

function room(id: string, extras: Partial<MapRoom> = {}): MapRoom {
  return {
    id,
    descKeys: [],
    exits: [],
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

test("search finds every room where an NPC name was seen", () => {
  const map = WorldMap.empty("test");
  map.doc.rooms.r1 = room("r1", {
    title: "Tavern",
    contents: {
      bar: { name: "Bartender", kind: "npc", lastCount: 1, seenCount: 2, lastSeenAt: "" },
    },
  });
  map.doc.rooms.r2 = room("r2", {
    pos: { plane: "p1", x: 1, y: 0, z: 0 },
    contents: {
      m: { name: "Duergar merchant", kind: "npc", lastCount: 1, seenCount: 1, lastSeenAt: "" },
    },
  });
  map.reindex();

  const bartender = map.search("bartender", 10);
  assert.equal(bartender.length, 1);
  assert.equal(bartender[0]!.room.id, "r1");
  assert.equal(bartender[0]!.npcMatch, "Bartender");

  const merchant = map.search("duergar merchant", 10);
  assert.equal(merchant.length, 1);
  assert.equal(merchant[0]!.room.id, "r2");
  assert.equal(merchant[0]!.npcMatch, "Duergar merchant");
});

test("search uses contents when npcs array is empty", () => {
  const map = WorldMap.empty("test");
  map.doc.rooms.r1 = room("r1", {
    npcs: [],
    contents: {
      lore: { name: "Loreman", kind: "npc", lastCount: 1, seenCount: 1, lastSeenAt: "" },
    },
  });
  map.reindex();

  const hits = map.search("loreman", 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.npcMatch, "Loreman");
});

test("search exact room id does not match r19 or r109 for r9", () => {
  const map = WorldMap.empty("test");
  map.doc.rooms.r9 = room("r9", { title: "General Store" });
  map.doc.rooms.r19 = room("r19", { pos: { plane: "p1", x: 1, y: 0, z: 0 }, title: "Alley" });
  map.doc.rooms.r109 = room("r109", { pos: { plane: "p1", x: 2, y: 0, z: 0 }, title: "Dock" });
  map.reindex();

  const hits = map.search("r9", 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.room.id, "r9");

  assert.equal(map.search("r99", 10).length, 0);
});

test("search tolerates rooms missing optional arrays", () => {
  const map = WorldMap.empty("test");
  map.doc.rooms.r1 = {
    id: "r1",
    pos: { plane: "p1", x: 0, y: 0, z: 0 },
    contents: {
      m: { name: "Orcish slave", kind: "npc", lastCount: 1, seenCount: 1, lastSeenAt: "" },
    },
    visits: 1,
    firstSeenAt: "",
    lastSeenAt: "",
  } as unknown as MapRoom;
  map.reindex();

  const hits = map.search("orcish slave", 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.room.id, "r1");
});

test("stepDistances counts hops and omits unreachable rooms", () => {
  const map = WorldMap.empty("test");
  const link = (to: string, extra: Partial<MapLink> = {}): MapLink => ({
    to,
    kind: "dir",
    confirmed: true,
    uses: 1,
    ...extra,
  });
  map.doc.rooms.a = room("a", {
    exits: ["e", "n", "portal"],
    links: { e: link("b"), n: link("c"), portal: link("skip", { kind: "teleport" }) },
  });
  map.doc.rooms.b = room("b", {
    pos: { plane: "p1", x: 1, y: 0, z: 0 },
    exits: ["e"],
    links: { e: link("d") },
  });
  map.doc.rooms.c = room("c", { pos: { plane: "p1", x: 0, y: 1, z: 0 } });
  map.doc.rooms.d = room("d", { pos: { plane: "p1", x: 2, y: 0, z: 0 } });
  map.doc.rooms.far = room("far", { pos: { plane: "p1", x: 9, y: 9, z: 0 } });
  map.doc.rooms.skip = room("skip", { pos: { plane: "p1", x: 3, y: 0, z: 0 } });
  map.reindex();

  const distances = map.stepDistances("a", new Set(["a", "c", "d", "far", "skip"]));
  assert.equal(distances.get("a"), 0);
  assert.equal(distances.get("c"), 1);
  assert.equal(distances.get("d"), 2);
  assert.equal(distances.has("far"), false);
  assert.equal(distances.has("skip"), false);
});

test("findByObservation stays ambiguous when several rooms share the same description", () => {
  const map = WorldMap.empty("test");
  const prose =
    "Black water seeps around your boots and the smell of rot hangs heavy in the humid air of the swamp. " +
    "The trail winds onward through identical-looking pools and reeds.";
  const obsBase = { mode: "verbose" as const, description: prose, exits: ["north", "south"], contents: [] };
  const a = map.createRoom({ plane: "p0", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p0", x: 1, y: 0, z: 0 });
  map.applyObservation(a, { ...obsBase, title: "Swamp" });
  map.applyObservation(b, { ...obsBase, title: "Wrong title on file" });
  const match = map.findByObservation({ ...obsBase, title: "Swamp" });
  assert.equal(match.room, null, "title must not disambiguate shared prose");
  assert.ok(match.candidates >= 2);
  assert.equal(map.roomIdsMatchingDescription({ ...obsBase, title: "Swamp" }).length, 2);
});

test("shared prose: a thin look-alike fragment does not hide the well-wired original (r731/r3379, 2026-11-01)", () => {
  const map = WorldMap.empty("test");
  const description =
    "You have just entered a trail that seems to run deep into the forest.  You cannot see off in the distance, because there are many trees here.";
  const conf = (to: string): MapLink => ({ to, kind: "dir", confirmed: true, uses: 3 });
  map.doc.rooms.r731 = room("r731", { description, exits: ["n", "e"], visits: 58, links: { n: conf("r732"), e: conf("r730") } });
  map.doc.rooms.r3379 = room("r3379", {
    description, exits: ["n", "e"], visits: 2, pos: { plane: "p1", x: -2, y: 2, z: 0 },
    links: { n: { to: "r735", kind: "dir", confirmed: false, uses: 0 } },
  });
  map.reindex();
  const obs = { mode: "verbose", description, exits: ["n", "e"], contents: [] } as any;
  map.applyObservation(map.doc.rooms.r731!, obs);
  map.applyObservation(map.doc.rooms.r3379!, obs);
  assert.equal(map.findByObservation(obs, { allowTitle: false }).room?.id, "r731");

  // Two wired twins (Oasis Avenue blocks) stay ambiguous.
  map.doc.rooms.r3379!.links = { n: conf("r735"), e: conf("r3378") };
  map.reindex();
  assert.equal(map.findByObservation(obs, { allowTitle: false }).room, null);
});

test("heal folds an existing thin look-alike into the well-wired original (r2980/r3584, 2026-11-01)", () => {
  const map = WorldMap.empty("test");
  const description =
    "You are standing on a small path that continues in two directions, east, on to the Caravan Route, and northwest, further away from it.  There are trees all around you.";
  const conf = (to: string): MapLink => ({ to, kind: "dir", confirmed: true, uses: 3 });
  map.doc.rooms.r2980 = room("r2980", { description, exits: ["e", "nw"], visits: 24, links: { e: conf("r693"), nw: conf("r2981") } });
  map.doc.rooms.r693 = room("r693", { description: "A wide caravan road runs north and south here, with a small forest path leading off to the west.", exits: ["n", "s", "w"], visits: 9, pos: { plane: "p1", x: 1, y: 0, z: 0 }, links: { w: conf("r2980") } });
  map.doc.rooms.r3584 = room("r3584", {
    description, exits: ["e", "nw"], visits: 12, pos: { plane: "p1", x: 5, y: 9, z: 0 },
    links: { e: { to: "r3481", kind: "dir", confirmed: false, uses: 0 } },
  });
  map.doc.rooms.r3481 = room("r3481", { description: "A muddy stretch of caravan road between tall pines, the ruts deep from passing wagons.", exits: ["n", "s", "w"], visits: 3, pos: { plane: "p1", x: 6, y: 9, z: 0 }, links: { w: { to: "r3584", kind: "dir", confirmed: false, uses: 0 } } });
  map.reindex();
  const report = map.heal();
  assert.equal(map.doc.rooms.r3584, undefined);
  assert.equal(map.room("r3584")?.id, "r2980");
  assert.equal(map.doc.rooms.r2980!.links.e!.to, "r693");
  assert.ok((report.lookalikesFolded ?? 0) >= 1);

  // Two wired twins are left alone.
  const twins = WorldMap.empty("test");
  twins.doc.rooms.a = room("a", { description, exits: ["e", "nw"], visits: 5, links: { e: conf("x"), nw: conf("y") } });
  twins.doc.rooms.b = room("b", { description, exits: ["e", "nw"], visits: 4, pos: { plane: "p1", x: 9, y: 9, z: 0 }, links: { e: conf("z"), nw: conf("w") } });
  twins.reindex();
  assert.equal(twins.heal().lookalikesFolded, 0);

  // A fragment whose one confirmed exit leads elsewhere (look-alike road tiles) is distinct.
  const road = WorldMap.empty("test");
  road.doc.rooms.a = room("a", { description, exits: ["e", "nw"], visits: 5, links: { e: conf("x"), nw: conf("y") } });
  road.doc.rooms.b = room("b", { description, exits: ["e", "nw"], visits: 1, pos: { plane: "p1", x: 9, y: 9, z: 0 }, links: { e: conf("z") } });
  road.reindex();
  assert.equal(road.heal().lookalikesFolded, 0);
});

test("observed rooms index hidden mobs and singular group names, never players", () => {
  const map = WorldMap.empty("test");
  map.doc.rooms.r1 = room("r1", { title: "Desert" });
  map.reindex();
  map.applyObservation(map.room("r1")!, {
    mode: "verbose",
    description: "Sand everywhere.",
    exits: ["n"],
    contents: [
      { name: "Drow", count: 1, kind: "npc", hidden: true },
      { name: "Fiz", count: 1, kind: "player" },
      { name: "Highwaymen", count: 2, kind: "npc" },
      { name: "Egg", count: 1, kind: "item" },
    ],
  });
  const r1 = map.room("r1")!;
  assert.deepEqual(r1.npcs, ["Drow", "Highwayman"]);
  assert.equal(r1.contents.Drow?.hidden, true);
  assert.equal(r1.contents.Fiz, undefined);
  assert.equal(map.search("highwayman", 5)[0]?.npcMatch, "Highwayman");
  assert.equal(map.search("drow", 5)[0]?.room.id, "r1");
  assert.equal(map.search("fiz", 5).length, 0);
});
