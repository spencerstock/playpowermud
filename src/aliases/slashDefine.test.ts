import assert from "node:assert/strict";
import test from "node:test";
import {
  isSlashAliasDefinePrefix,
  isSlashAliasUndefinePrefix,
  parseSlashAliasDefineLine,
  parseSlashAliasUndefineLine,
} from "./slashDefine.js";

test("parseSlashAliasDefineLine", () => {
  assert.equal(parseSlashAliasDefineLine("ca"), null);
  assert.equal(parseSlashAliasDefineLine("/ca"), null);
  assert.equal(parseSlashAliasDefineLine("/aliasfoo"), null);

  assert.deepEqual(parseSlashAliasDefineLine("/alias"), {
    ok: false,
    reason: "usage: /alias NAME EXPANSION",
  });
  assert.deepEqual(parseSlashAliasDefineLine("/alias cma"), {
    ok: false,
    reason: "usage: /alias NAME EXPANSION",
  });

  assert.deepEqual(parseSlashAliasDefineLine("/alias cma cast magic invulnerability"), {
    ok: true,
    name: "cma",
    expansion: "cast magic invulnerability",
  });
  assert.deepEqual(parseSlashAliasDefineLine("  /ALIAS wt weave tap  "), {
    ok: true,
    name: "wt",
    expansion: "weave tap",
  });
});

test("isSlashAliasDefinePrefix", () => {
  assert.equal(isSlashAliasDefinePrefix("/ca"), false);
  assert.equal(isSlashAliasDefinePrefix("/alias"), true);
  assert.equal(isSlashAliasDefinePrefix("/alias cma cast"), true);
});

test("parseSlashAliasUndefineLine", () => {
  assert.equal(parseSlashAliasUndefineLine("ca"), null);
  assert.equal(parseSlashAliasUndefineLine("/unaliasfoo"), null);

  assert.deepEqual(parseSlashAliasUndefineLine("/unalias"), {
    ok: false,
    reason: "usage: /unalias NAME",
  });
  assert.deepEqual(parseSlashAliasUndefineLine("/unalias cma extra"), {
    ok: false,
    reason: "usage: /unalias NAME",
  });

  assert.deepEqual(parseSlashAliasUndefineLine("/unalias cma"), {
    ok: true,
    name: "cma",
  });
  assert.deepEqual(parseSlashAliasUndefineLine("  /UNALIAS wt  "), {
    ok: true,
    name: "wt",
  });
});

test("isSlashAliasUndefinePrefix", () => {
  assert.equal(isSlashAliasUndefinePrefix("/ca"), false);
  assert.equal(isSlashAliasUndefinePrefix("/unalias"), true);
  assert.equal(isSlashAliasUndefinePrefix("/unalias cma"), true);
});
