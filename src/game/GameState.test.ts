import assert from "node:assert/strict";
import test from "node:test";
import { GameStateTracker } from "./GameState.js";

const status = (hp: number, attacker?: string) => ({
  type: "vitals" as const,
  vitals: { hp, hpMax: 162, sp: 48, spMax: 50, attacker, at: Date.now() },
});

test("a successful flee ends combat at once", () => {
  const s = new GameStateTracker();
  s.onEvent(status(65, "excellent"));
  assert.equal(s.inCombat, true);
  s.onEvent({ type: "flee", dir: "w" });
  assert.equal(s.inCombat, false);
  assert.ok(s.snapshot().lastFleeAt > 0);
  // Powermud's attacker-less status line right after the flee is not a new fight.
  s.onEvent(status(42));
  assert.equal(s.inCombat, false);
  assert.equal(s.vitals?.hp, 42);
});

test("a follower re-engaging after the flee is combat again", () => {
  const s = new GameStateTracker();
  s.onEvent(status(65, "excellent"));
  s.onEvent({ type: "flee", dir: "w" });
  s.onEvent(status(38, "excellent"));
  assert.equal(s.inCombat, true);
});

test("attacker-less status lines do not extend combat after a flee", () => {
  const s = new GameStateTracker();
  const t0 = Date.now();
  s.onEvent(status(65, "fair"), t0 - 5000);
  assert.equal(s.inCombat, true);
  s.onEvent({ type: "flee", dir: "w" }, t0 - 4000);
  assert.equal(s.inCombat, false);
  s.onEvent(status(100), t0);
  assert.equal(s.inCombat, false);
});

test("one kill in a multi-fight does not end combat while attacks continue", () => {
  const s = new GameStateTracker();
  const t0 = Date.now();
  s.onEvent(status(80, "ok"), t0 - 2000);
  assert.equal(s.inCombat, true);
  s.onEvent({ type: "kill", victim: "Male villager", text: "You killed Male villager." }, t0 - 1500);
  assert.equal(s.inCombat, true);
  s.onEvent({ type: "attack", target: "Large kobold", text: "You attack Large kobold." }, t0 - 1000);
  assert.equal(s.inCombat, true);
  s.onEvent({ type: "kill", victim: "Large kobold", text: "You killed Large kobold." }, t0 - 500);
  assert.equal(s.inCombat, true);
  s.onEvent(status(78, "fair"), t0);
  assert.equal(s.inCombat, true);
});

test("death ends combat", () => {
  const s = new GameStateTracker();
  s.onEvent(status(8, "excellent"));
  s.onEvent({ type: "death", text: "You die." });
  assert.equal(s.inCombat, false);
});

test("a score block with no HP or SP does not freeze the next prompt", () => {
  const s = new GameStateTracker();
  s.onEvent({
    type: "score",
    status: { name: "Mara", updatedAt: Date.now() },
  });
  s.onEvent({
    type: "prompt",
    bare: false,
    vitals: { hp: 361, sp: 40, at: Date.now() },
  });
  assert.equal(s.vitals?.hp, 361);
  assert.equal(s.vitals?.sp, 40);
});

test("prompt after score does not regress SP from stale status line", () => {
  const s = new GameStateTracker();
  s.onEvent({
    type: "score",
    status: {
      name: "Mara",
      hp: 364,
      hpMax: 364,
      sp: 50,
      spMax: 50,
      updatedAt: Date.now(),
    },
  });
  assert.equal(s.vitals?.sp, 50);
  s.onEvent({
    type: "prompt",
    bare: false,
    vitals: { hp: 364, hpMax: 364, sp: 32, spMax: 50, at: Date.now() },
  });
  assert.equal(s.vitals?.sp, 50);
});

test("death markers ignore the `character` sheet's death count line", async () => {
  const { defaultGameProfile } = await import("./profile.js");
  const hit = (s: string) => defaultGameProfile().deathMarkers.some((r) => r.test(s));
  assert.equal(hit("You have died a total of 2 times."), false);
  assert.equal(hit("You have died only One time."), false);
  assert.equal(hit("You have died."), true);
  assert.equal(hit("You die."), true);
});
