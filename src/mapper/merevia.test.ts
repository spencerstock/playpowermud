/**
 * Merevia, replayed from Wybie's first walk there (2026-11-03). Its forest trails bend: the
 * grid the mapper lays out stacks the grasslands over the forest paths and puts the spring
 * nowhere near the junction it opens onto.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "../game/stream.js";
import { Mapper } from "./Mapper.js";
import { WorldMap } from "./WorldMap.js";

const P = "[HP: 467(753(62%)) SP: 212(220(96%)) XP: 30192(1808(90%)) Cash: 33330(22130)]";

function harness() {
  const map = WorldMap.empty("powermud");
  const mapper = new Mapper(map);
  if (process.env.MDBG) mapper.debug = (m) => console.log("dbg", m);
  mapper.on((ev) => process.env.MDBG && console.log("ev", JSON.stringify(ev)));
  const stream = new GameStream();
  let t = 0;
  const step = (cmd: string | null, output: string) => {
    t += 1000;
    if (cmd) mapper.onCommandSent(cmd, t);
    for (const ev of [...stream.feed(`${output}\n${P}\n`), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  return { map, mapper, step, here: () => mapper.current()! };
}

const BROOK = `The brook comes incredibly close to you here, about ten feet away from you, 
but unfortunately you can't get to it.  There are many trees around you as 
well as the brook.  There isn't anything else around that really draws you're 
attention except for the path your walking on.  This part of the path seems 
to have been travelled on quite a bit.  It continues towards the east and the 
west.  
The only obvious exits are : west and east.
  `;

const SPRING = `You come to see a quite large spring coming out of the ground feeding a small 
forest brook that looks very beautiful.  All the trees around you don't allow 
you to leave the path, but you can follow the brook to the west, or continue 
towards the east where it looks like it has been travelled on significantly 
more.  
The only obvious exits are : west and east.
  
There is one Forest squirrel.`;

const JUNCTION = `Here there are three different ways to travel.  A couple other small trails 
merge here taking you in different directions.  The trees are extremely thick 
here, and it is getting quite dark.  The paths lead to the west, east, and 
north.  Towards the east it looks like that has been travelled a lot, while 
the northern part doesn't look like people travel that way very often.  
The only obvious exits are : west, east, north.  `;

const GRASSLAND = `You are walking through the rich and fertile plains of Merevia.  The thick 
grass that surrounds you sways gently in the breeze.  
The only obvious exits are : north, south, east, west, northeast, northwest, southeast, southwest.
  `;

test("a bent trail is linked by its exits, not relocated forever (spring e → junction)", () => {
  const { map, mapper, step, here } = harness();
  step("l", JUNCTION);
  const junction = here();
  mapper.setPosition(null);
  step("l", BROOK);
  const brook = here();
  step("e", SPRING);
  const spring = here();
  // Lay the trail out far from the junction on the same plane, as Merevia's grid did.
  const plane = junction.pos.plane;
  map.setPos(brook, { plane, x: 6, y: -3, z: 0 });
  map.setPos(spring, { plane, x: 7, y: -3, z: 0 });
  // Pace the known stretch until the mapper is sure where it stands.
  for (let i = 0; i < 7; i++) {
    step("w", BROOK);
    step("e", SPRING);
  }
  assert.equal(here().id, spring.id);
  step("e", JUNCTION);
  assert.equal(here().id, junction.id, "the junction is the room we know");
  assert.equal(map.room(spring.id)!.links.e?.to, junction.id, "and the spring's east exit now leads there");
  assert.equal(map.room(junction.id)!.links.w?.to, spring.id);
  // Walking it again is an ordinary step, not another relocation.
  const moves: string[] = [];
  mapper.on((ev) => {
    if (ev.type === "moved") moves.push(ev.how);
  });
  step("w", SPRING);
  step("e", JUNCTION);
  assert.deepEqual(moves, ["exit", "exit"]);
});

test("a junction that already leads back elsewhere is not rewired by a bent step", () => {
  const { map, mapper, step, here } = harness();
  step("l", JUNCTION);
  const junction = here();
  step("w", BROOK);
  const brookWest = here();
  mapper.setPosition(null);
  step("l", SPRING);
  const spring = here();
  map.setPos(spring, { plane: junction.pos.plane, x: 9, y: 9, z: 0 });
  step("e", JUNCTION);
  assert.equal(map.room(junction.id)!.links.w?.to, brookWest.id);
  assert.notEqual(map.room(spring.id)?.links.e?.to, junction.id);
});

test("heal does not stitch a grassland's eight ways into a forest path that lists only w and e", () => {
  const { map, mapper, step, here } = harness();
  step("l", GRASSLAND);
  const grass = here();
  mapper.setPosition(null);
  step("l", SPRING);
  const path = here();
  // The grid puts the forest path r4812 right southwest of grassland r5004.
  map.setPos(path, { plane: grass.pos.plane, x: grass.pos.x - 1, y: grass.pos.y - 1, z: 0 });
  map.heal();
  assert.equal(map.room(grass.id)!.links.sw?.to, undefined, "no sw link into the path");
  assert.equal(map.room(path.id)!.links.ne, undefined, "and no ne exit invented on the path");
});

const TRAINER = `This building houses the Profession trainer for this region.  The building is
not much to look at, but what the trainers provide is merely awesome.  The
walls of this place are bare, as you get the idea that not much goes into the
decor furnishing by the local inhabitants.
The only obvious exits are : east and west.
  
There is one Professions Trainer.`;

const KELTON_STREET = `You are on the cobbled streets of Kelton.  The street's stones were mined and 
layed by the dwarves residing here.  This part of the city is very busy with 
dwarves because of the bar to the northeast.  All the buildings around here 
are very low because of the dwarves fear of heights.  Towards the southeast 
you can faintly see the city's guard station.  
The only obvious exits are : north, south, east, northeast.  
There are a couple Dwarven citizens.`;

test("Kelton's Profession trainer is not Dunagin's: a word-for-word room on another continent stays apart", () => {
  const { map, mapper, step, here } = harness();
  step("l", TRAINER);
  const dunagin = here();
  mapper.setPosition(null);
  step("l", KELTON_STREET);
  const street = here();
  map.doc.planes[street.pos.plane]!.continent = "Merevia";
  step("e", TRAINER);
  assert.notEqual(here().id, dunagin.id, "a new room for Kelton's trainer");
  assert.equal(map.room(street.id)!.links.e?.to, here().id);
  assert.equal(map.room(dunagin.id)!.links.w, undefined, "Dunagin's trainer keeps its own west");
  assert.equal(map.continentOf(here().pos.plane), "Merevia");
  map.heal();
  assert.ok(map.room(dunagin.id) && map.room(here().id), "heal does not fold the twins together");
  assert.notEqual(map.canonicalId(dunagin.id), map.canonicalId(here().id));
});

test("aside planes inherit their continent", () => {
  const map = WorldMap.empty("t");
  const land = map.newPlane("surface", undefined, "Merevia");
  land.continent = "Merevia";
  const cave = map.newPlane("aside", { plane: land.id, fromRoom: "r0", via: "enter hole" });
  assert.equal(map.continentOf(cave.id), "Merevia");
  assert.equal(map.continentOf(map.newPlane("surface").id), undefined);
});

test("walking onto another piece of a continent keeps the continent's plane, name and mark", () => {
  const map = WorldMap.empty("t");
  const land = map.newPlane("surface", undefined, "Merevia");
  land.continent = "Merevia";
  const piece = map.newPlane("surface");
  const a = map.createRoom({ plane: land.id, x: 0, y: 0, z: 0 });
  a.exits = ["e"];
  const b = map.createRoom({ plane: piece.id, x: 5, y: 5, z: 0 });
  b.exits = ["w"];
  // Unmarked, the piece stays apart (a walking link never folds home into Merevia)...
  assert.equal(map.connect(a, "e", b, { confirmed: true }), false);
  assert.equal(b.pos.plane, piece.id);
  // ...once it is known to be Merevia too, the two pieces fold together.
  map.doc.planes[piece.id]!.continent = "Merevia";
  assert.equal(map.connect(a, "e", b, { confirmed: true }), true);
  assert.equal(b.pos.plane, land.id, "the continent's plane survives, whatever its id");
  assert.equal(map.doc.planes[land.id]?.label, "Merevia");
  assert.equal(map.continentOf(b.pos.plane), "Merevia");
});

test("a named plane id is kept over a numbered one", () => {
  const map = WorldMap.empty("t");
  map.doc.planes["p-merevia"] = { id: "p-merevia", kind: "surface", label: "Merevia", createdAt: "" };
  const a = map.createRoom({ plane: "p-merevia", x: 0, y: 0, z: 0 });
  const later = map.newPlane("surface");
  const b = map.createRoom({ plane: later.id, x: 3, y: 3, z: 0 });
  map.connect(b, "w", a, { confirmed: true });
  assert.equal(b.pos.plane, "p-merevia");
  assert.equal(map.doc.planes["p-merevia"]?.label, "Merevia");
});

test("heal does not reciprocate into a dead end whose exits line leaves out the way back", () => {
  // Merevia caves (live 2026-11-03): r4924 e→r4925 was walked, but r4925's display lists only
  // south. Every heal added r4925 w→r4924 anyway.
  const map = WorldMap.empty("powermud");
  map.doc.planes.p1 = { id: "p1", kind: "surface", createdAt: "t" };
  const hall = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  hall.description = "Down the western hallway you can see a glowing blue light.";
  hall.exits = ["e", "w"];
  const end = map.createRoom({ plane: "p1", x: 2, y: 0, z: 0 });
  end.description = "This small hallway has run into a dead end.";
  end.exits = ["s"];
  const shop = map.createRoom({ plane: "p1", x: 1, y: 1, z: 0 });
  shop.description = "A cramped shop.";
  shop.exits = [];
  map.link(hall.id, "e", end.id, { kind: "dir", confirmed: true });
  map.link(hall.id, "n", shop.id, { kind: "dir", confirmed: true });
  map.heal();
  assert.equal(map.room(end.id)!.links.w?.to, undefined);
  // A room that shows no compass exits (a shop) still gets its way back.
  assert.equal(map.room(shop.id)!.links.s?.to, hall.id);
});
