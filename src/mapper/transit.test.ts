/**
 * Transits (profile `transits`): the Kendrite Passages ship from Deepwater to Merevia, replayed
 * from Wybie's live trip (2026-11-03, 1:44–1:56 PM MST), and the newbie-arena boot.
 *
 * Before transits the mapper took the deck for a place, then matched the Merevia berth to the
 * Dunagin berth (their last 80 characters are the same) and painted Merevia over Deepwater.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "../game/stream.js";
import { cleanseRoomDescription } from "../game/roomDescriptionNoise.js";
import { Mapper, VESSEL_TAG } from "./Mapper.js";
import { WorldMap } from "./WorldMap.js";

const P = "[HP: 753(753(100%)) SP: 201(220(91%)) XP: 30177(1823(91%)) Cash: 33188(22130)]";

function harness() {
  const map = WorldMap.empty("powermud");
  const mapper = new Mapper(map);
  const stream = new GameStream();
  let t = 0;
  const step = (cmd: string | null, output: string, dt = 1000) => {
    t += dt;
    if (cmd) for (const c of cmd.split(";")) mapper.onCommandSent(c, t);
    for (const ev of [...stream.feed(`${output}\n${P}\n`), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  return { map, mapper, step, here: () => mapper.current()! };
}

const BERTHED = [
  "The ships of the Kendrite Passages shipping company are berthed here.  The",
  "three-masted schooners are very seaworthy and capable of attaining high",
  "speeds in the open sea.",
].join("\n");

const DEEPWATER_OFFICE = [
  "You are in the Deepwater branch of the Kendrite Passages shipping company.",
  "A large desk is in one corner, obviously used by an employee.  A few posters",
  "are on the walls, showing distant ports and such.  The southwest exit",
  "leads to the company's private docking area.",
  "The only obvious exits are : north and west.",
  "  ",
  "There is one Cruise Director.",
].join("\n");

const DEEPWATER_B1 = `${BERTHED}  The main building for the company is a bit to the
east, through a small archway.  The company's private docks continue
to the west.  Ships that are going to Dunagin (Celtia) dock here.
The only obvious exits are : east and west.
  
There is one Ship bound for Dunagin.
There is one Dock Worker.`;

const DEEPWATER_B2 = `${BERTHED}  The company's private docks continue off to the
east and also to the west.
The only obvious exits are : east and west.
  
There is one Dock Worker.`;

const DEEPWATER_MEREVIA_BERTH = `${BERTHED}  The company's private docks continue off to the
east and west.  Ships heading to Merevia dock at this point.
The only obvious exits are : east and west.
  
There is one Ship bound for Merevia.
There is one Dock Worker.`;

/** Dunagin's berth: same last 80 characters as the Merevia arrival berth below. */
const DUNAGIN_BERTH = `${BERTHED}  The main building for the company is a bit to the
east, through a small archway.  The company's private docks continue
to the west.
The only obvious exits are : east and west.
  
There is one Dock Worker.`;

const DUNAGIN_OFFICE = [
  "You are in the Dunagin branch of the Kendrite Passages shipping company.",
  "A large desk is in one corner, obviously used by an employee.  A few posters",
  "are on the walls, showing distant ports and such.  The west exit leads",
  "to the company's private docking area.",
  "The only obvious exit is : west.",
].join("\n");

const BOARD = "You give your pass to the Dock Worker and walk up the gangplank.";

const DECK = [
  "You are standing on the deck of a large seafaring vessel.  The ship is used",
  "to ferry passengers from one port to the next.  To leave the ship, just",
  "use 'disembark'.  If you want to see what is outside of the ship, just use",
  "the command 'view'.  When you are ready to shove off from the land, just",
  "use 'ready' and the Captain will raise the sails.",
  "There is one Ship's Captain.",
].join("\n");

const MEREVIA_ARRIVAL = `The ship shakes a bit when a particularly large wave hits the side.
You are careening towards the docks at an alarmingly high speed!  You are
going to ram into the docks!
The rolling of the waves is disconcerting.
You slam into the docks with an incredible force!
You fall to the deck in pain!
You steady yourself and prepare to disembark.
You disembark from the ship.
${BERTHED}  The main building for the company is a bit to the
northeast, through a small archway.  The company's private docks continue
to the west.
The only obvious exits are : northeast and west.
  
There is one Ship bound for Merevia.
There is one Dock Worker.
You exclaim in common : Wow that was a fun trip!
  
The Ship raises anchor and prepares to set sail.
Autosave.
Dock worker asks in common : Are you going to board a ship or not?  
You see some activity on the ship.  It looks like it is preparing to depart.
The ship clears the dock and raises its sails.
The ship is now clear of the dock area and is getting underway.
The Worker complains noisily about unruly passengers.`;

const MEREVIA_BERTH = `${BERTHED}  The main building for the company is a bit to the
northeast, through a small archway.  The company's private docks continue
to the west.
The only obvious exits are : northeast and west.
  
There is one Dock Worker.`;

const MEREVIA_WEST = `${BERTHED}  The rest of the company's main dock continues on to
the east.  Ships that are heading to Deepwater dock here.
The only obvious exit is : east.
  
There is one Ship bound for Deepwater.
There is one Dock Worker.`;

const MEREVIA_OFFICE = [
  "You are in the Merevia branch of the Kendrite Passages shipping company.",
  "A large desk is in one corner, obviously used by an employee.  A few posters",
  "are on the walls, showing distant ports and such.  The southwest exit",
  "leads to the company's private docking area.",
  "The only obvious exits are : south and southwest.",
  "  ",
  "There is one Cruise Director.",
].join("\n");

/** Map Dunagin (berth + office) and the Deepwater docks out to the Merevia berth. */
function mapPorts() {
  const h = harness();
  h.step(null, DUNAGIN_BERTH);
  const dunBerth = h.here();
  h.step("e", DUNAGIN_OFFICE);
  const dunOffice = h.here();
  h.mapper.setPosition(null);
  h.step(null, DEEPWATER_OFFICE);
  const dwOffice = h.here();
  assert.notEqual(dwOffice.id, dunOffice.id);
  h.step("w", DEEPWATER_B1);
  h.step("w", DEEPWATER_B2);
  h.step("w", DEEPWATER_MEREVIA_BERTH);
  const dwMerevia = h.here();
  assert.match(dwMerevia.description ?? "", /Ships heading to Merevia/);
  return { h, dunBerth, dunOffice, dwOffice, dwMerevia };
}

function sail(h: ReturnType<typeof harness>) {
  h.step("purchase 3", "You purchase a boarding pass on a ship bound for Merevia.");
  h.step("board ship", BOARD);
  const vessel = h.here();
  h.step("ready", "You tell the Captain that you are ready to depart.");
  h.step(null, "The Captain calls out orders to his crew.\nThe ship clears the dock and raises the sails.");
  h.step(null, "The ship clears the dock area and picks up speed.", 20_000);
  h.step("l", DECK);
  h.step(null, "The Captain yells out an order to one of his crewmen.\nYou are nearing your destination.", 60_000);
  return vessel;
}

test("boarding puts us on an off-map vessel; the deck and the voyage add no rooms", () => {
  const { h, dwMerevia } = mapPorts();
  const before = h.map.roomCount();
  const vessel = sail(h);
  assert.ok(vessel.tags.includes(VESSEL_TAG), "aboard: the vessel node");
  assert.equal(h.map.doc.planes[vessel.pos.plane]?.kind, "aside");
  assert.equal(h.here().id, vessel.id, "the deck display (no exits line) does not move us");
  assert.ok(h.mapper.riding(), "ride in progress");
  assert.equal(h.map.roomCount(), before + 1, "only the vessel node was added");
  assert.equal(h.map.room(dwMerevia.id)!.links["board ship"], undefined, "no link before we land");
});

test("landing on a new continent: own plane, transit link from the berth, never the look-alike Dunagin berth", () => {
  const { h, dunBerth, dwOffice, dwMerevia } = mapPorts();
  sail(h);
  h.step(null, MEREVIA_ARRIVAL, 90_000);
  const berth = h.here();
  assert.ok(!h.mapper.riding());
  assert.notEqual(berth.id, dunBerth.id, "same 80-char tail as Dunagin's berth, different room");
  assert.ok(!berth.tags.includes(VESSEL_TAG));
  assert.notEqual(berth.pos.plane, dwOffice.pos.plane, "Merevia is not laid out on Deepwater's plane");
  assert.notEqual(berth.pos.plane, dunBerth.pos.plane);
  assert.equal(h.map.doc.planes[berth.pos.plane]?.kind, "surface");
  assert.equal(h.map.doc.planes[berth.pos.plane]?.label, "Merevia", "plane named for the ticket's destination");
  assert.equal(h.map.continentOf(berth.pos.plane), "Merevia", "and marked as a continent only the ship reaches");
  assert.doesNotMatch(berth.description ?? "", /disembark|fun trip|raises anchor|Worker complains|careening/);
  assert.match(berth.description ?? "", /northeast, through a small archway/);

  const link = h.map.room(dwMerevia.id)!.links["board ship"]!;
  assert.equal(link.to, berth.id);
  assert.equal(link.kind, "teleport");
  assert.equal(link.transit?.rule, "kendrite-ship");
  assert.equal(link.transit?.place, "Merevia");
  assert.ok((link.transit?.seconds ?? 0) > 0, "voyage time recorded");
  assert.match(link.note ?? "", /Merevia/);
  // Deepwater and Dunagin are untouched.
  assert.equal(h.map.room(dunBerth.id)!.description, cleanseRoomDescription(h.map.room(dunBerth.id)!.description!));
  assert.deepEqual(h.map.room(dunBerth.id)!.exits, ["e", "w"]);
  assert.deepEqual(h.map.room(dwOffice.id)!.exits, ["n", "w"]);
});

test("after landing, walking the new docks never relocalizes into the old continent", () => {
  const { h, dunBerth, dwOffice } = mapPorts();
  sail(h);
  h.step(null, MEREVIA_ARRIVAL, 90_000);
  const berth = h.here();
  h.step("w", MEREVIA_WEST);
  const west = h.here();
  assert.equal(west.pos.plane, berth.pos.plane);
  h.step("e", MEREVIA_BERTH);
  assert.equal(h.here().id, berth.id, "walking back follows the link");
  h.step("ne", MEREVIA_OFFICE);
  const office = h.here();
  assert.notEqual(office.id, dwOffice.id, "Merevia's office shares Deepwater's description tail");
  assert.equal(office.pos.plane, berth.pos.plane);
  for (const r of h.map.rooms()) {
    for (const l of Object.values(r.links)) {
      if (!l.to || l.kind === "teleport") continue;
      const to = h.map.room(l.to)!;
      const merevia = (x: typeof r) => x.pos.plane === berth.pos.plane;
      assert.equal(merevia(r), merevia(to), `no walking link across the sea: ${r.id} → ${to.id}`);
    }
  }
  assert.ok(!Object.values(h.map.room(dunBerth.id)!.links).some((l) => l.to === berth.id || l.to === west.id));
});

test("pathing takes the ship only when allowLinks opts in to transits", () => {
  const { h, dwOffice } = mapPorts();
  sail(h);
  h.step(null, MEREVIA_ARRIVAL, 90_000);
  const berth = h.here();
  const goal = (r: { id: string }) => r.id === berth.id;
  assert.equal(h.map.findPath(dwOffice.id, goal), null, "no route by default");
  const viaTransit = h.map.findPath(dwOffice.id, goal, { allowLinks: ["transit"] });
  assert.deepEqual(viaTransit?.map((s) => s.cmd), ["w", "w", "w", "board ship"]);
  assert.deepEqual(h.map.findPath(dwOffice.id, goal, { allowLinks: ["board ship"] })?.at(-1)?.cmd, "board ship");
});

test("disembarking before the ship sails puts us back on the dock", () => {
  const { h, dwMerevia } = mapPorts();
  h.step("purchase 3", "You purchase a boarding pass on a ship bound for Merevia.");
  h.step("board ship", BOARD);
  assert.ok(h.here().tags.includes(VESSEL_TAG));
  h.step("disembark", `You disembark from the ship.\n${DEEPWATER_MEREVIA_BERTH}`);
  assert.equal(h.here().id, dwMerevia.id);
  assert.equal(h.map.room(dwMerevia.id)!.links["board ship"], undefined, "no transit for a ride that never left");
});

test("stream: transit lines are events and never room description", () => {
  const s = new GameStream();
  const ev = [...s.feed(`${MEREVIA_ARRIVAL}\n${P}\n`), ...s.settle()];
  const transits = ev.flatMap((e) => (e.type === "transit" ? [e] : []));
  assert.deepEqual(transits.map((e) => `${e.rule}:${e.phase}`), ["kendrite-ship:arrive"], "the ship leaving after we got off (\"raises its sails\") is chatter, not our departure");
  const room = ev.find((e) => e.type === "room");
  assert.ok(room && room.type === "room");
  assert.deepEqual(room.room.exits, ["ne", "w"]);
  assert.doesNotMatch(room.room.description ?? "", /disembark|careening|slam into/);
  const t = [...s.feed(`You purchase a boarding pass on a ship bound for Merevia.\n${P}\n`), ...s.settle()].find((e) => e.type === "transit");
  assert.ok(t && t.type === "transit");
  assert.equal(t.phase, "ticket");
  assert.equal(t.place, "Merevia");
  const b = [...s.feed(`${BOARD}\n${P}\n`), ...s.settle()].find((e) => e.type === "transit");
  assert.ok(b && b.type === "transit" && b.phase === "board");
});

test("cleansing strips ship chatter and exclamations from stored descriptions", () => {
  const stored = [
    "You exclaim in common : Wow that was a fun trip!",
    "",
    "The Ship raises anchor and prepares to set sail.",
    "You see some activity on the ship.  It looks like it is preparing to depart.",
    "The ship clears the dock and raises its sails.",
    "The ship is now clear of the dock area and is getting underway.",
    "The worker complains about the pathetic pay.",
    BERTHED + "  The company's private docks continue off to the",
    "east a ways.",
  ].join("\n");
  const cleaned = cleanseRoomDescription(stored)!;
  assert.match(cleaned, /^The ships of the Kendrite Passages/);
  assert.doesNotMatch(cleaned, /exclaim|anchor|worker/i);
});

const ARENA = [
  "You are standing inside of a walled arena.  The ground is comprised of sand.",
  "Above the walls lie many spectator stands.",
  "",
  "To leave the Arena, type 'exit'.",
  "",
  "The only obvious exits are : north, east, south, west.  ",
  "There is one PowerMud Pete.",
].join("\n");

const ABYSS = [
  "You are 'floating' around in what can only be described as a living nightmare.",
  "Swirling mists and glancing winds are all around you, passing above you and",
  "possibly even through you.  Dark shades of purple and black seem to be in a",
  "much sordid existence, totally enveloping you.  A dark palace of sorts has",
  "been erected in the middle of the swirling maelstrom.",
  "The only obvious exits are : north, south, east, west, down, up,",
  "                             northwest, southwest, southeast, northeast,",
  "                             mist.  ",
].join("\n");

const SERPICO = [
  "Two large pyres burn eternally beside a giant statue of a creature/god",
  "these cannibals evidently worship.  Carved from obsidian, the statue is",
  "of a birdlike, almost reptilian monster.  The floor beneath its immense",
  "mouth is covered in blood.  The statue's beak gapes wide open, enough for",
  "any living creature to pass through.",
  "The only obvious exits are : northeast, northwest.",
  "There is one Serpico.",
].join("\n");

const ELINOST = [
  "You are standing in the town square of Elinost.  A fountain bubbles in the",
  "middle of the square and roads lead off in every direction.",
  "The only obvious exits are : north, south, east and west.",
].join("\n");

test("arena boot: the forced move is a jump to a new plane, with no compass link", () => {
  const h = harness();
  h.step(null, ARENA);
  const arena = h.here();
  h.step("s", `Since you are above 500 experience points, you are transported out of the arena!\n${ELINOST}`);
  const town = h.here();
  assert.notEqual(town.id, arena.id);
  assert.notEqual(town.pos.plane, arena.pos.plane, "Elinost is not laid out next to the arena");
  assert.equal(h.map.room(arena.id)!.links.s?.to ?? null, null, "the step south did not lead to Elinost");
  assert.doesNotMatch(town.description ?? "", /transported out of the arena/);
  assert.ok(!h.mapper.riding());
});

test("serpico banishes to the Abyss: jump to a new plane, no compass link from the statue", () => {
  const h = harness();
  h.step(null, SERPICO);
  const statue = h.here();
  // Banish line alone, then a later look/move shows Abyss (live: combat continues, then `e`).
  h.step(null, "You have been banished to the Abyss!\n");
  h.step("e", ABYSS);
  const abyss = h.here();
  assert.notEqual(abyss.id, statue.id);
  assert.notEqual(abyss.pos.plane, statue.pos.plane, "Abyss is not laid out next to Serpico");
  assert.equal(h.map.room(statue.id)!.links.e?.to ?? null, null, "east from Serpico did not lead to the Abyss");
  assert.doesNotMatch(abyss.description ?? "", /banished to the Abyss/i);
  assert.ok(!h.mapper.riding());
});
