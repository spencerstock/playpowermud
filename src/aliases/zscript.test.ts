import assert from "node:assert/strict";
import test from "node:test";
import { expandZScriptBody, splitZmudSegments } from "./zscript.js";

test("splitZmudSegments respects braced semicolons", () => {
  assert.deepEqual(splitZmudSegments("a;#rawsend {x;y};b"), ["a", "#rawsend {x;y}", "b"]);
});

test("quit alias from Link.cfg", () => {
  const r = expandZScriptBody("remove gloves;#rawsend quit");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.commands, ["remove gloves", "quit"]);
});

test("#rawsend braced block", () => {
  const r = expandZScriptBody(
    "#rawsend {eset emote white;italics underline bold red};emote slashes",
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.commands, [
    "eset emote white",
    "italics underline bold red",
    "emote slashes",
  ]);
});

test("#set updates variables", () => {
  const r = expandZScriptBody("#set gybtu 0;#set hiyent 0;effects");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.variableUpdates, { gybtu: "0", hiyent: "0" });
  assert.deepEqual(r.commands, ["effects"]);
});

test("Mudlet-only alias blocked", () => {
  const r = expandZScriptBody("#actiongroup succor disable");
  assert.equal(r.ok, false);
});

test("harvest plus actiongroup sends harvest only", () => {
  const r = expandZScriptBody("harvest;#actiongroup harv enable");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.commands, ["harvest"]);
  assert.equal(r.skipped.length, 1);
});
