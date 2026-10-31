import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAnnounceLine,
  parseWhoLine,
  parseWhoOutput,
} from "./discoveredPlayers.js";

const WHO_SAMPLE = `=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

                         Current Developers on PowerMud

[   Boss   ] Sassman is back and idling

+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

                          Current Players on PowerMud

[   Newbie   ] Lorax - I speak for the trees                           [216 m]
[   Player   ] Wybie anywhere else
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=`;

test("parseWhoLine extracts rank and name", () => {
  assert.deepEqual(parseWhoLine("[   Boss   ] Sassman is back and idling"), {
    rank: "Boss",
    name: "Sassman",
  });
  assert.deepEqual(parseWhoLine("[   Newbie   ] Lorax - I speak for the trees [216 m]"), {
    rank: "Newbie",
    name: "Lorax",
  });
});

test("parseWhoOutput dedupes full who block", () => {
  const rows = parseWhoOutput(WHO_SAMPLE);
  assert.deepEqual(
    rows.map((r) => r.name).sort(),
    ["Lorax", "Sassman", "Wybie"],
  );
});

test("parseAnnounceLine handles prefixed and history forms", () => {
  assert.equal(parseAnnounceLine("ANNOUNCE : Wybie has reconnected to PowerMud."), "Wybie");
  assert.equal(parseAnnounceLine("Lorax has entered PowerMud for the first time."), "Lorax");
  assert.equal(parseAnnounceLine("Cricket just went linkdead."), "Cricket");
  assert.equal(parseAnnounceLine("Cricket has left PowerMud."), "Cricket");
  assert.equal(parseAnnounceLine("PowerMud is rebooting in 5 minutes."), null);
});
