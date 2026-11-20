import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "../game/stream.js";
import { Mapper } from "./Mapper.js";
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
const ROAD =
  "You are standing upon the Dulaj Road, which originates from the city of\nDeepwater and runs east through the Plains of Nereka.  Directly south from\nhere is the long caravan route to Kalinport, the desert city on the southern\ntip of the continent.  Dulaj Road continues to the east.";
const CARAVAN =
  "The caravan route between Kalinport and Deepwater is long and full of danger.\nBandits have been known to swoop down on a caravan and rob them blind, sometimes\neven killing them after the fact.  One must be cautious travelling this road.\nThe plains are all around you, going on and on for miles.  Way off to the east\nyou can spot a large castle.";
const room = (desc: string, exits: string) => `${desc}\nThe only obvious exits are : ${exits}.\n${P}`;

test("identical prose with a different exit list is the next room, not the one we left (caravan route r11918)", () => {
  const h = harness();
  h.step(null, room(ROAD, "south, east, west"));
  const road = h.here();
  h.step("s", room(CARAVAN, "north and south"));
  const a = h.here();
  // The route bends off the grid: a plains room is already charted on the tile south of it.
  const plains = h.map.createRoom(h.map.expectedPos(a, "s")!);
  h.map.applyObservation(plains, {
    mode: "verbose",
    description: "You are standing in the Plains of Nereka.  The Plains stretch on for miles\nin every direction, an ocean of grass waving gently in the breeze.",
    exits: ["n", "s", "e", "w"],
    contents: [],
  });
  h.step("s", room(CARAVAN, "north and southeast"));
  const b = h.here();
  assert.notEqual(b.id, a.id, "a different exit list after a listed move is a new room");
  assert.deepEqual([...h.map.room(a.id)!.exits].sort(), ["n", "s"], "the room we left keeps its own exits");
  h.step("se", room(CARAVAN, "northwest and south"));
  const c = h.here();
  assert.notEqual(c.id, b.id);
  assert.notEqual(c.id, a.id);
  h.step("nw", room(CARAVAN, "north and southeast"));
  assert.equal(h.here().id, b.id, "walking back finds the room we came from");
  h.step("n", room(CARAVAN, "north and south"));
  assert.equal(h.here().id, a.id);
  h.step("n", room(ROAD, "south, east, west"));
  assert.equal(h.here().id, road.id);
});

const INTERSECTION =
  "You are at the intersection of Waterside Road and Commerce Way.  The north and\nsouth road, Waterside Road, runs all the way through the southern section of\nthe city and all the way to the city docks, which are just north of here.";
const WATERSIDE =
  "Waterside Road is running north towards the docks and also south towards the\nsouth portion of Deepwater.  Off to the west is a large body of water,\npresumably the Sea of Honshale.";
const DOCKS =
  "You are standing on the southern end of the city docks.  The docks stretch\nout over the Bay of Aurel, which is ahead to the north and west of you.";

test("a link whose far room the display keeps contradicting is re-pointed on the second arrival (Deepwater r2217 s)", () => {
  const h = harness();
  h.step(null, room(INTERSECTION, "north, south, east"));
  const inter = h.here();
  // Charted off the grid (a bent road), and both ends wired to a docks room by an old mistake.
  const at = (dx: number, dy: number) => ({ ...inter.pos, x: inter.pos.x + dx, y: inter.pos.y + dy });
  const waterside = h.map.createRoom(at(4, -6));
  h.map.applyObservation(waterside, { mode: "verbose", description: WATERSIDE, exits: ["n", "s"], contents: [] });
  const docks = h.map.createRoom(at(9, 3));
  h.map.applyObservation(docks, { mode: "verbose", description: DOCKS, exits: ["n", "s"], contents: [] });
  h.map.link(inter.id, "s", docks.id, { kind: "dir", confirmed: true });
  h.map.link(waterside.id, "n", docks.id, { kind: "dir", confirmed: true });

  h.step("s", room(WATERSIDE, "north and south"));
  assert.equal(h.here().id, waterside.id, "the display places us on Waterside Road");
  h.step("n", room(INTERSECTION, "north, south, east"));
  assert.equal(h.here().id, inter.id);
  assert.equal(h.map.room(inter.id)!.links.s?.to, docks.id, "one contradiction does not rewrite the link");

  h.step("s", room(WATERSIDE, "north and south"));
  h.step("n", room(INTERSECTION, "north, south, east"));
  assert.equal(h.map.room(inter.id)!.links.s?.to, waterside.id, "the same room twice re-points it");
  assert.equal(h.map.room(waterside.id)!.links.n?.to, inter.id, "and the way back too");
  assert.equal(h.map.room(inter.id)!.links.s?.contested, undefined);
});
