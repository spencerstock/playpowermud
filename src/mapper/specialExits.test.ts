import assert from "node:assert/strict";
import test from "node:test";
import { GameStream, splitEchoCommands } from "../game/stream.js";
import { aliasTravelSteps, checkAliasTruth, walkAliasRoute } from "./aliasTruth.js";
import { Mapper } from "./Mapper.js";
import { looksLikeTravelCommand } from "./specialExits.js";
import { layoutAround } from "./viewLayout.js";
import { WorldMap } from "./WorldMap.js";

const P = "> ";

function harness() {
  const map = WorldMap.empty("test");
  const mapper = new Mapper(map);
  const stream = new GameStream();
  return {
    map,
    mapper,
    /** Queue commands without any output yet (a batch on the wire). */
    send(...cmds: string[]) {
      for (const c of cmds) mapper.onCommandSent(c);
    },
    out(text: string) {
      for (const ev of stream.feed(text)) mapper.onGameEvent(ev);
    },
    step(cmd: string | null, text: string) {
      if (cmd) for (const c of cmd.split(";")) mapper.onCommandSent(c.trim());
      for (const ev of stream.feed(text)) mapper.onGameEvent(ev);
    },
    here: () => mapper.current()!,
  };
}

/** A (e) — B (w, e) — C (w), walked both ways so every link is confirmed. */
function corridor() {
  const h = harness();
  h.step(null, `A (e)\n${P}`);
  const a = h.here();
  h.step("e", `B (w, e)\n${P}`);
  const b = h.here();
  h.step("e", `C (w)\n${P}`);
  const c = h.here();
  h.step("w", `B (w, e)\n${P}`);
  h.step("w", `A (e)\n${P}`);
  return { h, a, b, c };
}

test("travel verbs and room nouns look like exits; attacks and chatter do not", () => {
  assert.ok(looksLikeTravelCommand("enter crack"));
  assert.ok(looksLikeTravelCommand("climb up"));
  assert.ok(looksLikeTravelCommand("leap to crack"));
  assert.ok(looksLikeTravelCommand("island", { description: "A small island lies across the water.", exits: [] }));
  assert.ok(!looksLikeTravelCommand("double-thrust"));
  assert.ok(!looksLikeTravelCommand("globe of darkness on lich"));
  assert.ok(!looksLikeTravelCommand("common albodor norg", { description: "A plain hallway.", exits: [] }));
});

test("an attack still queued when a move's display arrives is not recorded as an exit", () => {
  const { h, a, b } = corridor();
  // The attack is answered late (combat round): the move's room shows up while it heads the queue.
  h.send("double-thrust", "e");
  h.out(`B (w, e)\n${P}`);
  assert.equal(h.here().id, b.id);
  assert.equal(a.links["double-thrust"], undefined, "no secret exit minted");
  assert.ok(a.links.e!.uses >= 2, "the known exit is credited");
});

test("a spammed travel command is credited to the exit that already leads there", () => {
  const { h, a, b } = corridor();
  // `enter crack;e` from an alias; the crack does nothing here and gets no prompt of its own.
  h.send("enter crack", "e");
  h.out(`B (w, e)\n${P}`);
  assert.equal(h.here().id, b.id);
  assert.equal(a.links["enter crack"], undefined);
  assert.deepEqual(Object.keys(a.links), ["e"]);
});

test("a real secret exit into an unknown room is still learned", () => {
  const { h, a } = corridor();
  h.step("enter crack", `Hidden Cave (out)\n${P}`);
  assert.equal(h.here().title, "Hidden Cave");
  assert.equal(a.links["enter crack"]?.to, h.here().id);
  assert.equal(a.links["enter crack"]?.kind, "special");
});

test("one odd arrival does not re-point a well-walked exit; a repeat does", () => {
  const { h, a, b } = corridor();
  for (let i = 0; i < 3; i++) {
    h.step("e", `B (w, e)\n${P}`);
    h.step("w", `A (e)\n${P}`);
  }
  assert.ok(a.links.e!.uses >= 4);
  h.mapper.setPosition(a.id);
  for (let i = 0; a.links.e!.uses < 5; i++) {
    h.step("e", `B (w, e)\n${P}`);
    h.step("w", `A (e)\n${P}`);
  }
  // A display from somewhere else entirely gets credited to `e` once.
  h.mapper.setPosition(a.id);
  h.step("e", `Strange Vault (w, n)\n${P}`);
  assert.equal(a.links.e!.to, b.id, "link survives a single contradiction");
  assert.equal(a.links.e!.contested?.count, 1);
  h.mapper.setPosition(a.id);
  h.step("e", `B (w, e)\n${P}`);
  assert.equal(a.links.e!.contested, undefined, "a normal walk clears the doubt");
  h.mapper.setPosition(a.id);
  h.step("e", `Strange Vault (w, n)\n${P}`);
  h.mapper.setPosition(a.id);
  h.step("e", `Strange Vault (w, n)\n${P}`);
  assert.notEqual(a.links.e!.to, b.id, "the same new room twice re-points it");
});

test("heal drops self-learned secret exits that duplicate a listed, walked exit", () => {
  const { h, a, b, c } = corridor();
  h.step("e", `B (w, e)\n${P}`);
  h.step("w", `A (e)\n${P}`);
  h.map.link(a.id, "enter crack", b.id, { kind: "special", confirmed: true, hidden: true });
  for (let i = 0; i < 40; i++) h.map.link(a.id, "enter crack", b.id, { kind: "special", confirmed: true, hidden: true });
  // Two secret commands to one room with no listed rival: the well-used one stays.
  const cave = h.map.createRoom({ plane: h.map.newPlane("aside").id, x: 0, y: 0, z: 0 });
  cave.title = "Cave";
  cave.exits = ["out"];
  h.map.link(cave.id, "out", c.id, { kind: "named", confirmed: true });
  for (let i = 0; i < 20; i++) h.map.link(c.id, "climb up", cave.id, { kind: "special", confirmed: true, hidden: true });
  h.map.link(c.id, "enter fissure", cave.id, { kind: "special", confirmed: true, hidden: true });
  // A scripted exit is someone's decision and stays even when redundant.
  const scripted = h.map.link(b.id, "push wall", c.id, { kind: "special", confirmed: true, hidden: true });
  scripted.pre = ["unlock wall"];
  const report = h.map.heal({ protect: [a.id] });
  assert.equal(a.links["enter crack"], undefined);
  assert.equal(a.links.e?.to, b.id);
  assert.equal(c.links["climb up"]?.to, cave.id);
  assert.equal(c.links["enter fissure"], undefined);
  assert.equal(b.links["push wall"]?.to, c.id);
  assert.equal(report.redundantSpecials, 2);
});

test("view layout: stacked rooms get their own cells and aside rooms sit beside their door", () => {
  const { h, a, b, c } = corridor();
  // The stored grid went wrong: C is stacked on A's cell.
  h.map.setPos(c, { ...a.pos });
  const cave = h.map.createRoom({ plane: h.map.newPlane("aside").id, x: 40, y: 40, z: 0 });
  h.map.link(b.id, "enter crack", cave.id, { kind: "special", confirmed: true, hidden: true });
  const lay = layoutAround(h.map, a.id, { radius: 5 });
  const at = (id: string) => lay.cells.get(id)!;
  assert.deepEqual(at(a.id), { x: a.pos.x, y: a.pos.y, z: a.pos.z });
  assert.deepEqual(at(b.id), { x: a.pos.x + 1, y: a.pos.y, z: a.pos.z });
  assert.deepEqual(at(c.id), { x: a.pos.x + 2, y: a.pos.y, z: a.pos.z }, "placed by its link, not its stored cell");
  const cv = at(cave.id);
  assert.ok(cv && Math.abs(cv.x - at(b.id).x) <= 1 && Math.abs(cv.y - at(b.id).y) <= 1, "aside room next to its door");
  assert.ok(lay.aside.has(cave.id));
  assert.equal(new Set([...lay.cells.values()].map((p) => `${p.x},${p.y},${p.z}`)).size, lay.cells.size, "one room per cell");
});

test("alias round trips: clean routes verify links, a stray secret exit is exposed and removed", () => {
  // A (e) — B (w, n), C (s) north of B.
  const h = harness();
  h.step(null, `A (e)\n${P}`);
  const a = h.here();
  h.step("e", `B (w, n)\n${P}`);
  const b = h.here();
  h.step("n", `C (s)\n${P}`);
  const c = h.here();
  h.step("s", `B (w, n)\n${P}`);
  h.step("w", `A (e)\n${P}`);
  const aliases = new Map([
    ["mstoc", "e;enter crack;enter crack;n"],
    ["ctoms", "{s;w}"],
  ]);
  assert.deepEqual(aliasTravelSteps("{2n;look}"), ["n", "n", "look"]);
  assert.equal(aliasTravelSteps("#if (@x) {n}"), null);
  let report = checkAliasTruth(h.map, aliases, a.id, { apply: true });
  assert.equal(report.pairs[0]!.status, "verified");
  assert.equal(report.pairs[0]!.placeRoom, c.id);
  assert.equal(a.links.e!.verified, "alias");
  assert.equal(c.links.s!.verified, "alias");
  // A misattributed `enter crack` in B sends the walk back to A, where `n` goes nowhere: the
  // round trip only works on the map without that link.
  h.map.link(b.id, "enter crack", a.id, { kind: "special", confirmed: true, hidden: true });
  const check = walkAliasRoute(h.map, a.id, ["e", "enter crack", "enter crack", "n", "s", "w"], a.id);
  assert.deepEqual([...new Set(check.suspects.map((s) => `${s.room}:${s.cmd}`))], [`${b.id}:enter crack`]);
  report = checkAliasTruth(h.map, aliases, a.id, { apply: true });
  assert.equal(report.removed, 1);
  assert.equal(b.links["enter crack"], undefined);
  assert.equal(report.pairs[0]!.status, "verified");
  // A stretch the map does not have leaves the pair open, and nothing is touched.
  aliases.set("mstoc", "e;n;ne");
  aliases.set("ctoms", "sw;s;w");
  report = checkAliasTruth(h.map, aliases, a.id, { apply: true });
  assert.equal(report.pairs[0]!.status, "open");
  assert.equal(report.removed, 0);
});

test("echo lines: only the expansion of an alias is wire commands", () => {
  assert.deepEqual(splitEchoCommands("alias mstoblack => s ; s ; sw"), ["s", "s", "sw"]);
  assert.deepEqual(splitEchoCommands("alias n bs lich s => n ; backstab lich ; s"), ["n", "backstab lich", "s"]);
  assert.deepEqual(splitEchoCommands("/to ms => w"), ["w"]);
  assert.deepEqual(splitEchoCommands("look"), ["look"]);
  assert.deepEqual(splitEchoCommands("n;e"), ["n", "e"]);
});
