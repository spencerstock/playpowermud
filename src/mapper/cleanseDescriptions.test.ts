import assert from "node:assert/strict";
import { test } from "node:test";
import { WorldMap } from "./WorldMap.js";

const PROMPT = "[HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 20617(29297)]";
const PROSE = [
  "You are standing inside of a walled arena.  The ground is comprised of sand.",
  "Above the walls lie many spectator stands, filled with cheering masses.",
].join("\n");

test("cleanseDescriptions strips stored junk lines, rebuilds keys, and flags all-junk text without blanking it", () => {
  const map = WorldMap.empty("t");
  const dirty = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const junk = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  const clean = map.createRoom({ plane: "p1", x: 2, y: 0, z: 0 });
  const allJunk = `${PROMPT}\nFiz tells you : only one is, right?`;
  // Stored as an older mapper would have saved them (no live cleanse).
  dirty.description = `${PROMPT}\n${PROSE}`;
  dirty.descKeys = ["stale-key"];
  junk.description = allJunk;
  clean.description = "A quiet road runs north and south between tall pines.";

  const dry = map.cleanseDescriptions({ dryRun: true });
  assert.deepEqual(dry.cleaned, [dirty.id]);
  assert.deepEqual(dry.allJunk, [junk.id]);
  assert.equal(dirty.description, `${PROMPT}\n${PROSE}`, "dry run changes nothing");

  const res = map.cleanseDescriptions();
  assert.deepEqual(res.cleaned, [dirty.id]);
  assert.deepEqual(res.allJunk, [junk.id]);
  assert.equal(dirty.description, PROSE);
  assert.ok(!dirty.descKeys.includes("stale-key"));
  assert.ok(dirty.descKeys.length > 0);
  assert.equal(junk.description, allJunk, "all-junk text is left for a human");
  assert.equal(clean.description, "A quiet road runs north and south between tall pines.");
  assert.deepEqual(map.cleanseDescriptions(), { cleaned: [], allJunk: [junk.id] }, "idempotent");
});

test("a live observation with a prompt/chat first line stores only the prose", () => {
  const map = WorldMap.empty("t");
  const r = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(r, { mode: "verbose", description: `Sassman shouts : noice.\n${PROMPT}\n${PROSE}`, exits: ["n"], contents: [] });
  assert.equal(r.description, PROSE);
});
