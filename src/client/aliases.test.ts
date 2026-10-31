import assert from "node:assert/strict";
import test from "node:test";
import { AliasStore, type AliasStorage } from "./aliases.js";

function memoryStorage(): AliasStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test("plain input passes through", () => {
  const s = new AliasStore(memoryStorage());
  assert.deepEqual(s.resolve("look"), { commands: ["look"] });
});

test("aliases expand, chain, nest and persist", () => {
  const storage = memoryStorage();
  const s = new AliasStore(storage);
  s.set("cmi", "cast mirror images");
  s.set("buff", "cmi;cast stoneskin");
  assert.deepEqual(s.resolve("buff").commands, ["cast mirror images", "cast stoneskin"]);
  assert.deepEqual(s.resolve("n;buff").commands, ["n", "cast mirror images", "cast stoneskin"]);
  const reloaded = new AliasStore(storage);
  assert.deepEqual(reloaded.names(), ["buff", "cmi"]);
});

test("redefine and remove are case-insensitive", () => {
  const s = new AliasStore(memoryStorage());
  s.set("Foo", "say a");
  s.set("foo", "say b");
  assert.deepEqual(s.list(), [["foo", "say b"]]);
  assert.equal(s.remove("FOO"), true);
  assert.deepEqual(s.resolve("foo").commands, ["foo"]);
});

test("cycles report an error instead of sending", () => {
  const s = new AliasStore(memoryStorage());
  s.set("a", "b");
  s.set("b", "a");
  assert.ok(s.resolve("a").error);
});
