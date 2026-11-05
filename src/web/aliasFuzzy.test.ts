import assert from "node:assert/strict";
import test from "node:test";
import { filterAliasNames, fuzzyAliasScore, mergeAutocompleteNames, parseSlashAliasLine } from "./aliasAutocomplete.js";

test("parseSlashAliasLine", () => {
  assert.deepEqual(parseSlashAliasLine("/ca"), { query: "ca", suffix: "" });
  assert.deepEqual(parseSlashAliasLine("/ca bishop"), { query: "ca", suffix: " bishop" });
  assert.equal(parseSlashAliasLine("ca"), null);
});

test("fuzzyAliasScore prefers prefix", () => {
  assert.ok(fuzzyAliasScore("cad", "ca") > fuzzyAliasScore("oca", "ca"));
});

test("filterAliasNames", () => {
  const names = ["cad", "ca", "cast", "oca"];
  assert.deepEqual(filterAliasNames(names, "ca", 10), ["ca", "cad", "cast", "oca"]);
});

test("mergeAutocompleteNames prefers slash commands on bare /", () => {
  const names = ["cad", "ca", "cast"];
  const merged = mergeAutocompleteNames("", names, 20);
  assert.ok(merged.every((n) => n.startsWith("/")));
  assert.deepEqual(merged, ["/alias", "/aliases", "/hotkey", "/unalias", "/unhotkey", "/unwhen", "/when"]);
});
