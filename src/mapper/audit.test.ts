import assert from "node:assert/strict";
import { test } from "node:test";
import { auditExitCode, auditWorldGraph, formatMapAudit, parseAuditArgs } from "./audit.js";
import type { MapLink } from "./types.js";
import { WorldMap } from "./WorldMap.js";

function graph(): WorldMap {
  const map = WorldMap.empty("t");
  map.doc.planes.p1 = { id: "p1", kind: "surface", createdAt: "t" };
  map.doc.nextPlane = 2;
  return map;
}

function connect(room: { id: string; exits: string[]; links: Record<string, MapLink> }, cmd: string, to: string, kind: MapLink["kind"] = "dir"): void {
  if (!room.exits.includes(cmd)) room.exits.push(cmd);
  room.links[cmd] = { to, kind, confirmed: true, uses: 1 };
}

test("a consistent pair of rooms has nothing to report", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 0, y: 1, z: 0 });
  a.title = "Gate";
  b.title = "Road";
  connect(a, "n", b.id);
  connect(b, "s", a.id);
  const audit = auditWorldGraph(map.doc);
  assert.deepEqual(audit.findings, []);
  assert.equal(audit.components, 1);
  assert.equal(auditExitCode(audit), 0);
});

test("flags dangling links, stale merge targets, overlaps, and bad geometry", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const c = map.createRoom({ plane: "p1", x: 4, y: 4, z: 0 });
  a.title = "Gate";
  b.title = "Shop";
  c.title = "Alley";
  a.exits = ["n"];
  connect(a, "n", c.id);
  a.links.e = { to: "r404", kind: "dir", confirmed: true, uses: 1 };
  map.doc.redirects = { r99: b.id };
  c.links.w = { to: "r99", kind: "dir", confirmed: true, uses: 1 };
  c.exits = ["w"];
  const codes = auditWorldGraph(map.doc).findings.map((f) => f.code);
  assert.ok(codes.includes("overlap"));
  assert.ok(codes.includes("geometry"));
  assert.ok(codes.includes("dangling-link"));
  assert.ok(codes.includes("stale-target"));
  assert.equal(auditExitCode(auditWorldGraph(map.doc)), 1);
});

test("flags a one-way return, a reverse that points elsewhere, and an exit the room does not list", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 0, y: 1, z: 0 });
  const c = map.createRoom({ plane: "p1", x: 1, y: 1, z: 0 });
  a.title = "Gate";
  b.title = "Road";
  c.title = "Lane";
  a.exits = ["n"];
  b.exits = ["s", "e"];
  connect(a, "n", b.id);
  connect(b, "s", c.id);
  b.links.out = { to: c.id, kind: "dir", confirmed: true, uses: 1 };
  const codes = new Set(auditWorldGraph(map.doc).findings.map((f) => f.code));
  assert.ok(codes.has("reverse-conflict"));
  assert.ok(codes.has("link-kind"));
  assert.ok(codes.has("unlisted-exit"));
  assert.ok(!codes.has("one-way"), "a conflicting return is not also a missing return");

  delete b.links.s;
  const again = new Set(auditWorldGraph(map.doc).findings.map((f) => f.code));
  assert.ok(again.has("one-way"));
  assert.ok(!again.has("reverse-conflict"));
});

test("keeps a confirmed compass link the exit list omitted when the grid agrees", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  a.title = "Market";
  b.title = "Shop";
  a.exits = ["w"];
  b.exits = ["w"];
  connect(a, "e", b.id);
  const codes = auditWorldGraph(map.doc).findings.map((f) => f.code);
  assert.ok(!codes.includes("unlisted-exit"));
  assert.ok(codes.includes("one-way"));
});

test("flags an unstitched neighbor and a duplicated room that leaves the same way", () => {
  const map = graph();
  const hall = map.createRoom({ plane: "p1", x: 0, y: 2, z: 0 });
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 2, y: 0, z: 0 });
  const shore = map.createRoom({ plane: "p1", x: 5, y: 0, z: 0 });
  const rocks = map.createRoom({ plane: "p1", x: 6, y: 0, z: 0 });
  hall.title = "Hall";
  a.title = "Hall";
  b.title = "Hall";
  shore.title = "Shore";
  rocks.title = "Rocks";
  hall.exits = ["s"];
  a.exits = ["n"];
  b.exits = ["n"];
  shore.exits = ["e"];
  rocks.exits = ["w"];
  connect(a, "n", hall.id);
  connect(b, "n", hall.id);
  const codes = new Set(auditWorldGraph(map.doc).findings.map((f) => f.code));
  assert.ok(codes.has("likely-duplicate"));
  assert.ok(codes.has("unstitched"));
});

test("flags leaked description lines, a stale npc index, and a room with no plane", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  a.title = "Tavern";
  a.description = "Autosave.\nYou are in a small tavern with a long wooden bar.";
  a.descKeys = ["you are in a small tavern with a long wooden bar."];
  a.contents = { bar: { name: "Bartender", kind: "npc", lastCount: 1, seenCount: 1, lastSeenAt: "t" } };
  a.npcs = ["Nope"];
  delete (a.pos as { plane?: string }).plane;
  const codes = new Set(auditWorldGraph(map.doc).findings.map((f) => f.code));
  assert.ok(codes.has("dirty-description"));
  assert.ok(codes.has("npc-index"));
  assert.ok(codes.has("missing-plane"));
});

test("format and code filter", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  a.links.n = { to: "r404", kind: "dir", confirmed: true, uses: 1 };
  const audit = auditWorldGraph(map.doc, { codes: ["dangling-link"] });
  assert.equal(audit.findings.length, 1);
  assert.match(formatMapAudit(audit), /dangling-link/);
  assert.deepEqual(parseAuditArgs(["--code", "overlap", "--limit", "5", "--strict"]).codes, ["overlap"]);
});
