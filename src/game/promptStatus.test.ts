import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "./stream.js";
import { GameStateTracker } from "./GameState.js";
import { promptStatusFresh } from "./promptStatus.js";
import { stripLeadingGamePrompt } from "./briefRoom.js";
import { parseLatestHpSp } from "../domain/vitals.js";
import type { GameEvent } from "./types.js";

// Real lines from Wybie's scrollback after `prompt doh` (2026-10-30).
const DOH = "[HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 20617(29297)]";
const DOH_BANKED = "[HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 0(49914)]";

test("doh status prompt: vitals, exp and drakaan from one prompt", () => {
  const s = new GameStream();
  const ev: GameEvent[] = s.feed(`You cannot go that direction.\n${DOH}\n`);
  const p = ev.find((e) => e.type === "prompt");
  assert.ok(p && p.type === "prompt");
  assert.equal(p.bare, false);
  assert.equal(p.vitals?.hp, 620);
  assert.equal(p.vitals?.hpMax, 620);
  assert.equal(p.vitals?.sp, 50);
  assert.equal(p.vitals?.spMax, 50);
  assert.deepEqual(p.status, { exp: 20400, expToNext: 1600, coinValue: 20617, bank: 29297 });
});

test("doh prompt followed by text on the same line is consumed like the plain prompt", () => {
  const s = new GameStream();
  const ev = s.feed(`${DOH_BANKED}Drow emerges from hiding.\n`);
  const p = ev.find((e) => e.type === "prompt");
  assert.ok(p && p.type === "prompt");
  assert.deepEqual(p.status, { exp: 20400, expToNext: 1600, coinValue: 0, bank: 49914 });
  assert.equal(stripLeadingGamePrompt(`${DOH}Drow emerges from hiding.`), "Drow emerges from hiding.");
});

test("plain HP/SP prompt still parses and carries no status", () => {
  const s = new GameStream();
  const ev = s.feed("[HP:84 SP:50]\n");
  const p = ev.find((e) => e.type === "prompt");
  assert.ok(p && p.type === "prompt");
  assert.equal(p.vitals?.hp, 84);
  assert.equal(p.status, undefined);
});

test("GameState takes exp/drakaan from the prompt and marks them fresh", () => {
  const st = new GameStateTracker();
  const s = new GameStream();
  const t = 1_000_000;
  for (const e of s.feed(`${DOH}\n`)) st.onEvent(e, t);
  assert.equal(st.status?.exp, 20400);
  assert.equal(st.status?.expToNext, 1600);
  assert.equal(st.status?.coinValue, 20617);
  assert.equal(st.status?.bank, 29297);
  assert.equal(promptStatusFresh(st.status, t + 1000), true);
  assert.equal(promptStatusFresh(st.status, t + 120_000), false, "stale → bots fall back to score");
  assert.equal(promptStatusFresh(null), false);
});

test("scrollback vitals read the spaced doh prompt", () => {
  const v = parseLatestHpSp(`foo\n${DOH}\n`);
  assert.equal(v.hp, 620);
  assert.equal(v.sp, 50);
});
