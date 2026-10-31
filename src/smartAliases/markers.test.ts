import assert from "node:assert/strict";
import test from "node:test";
import { parseSmartAliasLine, parseSmartAliasMarker, smartAliasMarker } from "./markers.js";

test("smart alias markers", () => {
  assert.equal(smartAliasMarker("cad"), "@mudwithme/smart:cad@");
  assert.equal(parseSmartAliasMarker("@mudwithme/smart:cad@"), "cad");
  assert.equal(parseSmartAliasMarker("@mudwithme/smart-cad@"), "cad");
  assert.equal(parseSmartAliasMarker("cast heal"), null);
});

test("parseSmartAliasLine", () => {
  const names = new Set(["cad"]);
  assert.deepEqual(parseSmartAliasLine("cad", names), { id: "cad", args: undefined });
  assert.deepEqual(parseSmartAliasLine("cad bishop", names), { id: "cad", args: "bishop" });
  assert.equal(parseSmartAliasLine("ca", names), null);
  assert.equal(parseSmartAliasLine("cad;look", names), null);
});
