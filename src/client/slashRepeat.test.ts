import assert from "node:assert/strict";
import test from "node:test";
import { parseSlashRepeatLine } from "./slashRepeat.js";

test("parseSlashRepeatLine", () => {
  assert.equal(parseSlashRepeatLine("/alias x"), null);
  assert.deepEqual(parseSlashRepeatLine("/repeat"), { kind: "toggle" });
  assert.deepEqual(parseSlashRepeatLine("/REPEAT off"), { kind: "set", on: false });
  assert.deepEqual(parseSlashRepeatLine("/repeat on"), { kind: "set", on: true });
  assert.deepEqual(parseSlashRepeatLine("/repeat maybe"), { kind: "error", reason: "usage: /repeat [on|off]" });
  assert.equal(parseSlashRepeatLine("/repeating"), null);
});