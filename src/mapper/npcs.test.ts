import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyNpcKind, contentCountsAsRoomNpc, npcMatchFor, roomNpcNames, singularNpcName, syncRoomNpcs } from "./npcs.js";
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

test("singularNpcName turns a listed group into one of them", () => {
  assert.equal(singularNpcName("Highwaymen"), "Highwayman");
  assert.equal(singularNpcName("Lizard men"), "Lizard man");
  assert.equal(singularNpcName("Women"), "Woman");
  assert.equal(singularNpcName("Rothes"), "Rothe");
  assert.equal(singularNpcName("Faerny sentrys"), "Faerny sentry");
  assert.equal(singularNpcName("Kobold villagers [Children]"), "Kobold villager [Child]");
  assert.equal(singularNpcName("Wolves"), "Wolf");
  assert.equal(singularNpcName("Puppies"), "Puppy");
  assert.equal(singularNpcName("Sons of the Sea"), "Son of the Sea");
});

test("roomNpcNames indexes groups by the singular name and folds duplicates", () => {
  const names = roomNpcNames({
    a: { name: "Highwaymen", kind: "npc", lastCount: 2, seenCount: 1, lastSeenAt: "" },
    b: { name: "Highwayman", kind: "npc", lastCount: 1, seenCount: 4, lastSeenAt: "" },
    c: { name: "Male Drow", kind: "npc", lastCount: 3, seenCount: 1, lastSeenAt: "" },
    d: { name: "Egg", kind: "item", lastCount: 1, seenCount: 1, lastSeenAt: "" },
  });
  assert.deepEqual(names, ["Highwayman", "Male Drow"]);
});
