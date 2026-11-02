import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "../game/stream.js";
import { Mapper } from "./Mapper.js";
import { descKey, WorldMap } from "./WorldMap.js";
import type { MapLink, MapRoom } from "./types.js";

// Kulajo mine tunnel (r301–r303 on the live map), the stretch the live mapper recorded one
// command late: each room held its neighbor's exits (r302 `nw`→r301, `u`→r303).
const CAVERN =
  "The cavern grows in size to the south, and gently diminishes to the east.  The\npoint of the cavern you are now in glows faintly with a greenish hue.  Looking\nat the walls, you notice a strange type of fungus attached to it.";
const PATH =
  "You are travelling along a small path set in a large and spacious cavern.  The\npath meanders along the cavern wall, dodging between large stalagmites which\ndot the cavern's floor.";
const CLIFF =
  "A large cavern stops here, but does continue to the northwest.  A cliff face is\nright in front of you, preventing you from moving in that direction.  You can\nspot several handholds in the rock which would allow you to climb the\nshort distance to the tunnel above.";
const LEDGE =
  "You have reached the end of the tunnel, or such is your first impression.  The\ntunnel ends abruptly to open air towards the east, but glancing down you do in\nfact see that it would be possible to climb down the side of the cliff.";

const P = "[HP:100 SP:50]";
const show = (desc: string, exits: string) => `${desc}\nThe only obvious exits are : ${exits}.\n${P}\n`;

function link(to: string | null, extra: Partial<MapLink> = {}): MapLink {
  return { to, kind: "dir", confirmed: true, uses: 1, ...extra };
}

function room(id: string, exits: string[], links: Record<string, MapLink>, extra: Partial<MapRoom> = {}): MapRoom {
  const description = extra.description;
  return {
    id,
    descKeys: description ? [descKey(description)] : [],
    description,
    exits,
    links,
    pos: extra.pos ?? { plane: "p1", x: 0, y: 0, z: 0 },
    contents: {},
    tags: [],
    notes: [],
    meta: {},
    visits: extra.visits ?? 5,
    firstSeenAt: "",
    lastSeenAt: "",
    ...extra,
  };
}

function mapOf(rooms: MapRoom[]): WorldMap {
  return new WorldMap({
    version: 1,
    mud: "t",
    updatedAt: "",
    nextRoom: 100,
    nextPlane: 5,
    rooms: Object.fromEntries(rooms.map((r) => [r.id, r])),
    planes: { p1: { id: "p1", kind: "surface", createdAt: "" }, p2: { id: "p2", kind: "surface", createdAt: "" } },
    areas: {},
  });
}

test("a queue slipped by one command does not credit a display to an exit neither room lists", () => {
  const map = mapOf([
    room("r303", ["nw", "u"], {}, { description: CLIFF, pos: { plane: "p1", x: 0, y: 0, z: 0 } }),
  ]);
  const mapper = new Mapper(map);
  mapper.setPosition("r303");
  const stream = new GameStream();
  let t = 0;
  const feed = (out: string) => {
    for (const ev of [...stream.feed(out), ...stream.settle()]) mapper.onGameEvent(ev, (t += 100));
  };
  // A probe the game answered without a prompt is still queued ahead of the real moves.
  mapper.onCommandSent("e", (t += 100));
  mapper.onCommandSent("nw", (t += 100));
  feed(show(PATH, "north and southeast"));
  mapper.onCommandSent("n", (t += 100));
  feed(show(CAVERN, "east, south, northwest"));

  const path = map.rooms().find((r) => r.description === PATH)!;
  const cavern = map.rooms().find((r) => r.description === CAVERN)!;
  assert.equal(map.room("r303")!.links.e, undefined, "the stray probe is not an exit");
  assert.equal(map.room("r303")!.links.nw?.to, path.id);
  assert.equal(path.links.n?.to, cavern.id, "the path's own north exit, not the cliff's northwest");
  assert.equal(path.links.nw, undefined);
});

test("heal moves a link neither end lists onto the one exit both rooms agree on", () => {
  // As found on the live map: r302 lists n and se, but holds r303's nw and u. r301's nw
  // tunnel (to r441) is what leaves `n` as the only fit for r302.
  const map = mapOf([
    room("r301", ["e", "s", "nw"], { se: link("r302"), nw: link("r441") }, { description: CAVERN, pos: { plane: "p1", x: -1, y: 1, z: 0 } }),
    room("r441", ["se"], { se: link("r301") }, { title: "Tunnel", pos: { plane: "p1", x: -2, y: 2, z: 0 } }),
    room("r302", ["n", "se"], { nw: link("r301"), u: link("r303", { kind: "vertical" }) }, { description: PATH }),
    room("r303", ["nw", "u"], { d: link("r302", { kind: "vertical" }), w: link("r304") }, { description: CLIFF, pos: { plane: "p1", x: 0, y: 0, z: 1 } }),
    room("r304", ["w", "d"], { e: link("r303") }, { description: LEDGE, pos: { plane: "p1", x: -1, y: 0, z: 1 } }),
  ]);
  map.heal();
  const links = (id: string) => Object.fromEntries(Object.entries(map.room(id)!.links).map(([c, l]) => [c, l.to]));
  assert.deepEqual(links("r302"), { n: "r301", se: "r303" });
  assert.deepEqual(links("r301"), { s: "r302", nw: "r441" });
  assert.deepEqual(links("r303"), { nw: "r302", u: "r304" });
  assert.deepEqual(links("r304"), { d: "r303" });
  assert.equal(map.room("r302")!.links.n!.confirmed, false, "re-keyed links are inferred until walked");
});

test("heal demotes a link neither end lists when no listed exit fits, and keeps a manhole's way back", () => {
  const map = mapOf([
    room("r1", ["n", "e"], { s: link("r2") }, { description: CAVERN }),
    room("r6", ["n"], { w: link("r7") }, { description: CLIFF, pos: { plane: "p1", x: 5, y: 0, z: 0 } }),
    room("r7", ["s"], {}, { title: "Off the grid", pos: { plane: "p1", x: 9, y: 9, z: 0 } }),
    // r2's only fitting slot (w, back to r1's e) already leads elsewhere.
    room("r2", ["w", "se"], { w: link("r3") }, { description: PATH, pos: { plane: "p1", x: 0, y: -1, z: 0 } }),
    room("r3", ["e"], { e: link("r2") }, { description: LEDGE, pos: { plane: "p1", x: -1, y: -1, z: 0 } }),
    // An unlisted climb whose destination's way back is a named command stays.
    room("r4", ["n"], { u: link("r5", { kind: "vertical" }) }, { description: CLIFF, pos: { plane: "p2", x: 0, y: 0, z: 0 } }),
    room("r5", ["s"], { "grab the handle": link("r4", { kind: "special", hidden: true }) }, {
      title: "Manhole",
      pos: { plane: "p2", x: 0, y: 0, z: 1 },
    }),
  ]);
  map.heal();
  // r1 -s-> r2 sits on the grid and was walked: it may be the only way through, so it stays as a
  // costly guess that a refused walk will remove.
  const guess = map.room("r1")!.links.s!;
  assert.equal(guess.to, "r2");
  assert.equal(guess.confirmed, false);
  assert.ok((guess.weight ?? 1) > 1);
  assert.equal(map.room("r6")!.links.w, undefined, "off the grid as well: dropped");
  assert.equal(map.room("r4")!.links.u?.to, "r5");
});

test("heal merges a copied chain of rare prose, but not look-alike road squares far apart", () => {
  const ROAD = `You are on Dulaj Road, a long route that winds its way through the Plains of Nereka.  ${"The road is dusty and the plains stretch away on both sides. ".repeat(2)}`;
  const BEND = `The road is meandering through the Plains of Nereka, twisting a few times here and there.  ${"Tall grass waves in the wind beside it. ".repeat(3)}`;
  const map = mapOf([
    // The original pair and a copy one cell off (made while lost), linked the same way.
    room("r10", ["e", "s", "nw"], { s: link("r11") }, { description: CAVERN, pos: { plane: "p1", x: 0, y: 0, z: 0 } }),
    room("r11", ["n", "se"], { n: link("r10") }, { description: PATH, pos: { plane: "p1", x: 0, y: -1, z: 0 } }),
    room("r20", ["e", "s", "nw"], { s: link("r21") }, { description: CAVERN, pos: { plane: "p1", x: 1, y: 0, z: 0 } }),
    room("r21", ["n", "se"], { n: link("r20"), se: link("r22") }, { description: PATH, pos: { plane: "p1", x: 1, y: -1, z: 0 } }),
    room("r22", ["nw"], { nw: link("r21") }, { description: LEDGE, pos: { plane: "p1", x: 2, y: -2, z: 0 } }),
    // A road that reuses two descriptions: equal neighbors, but four cells apart.
    room("r30", ["e", "w"], { e: link("r31") }, { description: ROAD, pos: { plane: "p1", x: 10, y: 0, z: 0 } }),
    room("r31", ["e", "w"], { w: link("r30"), e: link("r32") }, { description: BEND, pos: { plane: "p1", x: 11, y: 0, z: 0 } }),
    room("r32", ["e", "w"], { w: link("r31"), e: link("r33") }, { title: "Bridge", pos: { plane: "p1", x: 12, y: 0, z: 0 } }),
    room("r33", ["e", "w"], { w: link("r32"), e: link("r34") }, { title: "Ford", pos: { plane: "p1", x: 13, y: 0, z: 0 } }),
    room("r34", ["e", "w"], { w: link("r33"), e: link("r35") }, { description: ROAD, pos: { plane: "p1", x: 14, y: 0, z: 0 } }),
    room("r35", ["e", "w"], { w: link("r34") }, { description: BEND, pos: { plane: "p1", x: 15, y: 0, z: 0 } }),
  ]);
  const report = map.heal();
  assert.ok((report.chainsMerged ?? 0) >= 1);
  assert.equal(map.room("r20")?.id, "r10", "the copied cavern folds into the original");
  assert.equal(map.room("r21")?.id, "r11");
  assert.equal(map.room("r11")!.links.se?.to, "r22", "the copy's extra exit survives the merge");
  assert.equal(map.room("r34")?.id, "r34", "road squares reusing prose stay distinct");
  assert.equal(map.room("r35")?.id, "r35");
});

test("heal strips chatter another room's clean copy proves, and the same line elsewhere", () => {
  const ARENA =
    "You are standing inside of a walled arena.  The ground is comprised of sand.\nAbove the walls lie many spectator stands, filled with cheering masses.  The\nwalls of the arena are too high for you to climb.";
  const PIT =
    "The arena floor dips into a shallow pit here, its sand stained dark from old\nfights.  Spectators lean over the railing above, shouting for more blood.";
  const map = mapOf([
    room("r1", ["n", "s"], {}, { description: ARENA }),
    room("r2", ["n", "s"], {}, { description: `The gnoll stares at you.\n${ARENA}`, pos: { plane: "p2", x: 0, y: 0, z: 0 } }),
    room("r3", ["e"], {}, { description: `The gnoll stares at you.\n${PIT}`, pos: { plane: "p2", x: 5, y: 0, z: 0 } }),
  ]);
  const n = map.stripKnownPrefixes();
  assert.equal(n, 2);
  assert.equal(map.room("r2")!.description, ARENA);
  assert.equal(map.room("r3")!.description, PIT, "learned from r2, stripped where no clean copy exists");
  assert.deepEqual(map.room("r3")!.descKeys, [descKey(PIT)]);
});
