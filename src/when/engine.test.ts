import assert from "node:assert/strict";
import test from "node:test";
import { WhenEngine } from "./engine.js";

test("when engine fires on substring match", () => {
  const engine = new WhenEngine([{ match: "entangled", command: "flee" }]);
  assert.deepEqual(engine.commandsForOutput("You are too entangled!\n", { now: 0 }), ["flee"]);
  assert.deepEqual(engine.commandsForOutput("You are too entangled!\n", { now: 100 }), []);
});

test("when engine ignores playpowermud meta", () => {
  const engine = new WhenEngine([{ match: "entangled", command: "flee" }]);
  assert.deepEqual(engine.commandsForOutput("[playpowermud] entangled\n", { now: 0 }), []);
});
