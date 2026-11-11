import assert from "node:assert/strict";
import test from "node:test";
import { descKey, descriptionCoresOverlap, normalizeDescription, WorldMap } from "./WorldMap.js";
import type { MapLink, MapRoom } from "./types.js";
import { MAX_WALK_REPLANS, recoverFromStepFailure } from "./walkReplan.js";

const CAVE =
  "The ground here dips considerably from lots of years of erosion, and the ceiling hangs low with " +
  "jagged stalactites. Water trickles along a groove in the rock toward the west, pooling in a dark " +
  "basin. You have to duck to avoid the sharpest points, but OUCH! You hit your head on a stalactite!";
const FOREST =
  "The Great Forest totally envelopes you, almost cutting you off from any light at all. Massive " +
  "trunks rise on every side and the undergrowth is thick with thorny vines that catch at your " +
  "clothing as you push your way through the gloom between the ancient trees.";

function link(to: string | null, extra: Partial<MapLink> = {}): MapLink {
  return { to, kind: "dir", confirmed: true, uses: 1, ...extra };
}

function room(id: string, x: number, exits: string[], links: Record<string, MapLink>, extra: Partial<MapRoom> = {}): MapRoom {
  const description = extra.description;
  return {
    id,
    title: extra.title,
    descKeys: description ? [descKey(description)] : [],
    description,
    exits,
    links,
    pos: extra.pos ?? { plane: "p1", x, y: 0, z: 0 },
    contents: {},
    tags: extra.tags ?? [],
    notes: [],
    meta: {},
    visits: extra.visits ?? 1,
    firstSeenAt: "",
    lastSeenAt: "",
  };
}

function mapOf(rooms: MapRoom[], redirects: Record<string, string> = {}): WorldMap {
  const map = WorldMap.empty("t");
  map.doc.planes.p1 = { id: "p1", kind: "surface", createdAt: "" };
  for (const r of rooms) map.doc.rooms[r.id] = r;
  map.doc.redirects = { ...redirects };
  map.reindex();
  return map;
}

test("descriptionCoresOverlap: rooms sharing boilerplate prose but a different last line are different rooms", () => {
  const BOILER = "You are in Kalinport's merchant section, called the Merchant's Diamond.  The name of the area comes from the shape of the bartering and dealing center of Kalinport: A diamond.  The Diamond is filled with merchants of various types.";
  const garnet = normalizeDescription(`${BOILER}  You are on Garnet Street, just east of a guard's station.`);
  const oasis = normalizeDescription(`${BOILER}  Oasis Avenue ends its southward trek here, but does continue to the north.`);
  assert.equal(descriptionCoresOverlap(garnet, oasis), false);
  // …while a cut-off or flavor-prefixed view of one of them still matches it.
  assert.equal(descriptionCoresOverlap(oasis, normalizeDescription(`The moon rises.\n${BOILER}  Oasis Avenue ends its southward`)), true);
});

test("descriptionCoresOverlap: prefixed and truncated views of one room agree; different rooms do not", () => {
  const full = normalizeDescription(CAVE);
  const mangled = normalizeDescription("pitiful body. " + CAVE.replace(" You hit your head on a stalactite!", ""));
  assert.equal(descriptionCoresOverlap(full, mangled), true);
  assert.equal(descriptionCoresOverlap(full, normalizeDescription(FOREST)), false);
  assert.equal(descriptionCoresOverlap("short room", "a short room here"), false, "short text is never enough");
});

test("heal merges a prefixed/truncated duplicate sharing a cell and a confirmed exit", () => {
  const map = mapOf([
    room("r1", 0, ["s", "w"], { s: link("r3") }, { description: CAVE, visits: 9 }),
    room("r2", 0, ["s", "w"], { s: link("r3") }, { description: "pitiful body. " + CAVE.replace(" You hit your head on a stalactite!", "") }),
    room("r3", 0, ["n"], { n: link("r1") }, { pos: { plane: "p1", x: 0, y: -1, z: 0 }, description: FOREST }),
  ]);
  const rep = map.heal();
  assert.ok(rep.merged >= 1);
  assert.equal(map.doc.rooms.r2, undefined);
  assert.equal(map.canonicalId("r2"), "r1");
});

test("heal merges an agent-retitled room with its game-titled copy and keeps the old title as an alias", () => {
  const map = mapOf([
    room("r277", 0, ["n", "s"], { n: link("r9"), s: link("r8") }, { title: "secret tunnel", description: CAVE, visits: 5 }),
    room("r512", 0, ["n", "s"], { n: link("r9") }, { title: "Dark Tunnel", description: CAVE }),
    room("r9", 0, ["s"], { s: link("r277") }, { pos: { plane: "p1", x: 0, y: 1, z: 0 }, description: FOREST }),
    room("r8", 0, ["n"], { n: link("r277") }, { pos: { plane: "p1", x: 0, y: -1, z: 0 } }),
  ]);
  map.heal();
  const keep = map.room("r277")!;
  assert.equal(map.doc.rooms.r512, undefined);
  assert.ok(map.titleMatches(keep, "Dark Tunnel"));
  assert.ok(map.titleMatches(keep, "secret tunnel"));
});

test("heal leaves look-alike rooms with different exits alone (uniform forest/desert)", () => {
  const map = mapOf([
    room("a", 0, ["n", "s"], { n: link("c") }, { description: FOREST }),
    room("b", 0, ["n", "se"], { n: link("c") }, { description: FOREST }),
    room("c", 0, ["s", "n"], { s: link("a") }, { pos: { plane: "p1", x: 0, y: 1, z: 0 }, description: FOREST + " x" }),
  ]);
  map.heal();
  assert.ok(map.room("a") && map.room("b"));
});

test("heal resolves a reverse conflict when the prose proves both ends are one room", () => {
  const map = mapOf([
    room("a", 0, ["n", "e"], { n: link("b") }, { description: CAVE, visits: 4 }),
    room("b", 0, ["s"], { s: link("c") }, { pos: { plane: "p1", x: 0, y: 1, z: 0 }, description: FOREST }),
    room("c", 5, ["n", "e"], { n: link("b") }, { pos: { plane: "p1", x: 5, y: 5, z: 0 }, description: CAVE }),
  ]);
  map.heal();
  const kept = map.canonicalId("a");
  assert.equal(map.canonicalId("c"), kept, "both ends resolve to one room");
  assert.equal(map.room("b")!.links.s!.to, kept);
  assert.equal(map.room(kept!)!.links.n!.to, "b");
});

test("pruneRedirects drops dangling redirects and flattens chains", () => {
  const map = mapOf([room("a", 0, [], {})], { x: "gone", y: "z", z: "a" });
  map.pruneRedirects();
  assert.equal(map.doc.redirects!.x, undefined);
  assert.equal(map.doc.redirects!.y, "a");
  assert.equal(map.canonicalId("y"), "a");
});

test("heal registers a plane that rooms use but the plane list lost", () => {
  const map = mapOf([room("a", 0, ["n"], {}, { pos: { plane: "p20", x: 0, y: 0, z: 0 }, description: CAVE })]);
  const rep = map.heal();
  assert.equal(rep.planesRegistered, 1);
  assert.ok(map.doc.planes.p20);
  assert.ok(map.doc.nextPlane > 20);
});

test("heal removes a named command recorded as leading back into its own room", () => {
  const map = mapOf([room("a", 0, ["n"], { gate: link("a", { kind: "special" }) }, { description: CAVE })]);
  map.heal();
  assert.equal(map.room("a")!.links.gate, undefined);
});

test("findPath honors avoidLinks and routes around a failed exit", () => {
  const map = mapOf([
    room("a", 0, ["e", "n"], { e: link("b"), n: link("c") }),
    room("b", 1, ["w"], { w: link("a") }),
    room("c", 0, ["s", "e"], { s: link("a"), e: link("d") }, { pos: { plane: "p1", x: 0, y: 1, z: 0 } }),
    room("d", 1, ["s", "w"], { s: link("b"), w: link("c") }, { pos: { plane: "p1", x: 1, y: 1, z: 0 } }),
  ]);
  assert.deepEqual(map.findPath("a", (r) => r.id === "b")!.map((s) => s.cmd), ["e"]);
  assert.deepEqual(map.findPath("a", (r) => r.id === "b", { avoidLinks: ["a:e"] })!.map((s) => s.cmd), ["n", "e", "s"]);
  assert.equal(map.findPath("a", (r) => r.id === "b", { avoidLinks: ["a:e", "a:n"] }), null);
});

function grid(): WorldMap {
  return mapOf([
    room("a", 0, ["e", "n"], { e: link("b"), n: link("c") }),
    room("b", 1, ["w"], { w: link("a") }),
    room("c", 0, ["s", "e"], { s: link("a"), e: link("d") }, { pos: { plane: "p1", x: 0, y: 1, z: 0 } }),
    room("d", 1, ["s", "w"], { s: link("b"), w: link("c") }, { pos: { plane: "p1", x: 1, y: 1, z: 0 } }),
  ]);
}

test("walk recovery: a refused exit is avoided and the walk reroutes", () => {
  const map = grid();
  const avoid: string[] = [];
  const rec = recoverFromStepFailure(map, {
    fromId: "a", cmd: "e", expectedId: "b", hereId: "a", targetId: "b", why: "could not go e", avoidLinks: avoid, replans: 0, pathOpts: {},
  });
  assert.equal(rec.kind, "replan");
  assert.deepEqual(avoid, ["a:e"]);
  assert.deepEqual(rec.kind === "replan" && rec.path.map((s) => s.cmd), ["n", "e", "s"]);
});

test("walk recovery: lost asks for a look, at target is arrival, budget and dead ends fail cleanly", () => {
  const map = grid();
  const base = { fromId: "a", cmd: "e", expectedId: "b", targetId: "b", why: "x", pathOpts: {} };
  assert.equal(recoverFromStepFailure(map, { ...base, hereId: null, avoidLinks: [], replans: 0 }).kind, "relook");
  assert.equal(recoverFromStepFailure(map, { ...base, hereId: "b", avoidLinks: [], replans: 0 }).kind, "arrived");
  const spent = recoverFromStepFailure(map, { ...base, hereId: "a", avoidLinks: [], replans: MAX_WALK_REPLANS });
  assert.equal(spent.kind, "fail");
  const dead = recoverFromStepFailure(map, { ...base, hereId: "a", avoidLinks: ["a:n"], replans: 0 });
  assert.equal(dead.kind, "fail");
});

test("walk recovery: when the mapper already relinked the exit, it is not blacklisted", () => {
  const map = grid();
  map.room("a")!.links.e = link("c");
  const avoid: string[] = [];
  const rec = recoverFromStepFailure(map, {
    fromId: "a", cmd: "e", expectedId: "b", hereId: "c", targetId: "b", why: "expected b, now at c", avoidLinks: avoid, replans: 0, pathOpts: {},
  });
  assert.equal(rec.kind, "replan");
  assert.deepEqual(avoid, []);
});

test("an unmapped listed exit into a room known only by its prose joins the two map pieces", async () => {
  const { GameStream } = await import("../game/stream.js");
  const { Mapper } = await import("./Mapper.js");
  const SHACKS = "This is the poor section of Kalinport.  Barely-standing shacks and pitiful tents are all around you, serving as homes for the poor citizens of Kalinport.";
  const MID = `${SHACKS}  You are on Quark Road, right between two intersections, one with Dune Avenue to the north, and the other with Snake Street to the south.`;
  const CROSS = `${SHACKS}  Quark Road meets up with Snake Street here, which runs east and west.  Quark Road continues to the north and also south.`;
  const DUNE = "Dune Avenue runs east and west through a dusty market quarter, crowded with stalls selling dates, rope and lamp oil to travellers coming in off the deep desert sands.";
  const map = mapOf([
    room("r10", 0, ["s"], { s: link("r11") }, { description: DUNE, pos: { plane: "p1", x: 0, y: 1, z: 0 }, visits: 5 }),
    room("r11", 0, ["n", "s"], { n: link("r10") }, { description: MID, pos: { plane: "p1", x: 0, y: 0, z: 0 }, visits: 5 }),
    room("r20", 0, ["n", "s", "e", "w"], {}, { description: CROSS, pos: { plane: "p2", x: 0, y: 0, z: 0 }, visits: 5 }),
    // The rest of a big world: what makes a unique description worth re-localizing on.
    ...Array.from({ length: 400 }, (_, i) =>
      room(`r${100 + i}`, 10 + i, ["e", "w"], {}, { title: `Filler ${i}`, description: `Filler room number ${i} of a large world, ${"padding ".repeat(20)}` }),
    ),
  ]);
  map.doc.planes.p2 = { id: "p2", kind: "surface", createdAt: "" };
  const mapper = new Mapper(map);
  const stream = new GameStream();
  let t = 0;
  const step = (cmd: string | null, out: string) => {
    t += 500;
    if (cmd) mapper.onCommandSent(cmd, t);
    for (const ev of [...stream.feed(out), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  const show = (desc: string, exits: string) => `${desc}\n\nThe moon is at Arrival.\n\nThe only obvious exits are : ${exits}.  \nThere is one Beggar.\n[HP:98 SP:50][HP:98 SP:50]\n`;
  step("look", show(DUNE, "south"));
  assert.equal(mapper.current()?.id, "r10");
  step("s", show(MID, "north and south"));
  assert.equal(mapper.current()?.id, "r11");
  step("s", show(CROSS, "north, south, east, west"));
  assert.equal(mapper.current()?.id, "r20");
  assert.equal(map.canonicalId(map.room("r11")!.links.s?.to), "r20", "the walked exit is learned");
  assert.equal(map.room("r11")!.pos.plane, map.room("r20")!.pos.plane, "the two pieces now share a plane");
  step("n", show(MID, "north and south"));
  assert.equal(mapper.current()?.id, "r11");
});

test("connect keeps two layouts apart when overlaying them would stack different rooms", () => {
  const SAND = "You are standing somewhere in the Kalamshite Desert. Huge sand dunes are all around you, blocking your view somewhat.";
  const CITY = "This is the middle- and upper-class section of Kalinport. Most of the many buildings and homes have been well-constructed.";
  const map = mapOf([
    room("r1", 0, ["n", "s"], {}, { description: `${CITY} North gate.`, pos: { plane: "p1", x: 0, y: 0, z: 0 } }),
    room("r2", 0, ["n", "s"], {}, { description: `${CITY} Market lane.`, pos: { plane: "p1", x: 0, y: -1, z: 0 } }),
    room("r3", 0, ["n", "s"], {}, { description: `${SAND} Dune one.`, pos: { plane: "p2", x: 0, y: 0, z: 0 } }),
    room("r4", 0, ["n", "s"], {}, { description: `${SAND} Dune two.`, pos: { plane: "p2", x: 0, y: 1, z: 0 } }),
  ]);
  map.doc.planes.p2 = { id: "p2", kind: "surface", createdAt: "" };
  // r1 n → r4 would put r3 onto r2's cell.
  const merged = map.connect(map.room("r1")!, "n", map.room("r4")!, { confirmed: true });
  assert.equal(merged, false);
  assert.equal(map.room("r1")!.links.n?.to, "r4", "the link is still recorded");
  assert.equal(map.room("r4")!.pos.plane, "p2");
  // A clean fit still merges.
  const map2 = mapOf([
    room("r1", 0, ["n"], {}, { description: `${CITY} North gate.`, pos: { plane: "p1", x: 0, y: 0, z: 0 } }),
    room("r4", 0, ["s"], {}, { description: `${SAND} Dune two.`, pos: { plane: "p2", x: 5, y: 5, z: 0 } }),
  ]);
  map2.doc.planes.p2 = { id: "p2", kind: "surface", createdAt: "" };
  assert.equal(map2.connect(map2.room("r1")!, "n", map2.room("r4")!, { confirmed: true }), true);
  assert.deepEqual(map2.room("r4")!.pos, { plane: "p1", x: 0, y: 1, z: 0 });
});

test("a second room with the same prose, reached from a room we are sure of, is a twin, not a teleport", async () => {
  const { GameStream } = await import("../game/stream.js");
  const { Mapper } = await import("./Mapper.js");
  const UPPER = "This is the middle- and upper-class section of Kalinport.  Most of the many buildings and homes have been well-constructed using the finest of materials.";
  const AVE = `${UPPER}  You are travelling along Oasis Avenue, one of the more well-used roads in the northwest section of Kalinport.`;
  const CROSS = `${UPPER}  You are at an intersection between Oasis Avenue, which travels north and south, and Amarat Road, which heads to the southwest.`;
  const VEDNY = `${UPPER}  You are at an intersection between Vedny Road and Oasis Avenue.  Vednyr Road leads west and is home to the richest people in Kalinport.`;
  const map = mapOf([
    room("r1", 0, ["n", "s", "sw"], { n: link("r2") }, { description: CROSS, pos: { plane: "p1", x: 0, y: 0, z: 0 }, visits: 5 }),
    room("r2", 0, ["n", "s"], { s: link("r1"), n: link("r3") }, { description: AVE, pos: { plane: "p1", x: 0, y: 1, z: 0 }, visits: 5 }),
    room("r3", 0, ["n", "s", "w"], { s: link("r2") }, { description: VEDNY, pos: { plane: "p1", x: 0, y: 2, z: 0 }, visits: 5 }),
    ...Array.from({ length: 400 }, (_, i) =>
      room(`r${100 + i}`, 10 + i, ["e", "w"], {}, { title: `Filler ${i}`, description: `Filler room number ${i} of a large world, ${"padding ".repeat(20)}` }),
    ),
  ]);
  const mapper = new Mapper(map);
  const stream = new GameStream();
  let t = 0;
  const step = (cmd: string | null, out: string) => {
    t += 500;
    if (cmd) mapper.onCommandSent(cmd, t);
    for (const ev of [...stream.feed(out), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  const show = (desc: string, exits: string) => `${desc}\n\nThe only obvious exits are : ${exits}.  \n[HP:98 SP:50]\n`;
  step("look", show(CROSS, "north, south, southwest"));
  step("n", show(AVE, "north and south"));
  assert.equal(mapper.current()?.id, "r2");
  step("n", show(VEDNY, "north, south, west"));
  assert.equal(mapper.current()?.id, "r3");
  step("n", show(AVE, "north and south"));
  const twin = mapper.current()!;
  assert.notEqual(twin.id, "r2", "the block north of Vedny is not the block south of it");
  assert.equal(map.room("r3")!.links.n?.to, twin.id);
  assert.equal(map.room("r2")!.links.n?.to, "r3", "the original block keeps its own links");
  step("s", show(VEDNY, "north, south, west"));
  assert.equal(mapper.current()?.id, "r3");
});

test("a named command that drops us into a known room elsewhere is learned as a secret exit", async () => {
  const { GameStream } = await import("../game/stream.js");
  const { Mapper } = await import("./Mapper.js");
  const POOR = "This is the poor section of Kalinport.  Barely-standing shacks and pitiful tents are all around you, serving as homes for the poor citizens of Kalinport.";
  const AVE = `${POOR}  You are on Dune Avenue, which is running east and west.  The road looks like it comes to an end to the east.`;
  const END = `${POOR}  Dune Avenue stops here, right up against a large sand-colored building.  There is a small manhole in the street, right in front of you.`;
  const TUNNEL = "You are in a small tunnel, right below a manhole.  The manhole is about five feet above your head, but there are cuts in the wall that should allow you to go up with no problem.";
  const map = mapOf([
    room("r1", 0, ["e", "w"], { e: link("r2") }, { description: AVE, pos: { plane: "p1", x: 0, y: 0, z: 0 }, visits: 5 }),
    room("r2", 0, ["w"], { w: link("r1") }, { description: END, pos: { plane: "p1", x: 1, y: 0, z: 0 }, visits: 5 }),
    room("r3", 0, ["n", "u"], {}, { description: TUNNEL, pos: { plane: "p2", x: 0, y: 0, z: 0 }, visits: 5 }),
    ...Array.from({ length: 400 }, (_, i) =>
      room(`r${100 + i}`, 10 + i, ["e", "w"], {}, { title: `Filler ${i}`, description: `Filler room number ${i} of a large world, ${"padding ".repeat(20)}` }),
    ),
  ]);
  map.doc.planes.p2 = { id: "p2", kind: "surface", createdAt: "" };
  const mapper = new Mapper(map);
  const stream = new GameStream();
  let t = 0;
  const step = (cmd: string | null, out: string) => {
    t += 500;
    if (cmd) mapper.onCommandSent(cmd, t);
    for (const ev of [...stream.feed(out), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  const show = (desc: string, exits: string) => `${desc}\n\nThe only obvious exits are : ${exits}.  \n[HP:98 SP:50]\n`;
  step("look", show(AVE, "east and west"));
  step("e", show(END, "west"));
  assert.equal(mapper.current()?.id, "r2");
  step("down the manhole", `You lift up the manhole and climb down quickly to the semi-darkness below.\n${show(TUNNEL, "north and up")}`);
  assert.equal(mapper.current()?.id, "r3");
  const learned = Object.entries(map.room("r2")!.links).find(([, l]) => l?.to === "r3");
  assert.ok(learned, `r2 learns the way down: ${JSON.stringify(map.room("r2")!.links)}`);
  step("u", show(END, "west"));
  assert.equal(mapper.current()?.id, "r2");
  assert.equal(map.canonicalId(map.room("r3")!.links.u?.to), "r2", "and the climb back up");
  // The manhole is the way down: no guessed `d` (r2 lists only west) for walks to trip over.
  assert.equal(map.room("r2")!.links.d?.to, undefined, `no inferred d: ${JSON.stringify(map.room("r2")!.links)}`);
});
