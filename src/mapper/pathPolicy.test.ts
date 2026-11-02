import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { WorldMap } from "./WorldMap.js";
import { botPathOptions, linkNeverPathed, resolvePathOptions, setGlobalPreferAvoid } from "./pathPolicy.js";

test("resolvePathOptions clears empty avoid lists", () => {
  assert.deepEqual(resolvePathOptions({ avoid: [] }), {});
});

test("botPathOptions matches mud_goto defaults (topology only)", () => {
  const map = new WorldMap(JSON.parse(fs.readFileSync("public/data/powermud.graph.json", "utf8")));
  const opts = botPathOptions(1);
  const path = map.findPath("r102", (r) => r.id === "r7", opts);
  assert.ok(path?.length === 7, "gate approach should reach tavern on shared graph policy");
});

test("preferAvoid chooses a longer route when one exists", () => {
  const map = WorldMap.empty("t");
  const mk = (x: number, y: number, exits: string[]) => {
    const r = map.createRoom({ plane: "p1", x, y, z: 0 });
    map.applyObservation(r, { mode: "brief", title: `${x},${y}`, exits, contents: [] });
    return r;
  };
  const a = mk(0, 0, ["e", "s"]);
  const b = mk(1, 0, ["w", "e"]);
  const d = mk(0, 1, ["n", "e"]);
  const c = mk(2, 0, ["w"]);
  map.link(a.id, "e", b.id, { kind: "dir", confirmed: true });
  map.link(b.id, "e", c.id, { kind: "dir", confirmed: true });
  map.link(a.id, "s", d.id, { kind: "dir", confirmed: true });
  map.link(d.id, "e", c.id, { kind: "dir", confirmed: true });
  const direct = map.findPath(a.id, (r) => r.id === c.id, {})!;
  assert.equal(direct.length, 2);
  assert.equal(direct[0]!.to, b.id);
  const soft = map.findPath(a.id, (r) => r.id === c.id, { preferAvoid: [b.id] })!;
  assert.equal(soft.length, 2);
  assert.equal(soft[0]!.to, d.id);
});

test("setGlobalPreferAvoid merges into resolvePathOptions", () => {
  setGlobalPreferAvoid(["r10"]);
  assert.deepEqual(resolvePathOptions({}).preferAvoid, ["r10"]);
  setGlobalPreferAvoid([]);
});

test("pathing never takes the red stone (or homeland) unless allowLinks opts in", () => {
  const map = WorldMap.empty("t");
  const mk = (x: number, exits: string[]) => {
    const r = map.createRoom({ plane: "p1", x, y: 0, z: 0 });
    map.applyObservation(r, { mode: "brief", title: `room ${x}`, exits, contents: [] });
    return r;
  };
  const guild = mk(0, ["e"]);
  const street = mk(1, ["w", "e"]);
  const far = mk(2, ["w", "e"]);
  const dunagin = mk(3, ["w"]);
  map.link(guild.id, "e", street.id, { kind: "dir", confirmed: true });
  map.link(street.id, "e", far.id, { kind: "dir", confirmed: true });
  map.link(far.id, "e", dunagin.id, { kind: "dir", confirmed: true });
  map.link(guild.id, "touch red stone", dunagin.id, { kind: "special", confirmed: true, hidden: true });
  map.link(far.id, "w", guild.id, { kind: "dir", confirmed: true });
  map.link(street.id, "homeland", guild.id, { kind: "special", confirmed: true, hidden: true });

  const walked = map.findPath(guild.id, (r) => r.id === dunagin.id, resolvePathOptions({}));
  assert.deepEqual(walked?.map((s) => s.cmd), ["e", "e", "e"], "the walk avoids the teleporter");
  assert.equal(map.findPath(street.id, (r) => r.id === guild.id, {})?.map((s) => s.cmd).join(","), "e,w", "homeland is not a path link");
  assert.equal(map.stepDistances(guild.id, new Set([dunagin.id])).get(dunagin.id), 3);

  const ok = map.findPath(guild.id, (r) => r.id === dunagin.id, resolvePathOptions({ allowLinks: ["touch red stone"] }));
  assert.deepEqual(ok?.map((s) => s.cmd), ["touch red stone"], "explicit opt-in by command");
  assert.deepEqual(map.findPath(guild.id, (r) => r.id === dunagin.id, { allowLinks: [`${guild.id}:touch red stone`] })?.map((s) => s.cmd), ["touch red stone"]);
  assert.deepEqual(map.findPath(guild.id, (r) => r.id === dunagin.id, { allowLinks: ["*"] })?.map((s) => s.cmd), ["touch red stone"]);
});

test("linkNeverPathed matches red stone spellings only", () => {
  assert.equal(linkNeverPathed("r1544", "touch red stone"), true);
  assert.equal(linkNeverPathed("r1544", "Touch  the red stone"), true);
  assert.equal(linkNeverPathed("r1", "homeland"), true);
  assert.equal(linkNeverPathed("r1", "grab the handle"), false);
  assert.equal(linkNeverPathed("r1", "e"), false);
});

test("shared graph: no path out of Kalinport uses the red stone", () => {
  const map = new WorldMap(JSON.parse(fs.readFileSync("public/data/powermud.graph.json", "utf8")));
  for (const to of ["r1749", "r1751", "r1968"]) {
    const path = map.findPath("r1544", (r) => r.id === to, resolvePathOptions({}));
    assert.ok(!path?.some((s) => /red stone|homeland/.test(s.cmd)), `r1544 → ${to} must not touch the red stone`);
  }
});
