import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanseRoomDescription } from "../game/roomDescriptionNoise.js";
import { buildNoiseContext, descriptionBlocks, nonRoomMarkers, scrubDescription } from "./descriptionIntegrity.js";
import { emptyWorldGraph, preferDescription, WorldMap } from "./WorldMap.js";
import type { WorldGraphDocument } from "./types.js";

// Real stored descriptions (r1, r1483, r1436 before the 2026-11-07 scrub).
const NAL_SHADDAR = [
  "This part of Nal Shaddar has been set aside for the merchant trade.  Various",
  "booths and vendors are around, hawking their wares.  Directly west of here",
  "you can see a tavern, full of rowdy drinkers.  The Merchant Area stretches to",
  "the northwest as well as south from here.",
].join("\n");
const LENA_LAKE = [
  "You are standing on the bank of Lena Lake which lies just to the west of",
  "here.  The lake is very calm and the water looks cool and refreshing.",
].join("\n");

function docWith(rooms: { id: string; description: string; area?: string; npcs?: string[] }[]): WorldGraphDocument {
  const doc = emptyWorldGraph("t");
  rooms.forEach((r, i) => {
    doc.rooms[r.id] = {
      id: r.id,
      description: r.description,
      descKeys: [],
      exits: [],
      links: {},
      pos: { plane: "p1", x: i, y: 0, z: 0 },
      area: r.area,
      contents: Object.fromEntries(
        (r.npcs ?? []).map((n) => [n, { name: n, kind: "npc" as const, lastCount: 1, seenCount: 1, lastSeenAt: "" }]),
      ),
      tags: [],
      notes: [],
      meta: {},
      visits: 1,
      firstSeenAt: "",
      lastSeenAt: "",
    };
  });
  return doc;
}

test("descriptionBlocks splits at blank lines and hard breaks, never inside wrapped prose", () => {
  const blocks = descriptionBlocks(`You are no longer blessed.\n\n${NAL_SHADDAR}`);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.text, "You are no longer blessed.");
  assert.equal(blocks[0]!.blankAfter, true);
  assert.equal(descriptionBlocks(NAL_SHADDAR).length, 1, "a full-width line ending a sentence is not a break");
  const hard = descriptionBlocks(`The lizard man licks his lips.\n${LENA_LAKE}`);
  assert.deepEqual(
    hard.map((b) => b.text.slice(0, 20)),
    ["The lizard man licks", "You are standing on "],
  );
});

test("scrubDescription drops unknown leaked lines by shape and map evidence, keeps prose", () => {
  const doc = docWith([
    { id: "r1", description: `You are no longer blessed.\n\n${NAL_SHADDAR}`, area: "nal-shaddar" },
    { id: "r2", description: `You are no longer blessed.\n\n${LENA_LAKE}`, area: "lena" },
    { id: "r3", description: `The lizard man licks his lips.\n${LENA_LAKE}x`, npcs: ["lizard man"] },
    { id: "r4", description: `sell?\n${NAL_SHADDAR}y` },
    { id: "r5", description: `${"The Priest chants to himself.\n".repeat(3)}${NAL_SHADDAR}z`, npcs: ["Priest"] },
    { id: "r6", description: `You head into Threshold.\n${LENA_LAKE}w` },
  ]);
  const ctx = buildNoiseContext(doc);
  const scrub = (id: string) => scrubDescription(doc.rooms[id]!.description!, ctx, { roomId: id });

  const r1 = scrub("r1");
  assert.equal(r1.text, NAL_SHADDAR);
  assert.equal(r1.removed[0]!.confidence, "certain");
  assert.ok(r1.removed[0]!.reasons.includes("second-person"));
  assert.ok(r1.removed[0]!.reasons.includes("recurring"), "seen at the edge of two unrelated areas");

  assert.ok(scrub("r3").removed[0]!.reasons.includes("mob-action"));
  assert.equal(scrub("r3").text, `${LENA_LAKE}x`);
  assert.deepEqual(scrub("r4").removed[0]!.reasons, ["fragment"]);
  assert.equal(scrub("r5").removed.length, 3);
  assert.equal(scrub("r5").text, `${NAL_SHADDAR}z`);
  assert.equal(scrub("r6").text, `${LENA_LAKE}w`, "travel message");
});

test("scrubDescription keeps real openers, door lines and short rooms", () => {
  const doc = docWith([]);
  const ctx = buildNoiseContext(doc);
  const keep = (d: string) => assert.equal(scrubDescription(d, ctx).text, d);
  // A second-person *place* opener on its own line is the room, not a message.
  keep(`You are now directly east of the starboard side of the freighter.\n${LENA_LAKE}`);
  keep(`You are standing in the Kalinport Sewers just below the Merchant Diamond.\n${NAL_SHADDAR}`);
  // Door state is real room output (normalized out of desc keys).
  keep(`${NAL_SHADDAR}\nThere is a wood door leading east ( OPENED ).`);
  // Never stripped down to almost nothing.
  keep("You stop hiding.\nA cell.");
});

test("preferDescription keeps the clean view when the longer one only adds a detached line", () => {
  const always = () => true;
  const dirty = `You are no longer blessed.\n\n${NAL_SHADDAR}`;
  // Old behaviour: unknown prefix → longer wins. That is how 107 rooms got dirtier in two days.
  assert.equal(preferDescription(NAL_SHADDAR, dirty, always), NAL_SHADDAR);
  assert.equal(preferDescription(dirty, NAL_SHADDAR, always), NAL_SHADDAR);
  const hard = `The gator sloshes around in the water.\n${LENA_LAKE}`;
  assert.equal(preferDescription(LENA_LAKE, hard, always), LENA_LAKE);
  // A longer view whose extra start runs on in the same paragraph restores a cut-off first line.
  const lines = NAL_SHADDAR.split("\n");
  const cut = lines.slice(1).join("\n");
  assert.equal(preferDescription(cut, NAL_SHADDAR, always), NAL_SHADDAR);
});

test("a live observation drops a leaked emote by a mob in the same display", () => {
  const map = WorldMap.empty("t");
  const r = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(r, {
    mode: "verbose",
    description: `The gnoll scratches its ear.\n${LENA_LAKE}`,
    exits: ["n"],
    contents: [{ name: "gnoll", kind: "npc", count: 1 }],
  });
  assert.equal(r.description, LENA_LAKE);
  // Seen again with a different leaked line: still clean.
  map.applyObservation(r, { mode: "verbose", description: `You stop hiding.\n${LENA_LAKE}`, exits: ["n"], contents: [] });
  assert.equal(r.description, LENA_LAKE);
});

test("heal() scrubs leaked lines from stored descriptions", () => {
  const map = WorldMap.empty("t");
  const r = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  r.description = `You come out of your trance, as you are full.\n${NAL_SHADDAR}`;
  const report = map.heal();
  assert.equal(r.description, NAL_SHADDAR);
  assert.ok((report.descriptionsCleaned ?? 0) >= 1);
});

test("a pager footer ending in a prompt ends the previous output (r2686 help-file map)", () => {
  const raw = [
    "//Map of Deepwater",
    "                  #",
    "=-=-=-=-= More (Line 20 of 53) Enter '?' for command list =-=-=-=-=[HP: 116(116(100%)) SP: 50(50(100%))]",
    "This large stable is used when travellers come to Deepwater and are in need",
    "of lodging for their mounts.",
  ].join("\n");
  assert.equal(
    cleanseRoomDescription(raw),
    "This large stable is used when travellers come to Deepwater and are in need\nof lodging for their mounts.",
  );
  assert.ok(nonRoomMarkers(raw).length > 0);
});
