import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "../game/stream.js";
import { Mapper } from "./Mapper.js";
import { runSimulation, scoreSimulation } from "./simulate.js";
import { WorldMap } from "./WorldMap.js";

function harness() {
  const map = WorldMap.empty("test");
  const mapper = new Mapper(map);
  const stream = new GameStream();
  let t = 0;
  const step = (cmd: string | null, output: string) => {
    t += 100;
    if (cmd) for (const c of cmd.split(";")) mapper.onCommandSent(c, t);
    for (const ev of [...stream.feed(output), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  return { map, mapper, step, here: () => mapper.current()! };
}

const P = "[HP:100 SP:50]";

function room(map: WorldMap, title: string, exits: string[], x: number, plane = "p1") {
  const r = map.createRoom({ plane, x, y: 0, z: 0 });
  map.applyObservation(r, { mode: "brief", title, exits, contents: [] });
  return r;
}

test("heal drops newbie teleport links (homeland)", () => {
  const map = WorldMap.empty("t");
  const flax = room(map, "Flax bend", ["n", "w"], 0);
  const home = room(map, "Spruce", ["s"], 1);
  map.link(flax.id, "homeland", home.id, { kind: "special", confirmed: true, hidden: true });
  const report = map.heal();
  assert.equal(report.linksPruned, 1);
  assert.equal(flax.links.homeland, undefined);
});

test("heal drops links on exits the room does not have, but keeps secret and door exits", () => {
  const map = WorldMap.empty("t");
  const a = room(map, "Lair", ["w", "out"], 0);
  const b = room(map, "Inner lair", ["e"], -1);
  map.link(a.id, "e", b.id, { kind: "dir", confirmed: true }); // misattributed move
  map.link(a.id, "w", b.id, { kind: "dir", confirmed: true });
  map.link(a.id, "pry floorboard", b.id, { kind: "special", confirmed: true, hidden: true });
  const door = room(map, "Tavern", ["s"], 5);
  door.tags.push("dynamic-exits");
  map.link(door.id, "d", b.id, { kind: "vertical", confirmed: true });
  const report = map.heal();
  assert.equal(report.linksPruned, 1);
  assert.equal(a.links.e, undefined);
  assert.ok(a.links.w && a.links["pry floorboard"] && door.links.d);
});

test("heal removes blank and disconnected copies, never the room we stand in", () => {
  const map = WorldMap.empty("t");
  const square = room(map, "Square", ["n", "e"], 0);
  const road = room(map, "Road", ["s"], 1);
  map.link(square.id, "e", road.id, { kind: "dir", confirmed: true });
  map.createRoom({ plane: "p9", x: 0, y: 0, z: 0 }); // placeholder nothing leads to
  const copy = room(map, "Square", ["n", "e"], 0, "p7"); // stranded duplicate on its own plane
  const here = map.createRoom({ plane: "p8", x: 0, y: 0, z: 0 });
  const report = map.heal({ protect: [here.id] });
  assert.equal(report.roomsRemoved, 2);
  assert.equal(map.room(copy.id)?.id, square.id, "the copy now resolves to the real room");
  assert.ok(map.room(here.id), "protected room survives");
  assert.equal(map.roomCount(), 3);
});

test("heal walks back in through a confirmed compass link the other room never listed", () => {
  const map = WorldMap.empty("t");
  const market = room(map, "Market", ["s", "w"], 0);
  const shop = room(map, "Shop", ["w"], 1);
  map.link(shop.id, "w", market.id, { kind: "dir", confirmed: true });
  assert.equal(map.findPath(market.id, (r) => r.id === shop.id), null);
  assert.ok(map.heal().linksStitched >= 1);
  assert.equal(market.links.e?.to, shop.id);
  assert.ok(map.findPath(market.id, (r) => r.id === shop.id));
  map.heal();
  assert.equal(market.links.e?.to, shop.id, "the unlisted return survives another heal");
});

test("heal joins an adjacent exit when the neighbor's list omitted the way back", () => {
  const map = WorldMap.empty("t");
  const shore = room(map, "North shore", ["w", "e", "s", "se"], 0);
  const rocks = room(map, "Rocky shore", ["ne", "sw", "se"], 1);
  map.setPos(rocks, { plane: shore.pos.plane, x: 1, y: 1, z: 0 });
  assert.equal(map.heal().linksStitched, 1);
  assert.equal(rocks.links.sw?.to, shore.id);
  assert.equal(shore.links.ne?.to, rocks.id);
  assert.ok(map.findPath(shore.id, (r) => r.id === rocks.id));
  map.heal();
  assert.equal(shore.links.ne?.to, rocks.id, "the omitted reverse survives another heal");
});

test("heal does not stitch a ghost that shares a cell into the room south of it", () => {
  const map = WorldMap.empty("t");
  const market = room(map, "Market", ["s", "w", "se"], 0);
  const shop = room(map, "Shop", ["w"], 1);
  const ghost = room(map, "Market", ["s", "w", "se"], 2);
  const below = room(map, "Road", ["e"], 3);
  const plane = market.pos.plane;
  map.setPos(market, { plane, x: 0, y: 1, z: 0 });
  map.setPos(shop, { plane, x: 1, y: 1, z: 0 });
  map.setPos(ghost, { plane, x: 1, y: 1, z: 0 });
  map.setPos(below, { plane, x: 1, y: 0, z: 0 });
  map.link(shop.id, "w", market.id, { kind: "dir", confirmed: true });
  map.heal();
  assert.equal(ghost.links.s?.to, undefined);
  assert.equal(below.links.n, undefined);
  assert.equal(market.links.e?.to, shop.id);
});

test("heal joins unexplored exits that face an adjacent room listing the way back", () => {
  const map = WorldMap.empty("t");
  const a = room(map, "West Yard", ["e"], 0);
  const b = room(map, "East Yard", ["w"], 1);
  assert.equal(map.heal().linksStitched, 1);
  assert.equal(a.links.e?.to, b.id);
  assert.equal(b.links.w?.to, a.id);
  assert.equal(a.links.e?.confirmed, false, "stitched links stay inferred until walked");
});

test("heal folds open and closed copies of a door room into one", () => {
  const map = WorldMap.empty("t");
  const text = (state: string) =>
    `You are standing just southwest from a large gray tower. The trail continues to the north towards the shore.\nThere is a stone door leading northeast ( ${state} ).`;
  const closed = map.createRoom({ plane: "p0", x: 0, y: 0, z: 0 });
  const open = map.createRoom({ plane: "p0", x: 2, y: 0, z: 0 });
  const tower = map.createRoom({ plane: "p0", x: 1, y: 1, z: 0 });
  const legacy = text("CLOSED").toLowerCase().replace(/\s+/g, " ").trim().slice(-80);
  assert.match(legacy, /\( closed \)/);
  closed.description = text("CLOSED");
  closed.descKeys = [legacy];
  closed.exits = ["n", "sw"];
  map.setPos(closed, { ...closed.pos });
  assert.equal(
    map.findByObservation({
      mode: "verbose",
      description: text("OPENED"),
      exits: ["n", "sw", "ne"],
      contents: [],
    }).room?.id,
    closed.id,
  );

  map.applyObservation(open, {
    mode: "verbose",
    description: text("OPENED"),
    exits: ["n", "sw", "ne"],
    contents: [],
    doors: [{ name: "stone door", direction: "ne", state: "open" }],
  });
  map.setPos(open, { ...closed.pos });
  map.link(open.id, "ne", tower.id, { kind: "dir", confirmed: true });

  const report = map.heal();
  assert.ok(report.merged >= 1);
  assert.equal(map.room(open.id)?.id, closed.id);
  const here = map.room(closed.id)!;
  assert.ok(here.exits.includes("ne"));
  assert.equal(here.links.ne?.to, tower.id);
  assert.deepEqual(here.links.ne?.pre, ["open door"]);
  assert.equal(here.doors?.[0]?.state, "closed");
});

test("a door command marks the room so its changing exit list stays one room", () => {
  const h = harness();
  h.step(null, `Tavern (s)\n${P}`);
  const tavern = h.here();
  h.step("open door", `You open the trapdoor.\n${P}`);
  h.step("d", `Tavern Cellar (u)\n${P}`);
  h.step("u", `Tavern (s, d)\n${P}`);
  assert.equal(h.here().id, tavern.id);
  assert.ok(tavern.tags.includes("dynamic-exits"));
  assert.equal(h.map.roomCount(), 2);
});

test("an unannounced move into a known neighbor follows the link instead of relocating", () => {
  const h = harness();
  h.step(null, `River Bank (e, w)\n${P}`);
  h.step("e", `Ford (w, e)\n${P}`);
  const ford = h.here();
  h.step("w", `River Bank (e, w)\n${P}`);
  h.step(null, `The current drags you east!\nFord (w, e)\n${P}`);
  assert.equal(h.here().id, ford.id);
  assert.equal(h.map.roomCount(), 2);
});

test("a new corridor that looks like a known one is not folded into it", () => {
  const h = harness();
  h.step(null, `Gate (s)\n${P}`);
  for (let i = 0; i < 8; i++) h.step("s", `Hall (n, s)\n${P}`);
  h.step("s", `End (n)\n${P}`);
  const known = new Set(h.map.rooms().map((r) => r.id));
  h.step("recall", `You pray and are whisked away.\nShrine (s)\n${P}`);
  for (let i = 0; i < 8; i++) h.step("s", `Hall (n, s)\n${P}`);
  h.step("s", `Pit (n)\n${P}`);
  h.mapper.heal();
  assert.equal(h.map.roomCount(), 20);
  assert.ok(!known.has(h.here().id));
});

test("simulated world: clean walks map accurately, warped exits are learned", () => {
  const run = runSimulation({ seed: 1, steps: 3000 });
  const s = scoreSimulation(run);
  assert.ok(s.positionAccuracy >= 0.93, `position accuracy ${s.positionAccuracy}`);
  assert.ok(s.mapRooms <= s.trueRooms * 1.25, `${s.mapRooms} map rooms for ${s.trueRooms}`);
  assert.ok(s.conflated <= 3, `${s.conflated} conflated`);
  assert.ok(s.linksWrong <= 8, `${s.linksWrong} wrong links of ${s.linksCorrect + s.linksWrong}`);
  // The summit's `d` drops back into town: it must lead to the known harbor corner.
  const repOf = (truth: string) => {
    const n = new Map<string, number>();
    for (const t of run.trace) if (t.truth === truth && t.at) n.set(run.map.canonicalId(t.at)!, (n.get(run.map.canonicalId(t.at)!) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const summit = run.map.room(repOf("summit"));
  assert.equal(run.map.canonicalId(summit?.links.d?.to), repOf("t6_6"));
});

test("simulated world: unannounced moves and lost displays are recovered from", () => {
  for (const opts of [{ driftRate: 0.01 }, { dropRate: 0.03 }]) {
    const s = scoreSimulation(runSimulation({ seed: 2, steps: 3000, ...opts }));
    const floor = "driftRate" in opts ? 0.9 : 0.72;
    assert.ok(s.positionAccuracy >= floor, `${JSON.stringify(opts)}: position accuracy ${s.positionAccuracy}`);
  }
});

test("a named command that redisplays the same room is not recorded as a self-link", () => {
  const h = harness();
  const desc = "A massive iron gate set into the old city wall blocks the road here, its bars rusted and bent by\nyears of weather. Guards once stood watch, but the post is empty now and the road runs on.\nThe only obvious exits are : north and south.";
  h.step("look", `${desc}\n${P}`);
  const gate = h.here();
  h.step("gate", `${desc}\n${P}`);
  assert.equal(h.here().id, gate.id);
  assert.equal(h.map.room(gate.id)!.links.gate, undefined);
  assert.equal(h.map.roomCount(), 1);
});

test("homeland teleports without creating a map link", () => {
  const h = harness();
  const flaxDesc =
    "The flax makes a sharp bend here, giving you the options of heading only north or west.\nThe only obvious exits are : north and west.";
  const kalDesc =
    "This is the poor section of Kalinport. Barely-standing shacks line the road.\nThe only obvious exits are : north and south.";
  h.step("look", `${flaxDesc}\n${P}`);
  const flax = h.here();
  h.step(
    "homeland",
    `You vanish and then instantly appear in your homeland.\n${kalDesc}\n${P}`,
  );
  assert.notEqual(h.here().id, flax.id);
  assert.equal(h.map.room(flax.id)!.links.homeland, undefined);
});
