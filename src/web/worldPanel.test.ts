import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExitTokens } from "./worldPanel.js";

test("parseExitTokens splits comma-separated exits", () => {
  assert.deepEqual(parseExitTokens("n, s, e"), ["n", "s", "e"]);
  assert.deepEqual(parseExitTokens("N; S"), ["n", "s"]);
  assert.deepEqual(parseExitTokens("  pull lever, out  "), ["pull lever", "out"]);
});
