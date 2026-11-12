import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "../game/stream.js";
import { Mapper } from "./Mapper.js";
import { renderAscii } from "./render.js";
import { WorldMap } from "./WorldMap.js";

/** Drive the mapper the way the hub does: command sent, then MUD output with prompts. */
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

test("brief walk builds a grid with inferred reverse links", () => {
  const h = harness();
  h.step(null, `Town Square (n, s, e, w)\n${P}`);
  const square = h.here();
  h.step("n", `North Road (n, s)\n${P}`);
  assert.deepEqual(h.here().pos, { plane: square.pos.plane, x: 0, y: 1, z: 0 });
  assert.equal(h.here().links.s?.to, square.id, "reverse link inferred from listed exit");
  assert.equal(h.here().links.s?.confirmed, false);
  h.step("s", `Town Square (n, s, e, w)\n${P}`);
  assert.equal(h.here().id, square.id, "walking back follows the link");
  assert.equal(h.map.roomCount(), 2);
});

test("look in brief mode attaches the verbose description to the same room", () => {
  const h = harness();
  h.step(null, `Gateway Road (n, s)\n${P}`);
  const id = h.here().id;
  h.step("look", `A wide road leads north toward the gates of the city and south to the square.\nThe only obvious exits are : north and south.\n${P}`);
  assert.equal(h.here().id, id);
  assert.match(h.here().description ?? "", /gates of the city/);
  assert.equal(h.map.roomCount(), 1);
});

test("up/down change level; secret commands open an aside plane", () => {
  const h = harness();
  h.step(null, `Abandoned building (u, d)\n${P}`);
  const base = h.here();
  h.step("u", `Attic (d)\n${P}`);
  assert.equal(h.here().pos.z, 1);
  assert.equal(h.here().pos.plane, base.pos.plane);
  h.step("d", `Abandoned building (u, d)\n${P}`);
  assert.equal(h.here().id, base.id);
  h.step(
    "pry floorboard",
    `You succeed in prying up the floorboard and lower yourself into the tunnel.\nDark tunnel (s)\n${P}`,
  );
  const tunnel = h.here();
  assert.notEqual(tunnel.pos.plane, base.pos.plane, "secret exit lands on an aside plane");
  const link = h.map.room(base.id)!.links["pry floorboard"]!;
  assert.equal(link.kind, "special");
  assert.equal(link.hidden, true);
  assert.equal(h.map.doc.planes[tunnel.pos.plane]?.kind, "aside");
  assert.equal(h.map.doc.planes[tunnel.pos.plane]?.parent?.fromRoom, base.id);
  // Named obvious exits are "named" links and `out` returns to the room that led in.
  h.step(null, "");
  const swamp = h.here();
  h.step("lair", `Dragon's lair (w, out)\n${P}`);
  h.step("out", `Dark tunnel (s)\n${P}`);
  assert.equal(h.here().id, swamp.id);
});

test("an unlisted compass move that arrives stays on this plane and is linked both ways", () => {
  const h = harness();
  h.step(null, `Market (s, w)\n${P}`);
  const market = h.here();
  h.step("e", `Shop (w)\n${P}`);
  const shop = h.here();
  assert.equal(shop.pos.plane, market.pos.plane);
  assert.equal(shop.pos.x, market.pos.x + 1);
  assert.equal(market.links.e?.to, shop.id);
  assert.equal(shop.links.w?.to, market.id);
  assert.ok(h.map.findPath(market.id, (r) => r.id === shop.id));
});

test("failed moves do not move us and listed failures are counted without blocking", () => {
  const h = harness();
  h.step(null, `Gate (n, s)\n${P}`);
  const gate = h.here();
  h.step("n", `You cannot go that direction.\n${P}`);
  assert.equal(h.here().id, gate.id);
  assert.equal(gate.links.n?.failCount, 1);
  assert.equal(gate.links.n?.blocked, undefined);
  h.step("e", `You cannot go that direction.\n${P}`);
  assert.equal(gate.links.e, undefined, "unlisted failures are not recorded");
});

test("dizzy after a move follows the exit and does not block the room we left", () => {
  const h = harness();
  h.step(null, `Dock (s, e, island)\n${P}`);
  const dock = h.here();
  h.step("island", `Island dock (ne, mainland)\n${P}`);
  const island = h.here();
  h.step("mainland", `Dock (s, e, island)\n${P}`);
  assert.equal(h.here().id, dock.id);
  h.step("island", `You may get dizzy if you look around like that!\n${P}`);
  assert.equal(h.here().id, island.id, "the move landed; only the display was missed");
  assert.equal(dock.links.island?.blocked, undefined);
  assert.equal(island.dark, undefined, "a known room is not marked dark");
  h.step("s", `You cannot go that direction.\n${P}`);
  assert.equal(h.here().id, island.id);
  assert.equal(dock.links.s?.blocked, undefined, "the failure belongs to the island, which has no south");
});

const GLARE = "Your eyes sting from the blinding light, leaving you not able to see for a\nbrief moment.";
const BRIGHT_GLARE = "Your eyes sting from the bright light, and you are blinded for a moment!";

test("the blinding glare after a walked exit follows it; the next refusal is not charged to the room we left", () => {
  const h = harness();
  h.step(null, `Dulaj Road (e, w)\n${P}`);
  const road = h.here();
  h.step("w", `Intersection (n, s, e, w)\n${P}`);
  const inter = h.here();
  h.step("e", `${GLARE}\n${P}`);
  assert.equal(h.here().id, road.id, "the move landed; only the display was lost to the glare");
  assert.equal(road.dark, undefined, "a known room is not marked dark");
  h.step("e", `You cannot go that direction.\n${P}`);
  assert.equal(h.here().id, road.id);
  assert.equal(road.links.e?.failCount, 1, "the refusal belongs to the road");
  assert.equal(road.links.e?.blocked, undefined, "one refusal does not block the exit");
  assert.equal(inter.links.e?.failCount ?? 0, 0, "not charged to the intersection we already left");
  assert.equal(inter.links.e?.blocked, undefined);
});

test("goat-pen bright-light glare on a confirmed west follows the link and does not block it (r2768→r2767)", () => {
  const h = harness();
  h.step(null, `Pen mouth (e, w)\n${P}`);
  const mouth = h.here();
  h.step("e", `Pen end (w)\n${P}`);
  const end = h.here();
  assert.equal(end.links.w?.to, mouth.id);
  h.step("w", `${BRIGHT_GLARE}\n${P}`);
  assert.equal(h.here().id, mouth.id, "confirmed west still lands despite bright-light glare");
  assert.equal(end.links.w?.blocked, undefined, "glare must not mark the exit blocked");
  assert.equal(end.links.w?.failCount, undefined);
});

test("the blinding glare along an unwalked guess does not confirm it or blame the room we left (Deepwater r2183)", () => {
  const h = harness();
  h.step(null, `Dulaj Road (e, w)\n${P}`);
  h.step("w", `Intersection (n, s, e, w)\n${P}`);
  const inter = h.here();
  // A guess from the layout: the fish shop beside the intersection only opens east.
  const shop = h.map.createRoom(h.map.expectedPos(inter, "n")!);
  h.map.applyObservation(shop, { mode: "brief", title: "Fish shop", exits: ["e"], contents: [] });
  h.map.link(inter.id, "n", shop.id, { kind: "dir", confirmed: false });
  h.map.link(shop.id, "s", inter.id, { kind: "dir", confirmed: false });
  h.step("n", `${GLARE}\n${P}`);
  assert.equal(h.mapper.current(), undefined, "somewhere north, but not provably the shop");
  assert.equal(inter.links.n?.confirmed, false, "an unseen step never confirms a guessed link");
  h.step("e", `You cannot go that direction.\n${P}`);
  assert.equal(inter.links.e?.blocked, undefined, "the refusal is not charged to the intersection");
  assert.equal(shop.links.e?.blocked, undefined, "nor to the shop we never saw");
  h.step("n", `Waterside Road (n, s)\n${P}`);
  assert.ok(h.mapper.current(), "the next display places us again");
});

test("dark rooms become placeholders that later get filled in", () => {
  const h = harness();
  h.step(null, `Alley (sw, ne)\n${P}`);
  const alley = h.here();
  h.step("sw", `It is too dark.\n${P}`);
  const dark = h.here();
  assert.equal(dark.dark, true);
  h.step("ne", `Alley (sw, ne)\n${P}`);
  assert.equal(h.here().id, alley.id);
  h.step("sw", `Back room (ne)\n${P}`);
  assert.equal(h.here().id, dark.id, "coordinate match reuses the dark placeholder");
  assert.equal(h.here().dark, undefined);
  assert.equal(h.here().title, "Back room");
});

test("a fragment discovered while lost merges into the main layout", () => {
  const h = harness();
  h.step(null, `Unique Plaza (n, s)\n${P}`);
  const plaza = h.here();
  h.step("n", `Long Street (n, s)\n${P}`);
  const street = h.here();
  // Teleport somewhere unknown, then walk back into known territory from the other side.
  h.step("pray", `You reappear.\nField (e, w)\n${P}`);
  assert.notEqual(h.here().pos.plane, plaza.pos.plane);
  h.step("e", `Meadow (w, s)\n${P}`);
  h.step("s", `Long Street (n, s)\n${P}`); // ambiguous by title alone: new room
  h.step("s", `Unique Plaza (n, s)\n${P}`); // unique: verified via its north neighbor
  assert.equal(h.here().id, plaza.id);
  assert.equal(h.map.room(street.id)?.id, street.id);
  const planes = new Set(h.map.rooms().map((r) => r.pos.plane));
  assert.equal(planes.size, 1, "fragment plane aligned and merged");
  assert.equal(h.map.roomsWithTitle("Long Street").length, 1, "duplicate street collapsed");
});

test("pathfinding avoids blocked exits and danger, and renders a minimap", () => {
  const h = harness();
  h.step(null, `A (e, s)\n${P}`);
  const a = h.here();
  h.step("e", `B (w, s)\n${P}`);
  h.step("s", `C (n, w)\n${P}`);
  const c = h.here();
  h.step("w", `D (n, e)\n${P}`);
  h.step("n", `A (e, s)\n${P}`);
  assert.equal(h.here().id, a.id, "loop closes on coordinates");
  const path = h.map.findPath(a.id, (r) => r.id === c.id)!;
  assert.equal(path.length, 2);
  h.map.room(path[0]!.to)!.danger = 5;
  const safe = h.map.findPath(a.id, (r) => r.id === c.id, { maxDanger: 2 })!;
  assert.notEqual(safe[0]!.to, path[0]!.to);
  const ascii = renderAscii(h.map, a.id, { radius: 2 });
  assert.match(ascii, /\[@\]-\[o\]/);
});

test("speedwalk batches attribute rooms in order, skipping failures", () => {
  const h = harness();
  h.step(null, `Start (n)\n${P}`);
  h.step("n;n;e;n", `R1 (n, s)\n${P}R2 (s)\n${P}You cannot go that direction.\n${P}You cannot go that direction.\n${P}`);
  assert.equal(h.here().title, "R2");
  assert.equal(h.here().pos.y, 2);
});

test("consolidate merges duplicate chains but keeps uniform corridors", () => {
  const map = WorldMap.empty("t");
  const mk = (x: number, plane: string, title: string) => {
    const r = map.createRoom({ plane, x, y: 0, z: 0 });
    map.applyObservation(r, { mode: "brief", title, exits: ["e", "w"], contents: [] });
    return r;
  };
  const corridor = [0, 1, 2, 3].map((x) => mk(x, "p1", "Hall"));
  for (let i = 0; i < 3; i++) {
    map.link(corridor[i]!.id, "e", corridor[i + 1]!.id, { kind: "dir", confirmed: true });
    map.link(corridor[i + 1]!.id, "w", corridor[i]!.id, { kind: "dir", confirmed: true });
  }
  assert.equal(map.consolidate(), 0, "corridor rooms never share a same-direction neighbor");
  const dup = mk(9, "p2", "Hall");
  map.link(dup.id, "e", corridor[2]!.id, { kind: "dir", confirmed: true });
  assert.equal(map.consolidate(), 1);
  assert.equal(map.room(dup.id)?.id, corridor[1]!.id, "redirect resolves the merged id");
});

test("fresh-login relocation uses stationary contents to pick among identical rooms", () => {
  const h = harness();
  h.step(null, `Arena (n, s)\n${P}`);
  const a = h.here();
  h.step("n", `Arena (n, s)\nThere is one PowerMud Pete.\n${P}`);
  const pete = h.here();
  h.step("n", `Arena (n, s)\n${P}`);
  assert.notEqual(pete.id, a.id);
  // Reconnect: position is cleared by the login sequence, then the room is shown again.
  h.mapper.setPosition(null);
  h.step(null, `Arena (n, s)\nThere is one PowerMud Pete.\n${P}`);
  assert.equal(h.here().id, pete.id);
});

test("a closed door stays one room, and open door makes its exit usable", () => {
  const h = harness();
  const outside = (state: string) =>
    [
      "You are standing just southwest from a large gray tower. The trail continues",
      "to the southwest and also to the north towards the shore of the island.",
      `There is a stone door leading northeast ( ${state} ).`,
      "The only obvious exits are : north and southwest.",
      P,
    ].join("\n");
  h.step(null, `${outside("CLOSED")}\n`);
  const trail = h.here();
  assert.equal(trail.doors?.[0]?.state, "closed");
  assert.ok(trail.exits.includes("ne"));
  assert.deepEqual(trail.links.ne?.pre, ["open door"]);
  assert.ok(trail.tags.includes("dynamic-exits"));

  h.step("ne", `The stone door is closed.\n${P}`);
  assert.equal(h.here().id, trail.id);
  assert.equal(h.map.roomCount(), 1);

  h.step("open door", `You open the door.\n${P}`);
  assert.equal(h.here().id, trail.id);
  assert.equal(h.here().doors?.[0]?.state, "open");
  assert.equal(h.here().links.ne?.pre, undefined);
  assert.match(h.here().description ?? "", /OPENED/);

  h.step(
    "ne",
    [
      "You are standing on the ground floor of a large gray tower. Stairs lead up and down",
      "from this guard room, and racks of weapons line the walls beside the door.",
      "There is a stone door leading southwest ( OPENED ).",
      "The only obvious exits are : up, down and southwest.",
      P,
    ].join("\n") + "\n",
  );
  const tower = h.here();
  assert.notEqual(tower.id, trail.id);
  assert.equal(h.map.room(trail.id)!.links.ne?.to, tower.id);
  assert.equal(tower.links.sw?.pre, undefined);

  h.step("sw", `${outside("OPENED")}\n`);
  assert.equal(h.here().id, trail.id);
  assert.equal(h.map.roomCount(), 2);
  assert.equal(h.map.findPath(trail.id, (r) => r.id === tower.id)?.[0]?.pre, undefined);

  h.step("look", `${outside("CLOSED")}\n`);
  assert.equal(h.here().id, trail.id);
  assert.deepEqual(h.here().links.ne?.pre, ["open door"]);
  assert.deepEqual(h.map.findPath(trail.id, (r) => r.id === tower.id)?.[0]?.pre, ["open door"]);
});

test("bumping a locked door does not invent a room", () => {
  const h = harness();
  h.step(null, `Gatehouse (e)\n${P}`);
  const gate = h.here();
  h.step("n", `The wood door is locked.\n${P}`);
  assert.equal(h.here().id, gate.id);
  assert.equal(h.map.roomCount(), 1);
  assert.equal(h.here().doors?.[0]?.state, "locked");
  assert.equal(h.here().exits.includes("n"), false);
  assert.equal(h.here().links.n?.blocked?.reason, "locked");
});

test("merging duplicates cascades along their identical compass exits", () => {
  const map = WorldMap.empty("t");
  const mk = (title: string, plane: string, x: number) => {
    const r = map.createRoom({ plane, x, y: 0, z: 0 });
    map.applyObservation(r, { mode: "brief", title, exits: ["e", "w"], contents: [] });
    return r;
  };
  const [a1, b1] = [mk("Hub", "p1", 0), mk("Next", "p1", 1)];
  const [a2, b2] = [mk("Hub", "p2", 0), mk("Next", "p2", 1)];
  map.link(a1.id, "e", b1.id, { kind: "dir", confirmed: true });
  map.link(a2.id, "e", b2.id, { kind: "dir", confirmed: true });
  map.mergeRooms(a1.id, a2.id);
  assert.equal(map.room(b2.id)?.id, b1.id, "east neighbor of the duplicate merged too");
  assert.equal(map.roomCount(), 2);
});

test("bot verbs (hide, backstab, dt, gauge, bury) never become exits", () => {
  const h = harness();
  h.step(null, `Town Square (n, s, e, w)\n${P}`);
  const square = h.here();
  for (const cmd of ["hide", "backstab duergar merchant", "dt", "gauge Dante", "bury corpse", "sneak"]) {
    assert.equal(h.mapper.classify(cmd)?.kind, "ignore", cmd);
  }
  // A room display that lands while only `hide` is in flight (late output of an earlier move)
  // must not teach the map that `hide` leads somewhere.
  h.step("hide", `You seemingly blend into your surroundings.\nNorth Road (n, s)\n${P}`);
  assert.equal(square.links.hide, undefined);
});

test("a cut-off view never replaces a room description; travel flavor is still dropped", () => {
  const h = harness();
  const full =
    "This is the market center of Nal Shaddar.  A small tavern is east of here, judging from the aromatic smells issuing out\nof it.  A trading shop is to the south, and a bank is to the southeast.";
  const exits = "The only obvious exits are : north and east.";
  h.step(null, `You sneak stealthily from the area.\n${full}\n${exits}\n${P}`);
  const id = h.here().id;
  assert.match(h.here().description ?? "", /market center/);

  // Replayed buffer that starts mid-word: same room by its suffix key, but must not win.
  h.step("look", `omatic smells issuing out\nof it.  A trading shop is to the south, and a bank is to the southeast.\n${exits}\n${P}`);
  assert.equal(h.here().id, id);
  assert.match(h.here().description ?? "", /market center/);

  h.step("look", `${full}\n${exits}\n${P}`);
  assert.equal(h.here().description, full, "clean look drops the flavor line");
});

test("a look after a move whose display was lost is that move, even between identical rooms", () => {
  const h = harness();
  const swamp = "Black water seeps around your boots and the smell of rot hangs heavy in the humid air of the swamp.";
  const look = (exits: string) => `${swamp}\nThe only obvious exits are : ${exits}.\n${P}`;
  h.step(null, `Swamp (w, e)\n${P}`);
  const a = h.here();
  h.step("e", `Swamp (w, e)\n${P}`);
  const b = h.here();
  h.step("w", `Swamp (w, e)\n${P}`);
  assert.equal(h.here().id, a.id);
  // The display for `e` never arrives; the MUD printed nothing, so the move went through.
  h.step("e", P);
  assert.equal(h.here().id, a.id, "no display yet: stay put");
  h.step("look", look("west, east"));
  assert.equal(h.here().id, b.id);

  // A look-alike neighbor (same title, other description) is not folded into this room.
  const h2 = harness();
  h2.step(null, `Deep Forest (n, e)\n${P}`);
  h2.step("look", `Tall pines crowd close on every side and the needles muffle your footsteps on the forest floor.\nThe only obvious exits are : north, east.\n${P}`);
  const here = h2.here();
  h2.step("e", `You hear a wolf howl.\n${P}`);
  h2.step("look", `The forest is dim and quiet here, the canopy so thick that little light reaches the mossy ground.\nThe only obvious exits are : north, east, west.\n${P}`);
  assert.notEqual(h2.here().id, here.id);
  assert.equal(h2.map.room(here.id)!.descKeys.length, 1, "first room keeps only its own description");
  assert.equal(h2.map.room(here.id)!.links.e?.to, h2.here().id);
});

test("shared verbose descriptions do not pin on a single display", () => {
  const prose =
    "Black water seeps around your boots and the smell of rot hangs heavy in the humid air of the swamp. " +
    "The trail winds onward through identical-looking pools and reeds.";
  const view = (exits: string) =>
    `${prose}\nThe only obvious exits are : ${exits}.\n${P}`;
  const h = harness();
  h.step(null, view("north, south"));
  const first = h.here();
  h.step("n", view("north, south"));
  const second = h.here();
  assert.notEqual(second.id, first.id);
  h.mapper.setPosition(null);
  h.step(null, view("north, south"));
  const orphan = h.here();
  assert.notEqual(orphan.id, first.id);
  assert.notEqual(orphan.id, second.id);
});

test("a fight-in-progress redisplay after an unlisted compass move re-identifies the known room", () => {
  // Rothe Island shore (r88 incident): combat rounds lead the display, and the move the bot
  // sent was not one of the room's exits, so the display is this room (or a known one), not a new room.
  const shore =
    "The shore of the island takes a turn here, heading to the northeast and\nalso to the west, where it turns sharply to the north.  The water is right\nin front of you, looking dark and mysterious.  Tales of huge aquatic beasts\ncome to your memory, making you step away from the lake.";
  const beach =
    "A narrow strip of pebbles runs along the water here.  Something sticks\nout ten feet away from the shore, in the water. A rock, perhaps, or perhaps not.";
  const fight = "You slash Human slave solidly, causing moderate damage.\nYou slash Human slave with zeal, but doing no damage.\n";
  const shoreView = (lead = "") => `${lead}${shore}\nThe only obvious exits are : north, west and northeast.\n${P}`;
  const beachView = (lead = "") => `${lead}${beach}\nThe only obvious exits are : north and east.\n${P}`;
  const h = harness();
  h.step(null, shoreView());
  const r88 = h.here();
  h.step("w", beachView());
  const r89 = h.here();
  h.step("e", shoreView());
  assert.equal(h.here().id, r88.id);
  const rooms = h.map.roomCount();

  // Unlisted `e` from the shore, answered by the shore again mid-fight: we never left.
  h.step("e", shoreView(fight));
  assert.equal(h.here().id, r88.id, "same room, not a copy east of it");
  assert.equal(h.map.roomCount(), rooms);
  assert.equal(h.map.room(r88.id)!.links.e, undefined, "no self-made east link");

  // Mapper thinks we are on the beach; unlisted `w` shows the shore mid-fight: relocate there.
  h.step("w", beachView());
  assert.equal(h.here().id, r89.id);
  h.step("w", shoreView(fight));
  assert.equal(h.here().id, r88.id, "known shore room, not a new one west of the beach");
  assert.equal(h.map.roomCount(), rooms);
  assert.doesNotMatch(h.map.room(r88.id)!.description ?? "", /You slash/);
});

test("the small boy's trips eat queued moves without moving or blaming the exit (Kulajo r1540)", () => {
  const h = harness();
  h.step(null, `Caravan Route (ne, sw, nw)\n${P}`);
  const start = h.here();
  h.step("ne", `Sturdy path (ne, sw)\n${P}`);
  const sturdy = h.here();
  h.step("ne", `Hasty path (ne, sw)\n${P}`);
  const hasty = h.here();
  h.step("sw;sw", `Sturdy path (ne, sw)\n${P}\nCaravan Route (ne, sw, nw)\n${P}`);
  assert.equal(h.here().id, start.id);
  // A speedwalk sends all three at once; the boy trips the first two.
  h.step(
    "ne;ne;ne",
    `The small boy trips you!  What a punk!\n${P}\nThe small boy trips you!  What a punk!\n${P}\nSturdy path (ne, sw)\n${P}`,
  );
  assert.equal(h.here().id, sturdy.id, "two moves eaten, one went through");
  assert.notEqual(h.here().id, hasty.id);
  const ne = start.links.ne!;
  assert.equal(ne.hindered, 2, "both trips counted against the exit we tried to leave by");
  assert.equal(ne.blocked, undefined, "a trip is not a refusal");
  assert.equal(ne.failCount ?? 0, 0);
  assert.equal(ne.to, sturdy.id, "the link is kept");
});
