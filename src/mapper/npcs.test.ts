import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyNpcKind, contentCountsAsRoomNpc, npcMatchFor, roomNpcNames, syncRoomNpcs } from "./npcs.js";
import type { MapRoom } from "./types.js";

test("roomNpcNames keeps shop NPCs and drops corpses and prose", () => {
  const room: MapRoom = {
    id: "r1",
    descKeys: [],
    exits: [],
    links: {},
    pos: { plane: "p1", x: 0, y: 0, z: 0 },
    contents: {
      bartender: { name: "Bartender", kind: "npc", lastCount: 1, seenCount: 1, lastSeenAt: "" },
      shop: { name: "small shop to the east", kind: "unknown", lastCount: 1, seenCount: 1, lastSeenAt: "" },
      corpse: { name: "corpse of Drow", kind: "corpse", lastCount: 1, seenCount: 1, lastSeenAt: "" },
      wander: {
        name: "Patrol guard",
        kind: "mob",
        path: "d/area/mon/guard_move",
        lastCount: 1,
        seenCount: 1,
        lastSeenAt: "",
      },
    },
    tags: [],
    notes: [],
    meta: {},
    visits: 1,
    firstSeenAt: "",
    lastSeenAt: "",
  };
  syncRoomNpcs(room);
  assert.deepEqual(room.npcs, ["Bartender"]);
  assert.equal(npcMatchFor(room, ["bartender"]), "Bartender");
});

test("classifyNpcKind marks merchants without paths as npc", () => {
  assert.equal(classifyNpcKind("Drow merchant", undefined, "unknown"), "npc");
  assert.equal(contentCountsAsRoomNpc({ name: "Drow merchant", kind: "npc" }), true);
});

test("untracked PCs with player paths count as room npcs not players", () => {
  assert.equal(
    contentCountsAsRoomNpc({ name: "Hogi", kind: "npc", path: "std/body/player#11028" }),
    true,
  );
  assert.equal(contentCountsAsRoomNpc({ name: "Hogi", kind: "player", path: "std/body/player#11028" }), false);
});

test("roomNpcNames derives from contents when npcs field missing", () => {
  const names = roomNpcNames({
    m: { name: "Orcish slave", kind: "npc", lastCount: 1, seenCount: 1, lastSeenAt: "" },
  });
  assert.deepEqual(names, ["Orcish slave"]);
});

test("roomNpcNames drops guild boards and room objects", () => {
  const names = roomNpcNames({
    board: {
      name: "Melee-Magthere Guild Board [ 59 messages, 58 new]",
      kind: "npc",
      lastCount: 1,
      seenCount: 1,
      lastSeenAt: "",
    },
    lore: { name: "Loreman", kind: "npc", lastCount: 1, seenCount: 1, lastSeenAt: "" },
  });
  assert.deepEqual(names, ["Loreman"]);
});

test("classifyNpcKind recognizes Loreman as npc", () => {
  assert.equal(classifyNpcKind("Loreman", undefined, "unknown"), "npc");
});
