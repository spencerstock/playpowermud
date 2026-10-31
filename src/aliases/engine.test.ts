import assert from "node:assert/strict";
import test from "node:test";
import { AliasEngine } from "./engine.js";
import { smartAliasMarker } from "../smartAliases/markers.js";

test("exact alias ca self-buff", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(
    new Map([
      ["ca", "cast stoneskin;cast bless"],
      ["ca $1$", "cast stoneskin on $1$;cast bless on $1$"],
    ]),
  );
  const r = engine.resolveInput("ca");
  assert.equal(r.kind, "alias");
  assert.deepEqual(r.commands, ["cast stoneskin", "cast bless"]);
});

test("listAutocompleteNames merges exact prefix and zscript", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(
    new Map([
      ["ca", "cast stoneskin"],
      ["ca $1$", "cast stoneskin on $1$"],
      ["quit", "#send quit"],
    ]),
  );
  assert.deepEqual(engine.listAutocompleteNames(), ["ca", "quit"]);
});

test("exact alias used as prefix appends args", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(new Map([["bs", "backstab"]]));
  const r = engine.resolveInput("bs orc");
  assert.equal(r.kind, "alias");
  assert.deepEqual(r.commands, ["backstab orc"]);
});

test("explicit prefix alias wins over exact stem", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(
    new Map([
      ["ca", "cast stoneskin"],
      ["ca $1$", "cast stoneskin on $1$"],
    ]),
  );
  const r = engine.resolveInput("ca bishop");
  assert.deepEqual(r.commands, ["cast stoneskin on bishop"]);
});

test("prefix alias ca bishop", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(
    new Map([
      ["ca", "cast stoneskin"],
      ["ca $1$", "cast stoneskin on $1$;cast bless on $1$"],
    ]),
  );
  const r = engine.resolveInput("ca bishop");
  assert.equal(r.kind, "alias");
  assert.deepEqual(r.commands, ["cast stoneskin on bishop", "cast bless on bishop"]);
});

test("smart alias marker on cad", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  const marker = smartAliasMarker("cad");
  engine.loadAliases(new Map([
    ["cad", marker],
    ["cad $1$", marker],
  ]));
  assert.deepEqual(engine.resolveInput("cad"), {
    kind: "smart_alias",
    commands: [],
    smartAliasId: "cad",
  });
  const r = engine.resolveInput("cad stone golem");
  assert.equal(r.kind, "smart_alias");
  assert.equal(r.smartAliasId, "cad");
  assert.equal(r.smartAliasArgs, "stone golem");
});

test("zScript quit alias expands", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(new Map([["quit", "remove gloves;#rawsend quit"]]));
  const r = engine.resolveInput("quit");
  assert.equal(r.kind, "alias");
  assert.deepEqual(r.commands, ["remove gloves", "quit"]);
});

test("prefix alias supports multi-word target", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(new Map([["ca $1$", "cast stoneskin on $1$"]]));
  const r = engine.resolveInput("ca stone golem 2");
  assert.equal(r.kind, "alias");
  assert.deepEqual(r.commands, ["cast stoneskin on stone golem 2"]);
});

test("input command separator resolves each segment", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(
    new Map([
      ["w", "west"],
      ["cnf", "consider"],
    ]),
  );
  const r = engine.resolveInput("w;cnf");
  assert.equal(r.kind, "alias");
  assert.deepEqual(r.commands, ["west", "consider"]);
});

test("whole-line exact alias is not split on separator", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(new Map([["w;cnf", "look"]]));
  const r = engine.resolveInput("w;cnf");
  assert.equal(r.kind, "alias");
  assert.deepEqual(r.commands, ["look"]);
});

test("nested alias chain expands to mud commands (fi / dcore)", () => {
  const engine = new AliasEngine({ commandSeparator: ";", variables: {} });
  engine.loadAliases(
    new Map([
      ["cmi", "cast mirror images"],
      ["css", "cast stoneskin"],
      ["mj", "psi mind jumble"],
      ["mw", "psi mind whip"],
      ["dcore", "cmi;mj;mw;css"],
      ["fi", "cmi;mj;mw;css"],
    ]),
  );
  const expected = [
    "cast mirror images",
    "psi mind jumble",
    "psi mind whip",
    "cast stoneskin",
  ];
  assert.deepEqual(engine.resolveInput("fi").commands, expected);
  assert.deepEqual(engine.resolveInput("dcore").commands, expected);
});
