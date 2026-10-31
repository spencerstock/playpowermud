import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseLatestHpSp,
  parseLatestRoomHint,
  parseWorstHp,
  readImagesFromScrollback,
  readStoneskinsFromScrollback,
  scrollbackLooksLikeCombat,
} from "./vitals.js";

test("parseLatestHpSp prefers newest combat bar", () => {
  const sb = "old [ HP : 100(500) SP : 50(400) ]\n[HP:480(500) SP:390(400)]";
  const v = parseLatestHpSp(sb);
  assert.equal(v.hp, 480);
  assert.equal(v.sp, 390);
});

test("parseWorstHp finds minimum", () => {
  const sb = "[HP:400]\n[ HP : 350(500) SP : 200(400) ]";
  assert.equal(parseWorstHp(sb), 350);
});

test("readImagesFromScrollback", () => {
  assert.equal(readImagesFromScrollback("You have 3 images left"), 3);
  assert.equal(readImagesFromScrollback("One mirror image left"), 1);
});

test("readStoneskinsFromScrollback", () => {
  assert.equal(
    readStoneskinsFromScrollback("You have a total of 2 stoneskins remaining"),
    2,
  );
});

test("parseLatestRoomHint from Exits line", () => {
  const sb = "foo\nKalamshite Desert (out, e) [ Exits: north south ]";
  assert.equal(parseLatestRoomHint(sb), "Kalamshite Desert (out, e)");
});

test("parseLatestRoomHint from brief room lines", () => {
  const sb = [
    ">>> [user] n",
    "Melee-Magthere : Grand Melee (s).",
    "[HP:99 SP:50]",
  ].join("\n");
  assert.equal(parseLatestRoomHint(sb), "Melee-Magthere : Grand Melee (s)");
  assert.equal(
    parseLatestRoomHint("[HP:99 SP:50]Melee-Magthere (n, out, d)."),
    "Melee-Magthere (n, out, d)",
  );
});

test("scrollbackLooksLikeCombat", () => {
  assert.equal(scrollbackLooksLikeCombat("Attacker : a blue dragon"), true);
  assert.equal(scrollbackLooksLikeCombat("You look around."), false);
});
