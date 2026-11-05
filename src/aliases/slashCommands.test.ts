import assert from "node:assert/strict";
import test from "node:test";
import { fuzzyAliasScore } from "../web/aliasAutocomplete.js";
import { filterSlashCommands, isSlashCommandArgsEntry, parseSlashAliasesLine } from "./slashCommands.js";

test("filterSlashCommands ranks alias commands", () => {
  assert.deepEqual(filterSlashCommands("al", 12, fuzzyAliasScore).slice(0, 2), ["/alias", "/aliases"]);
  assert.deepEqual(filterSlashCommands("un", 12, fuzzyAliasScore).sort(), ["/unalias", "/unhotkey", "/unwhen"]);
  assert.equal(filterSlashCommands("to", 12, fuzzyAliasScore).includes("/to" as never), false);
});

test("isSlashCommandArgsEntry hides suggestions once arguments start", () => {
  assert.equal(isSlashCommandArgsEntry("/alias "), true);
  assert.equal(isSlashCommandArgsEntry("/unalias cma"), true);
  assert.equal(isSlashCommandArgsEntry("/al"), false);
});

test("parseSlashAliasesLine", () => {
  assert.deepEqual(parseSlashAliasesLine("/aliases"), { filter: "" });
  assert.deepEqual(parseSlashAliasesLine("/aliases cast"), { filter: "cast" });
  assert.equal(parseSlashAliasesLine("/alias x y"), null);
});
