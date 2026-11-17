import assert from "node:assert/strict";
import test from "node:test";
import { emptyWorldGraph } from "../mapper/WorldMap.js";

test("a new player map starts with no rooms", () => {
  const doc = emptyWorldGraph("powermud");
  assert.equal(doc.version, 1);
  assert.equal(Object.keys(doc.rooms).length, 0);
});
