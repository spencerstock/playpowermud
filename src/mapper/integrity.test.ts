import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeIntegrity, repairIntegrity } from "./integrity.js";
import type { MapLink, MapRoom, WorldGraphDocument } from "./types.js";
import { emptyWorldGraph, WorldMap } from "./WorldMap.js";

const PROSE = (n: number) =>
  `You are standing in room number ${n} of a long hallway carved from black stone.  Torches\nflicker on the walls and the floor is worn smooth by many feet over the years.`;

function room(id: string, x: number, y: number, exits: string[], links: Record<string, string | null>, description: string): MapRoom {
  return {
    id,
    description,
    descKeys: [],
    exits,
    links: Object.fromEntries(
      Object.entries(links).map(([cmd, to]): [string, MapLink] => [cmd, { to, kind: "dir", confirmed: true, uses: 1 }]),
    ),
    pos: { plane: "p1", x, y, z: 0 },
    contents: {},
    tags: [],
    notes: [],
    meta: {},
    visits: 1,
    firstSeenAt: "",
    lastSeenAt: "",
  };
}

function doc(rooms: MapRoom[]): WorldGraphDocument {
  const d = emptyWorldGraph("t");
  for (const r of rooms) d.rooms[r.id] = r;
  d.nextRoom = 100;
  return d;
}

test("analyzeIntegrity finds unreachable clusters, the stitch that joins them, and islands", () => {
  const d = doc([
    room("r1", 0, 0, ["e"], { e: "r2" }, PROSE(1)),
    room("r2", 1, 0, ["w", "e"], { w: "r1" }, PROSE(2)), // lists e, but no link back to r3
    room("r3", 2, 0, ["w"], { w: "r2" }, PROSE(3)),
    room("r9", 9, 9, ["n"], {}, PROSE(9)),
  ]);
  d.rooms.r1!.visits = 50;
  const report = analyzeIntegrity(d);
  assert.equal(report.anchor, "r1");
  assert.deepEqual(report.unreachable.map((c) => c.rooms), [["r3"]]);
  assert.deepEqual(report.unreachable[0]!.boundary[0]!.stitch, { from: "r2", cmd: "e", to: "r3" });
  assert.equal(report.unreachable[0]!.boundary[0]!.why, "stitchable");
  assert.deepEqual(report.islands.map((i) => i.rooms), [["r9"]]);

  const map = new WorldMap(d);
  const fix = repairIntegrity(map, report);
  assert.equal(fix.linksStitched, 1);
  assert.equal(map.room("r2")!.links.e!.to, "r3");
  assert.equal(map.room("r2")!.links.e!.confirmed, false, "stitched links stay inferred until walked");
  assert.equal(analyzeIntegrity(map.doc).unreachable.length, 0);
});

test("a boundary link whose far room leads elsewhere is a conflict, not a stitch", () => {
  const d = doc([
    room("r1", 0, 0, ["e"], { e: "r2" }, PROSE(1)),
    room("r2", 1, 0, ["w", "e"], { w: "r1", e: "r4" }, PROSE(2)),
    room("r3", 2, 0, ["w"], { w: "r2" }, PROSE(3)),
    room("r4", 2, 1, ["w"], { w: "r2" }, PROSE(4)),
  ]);
  d.rooms.r1!.visits = 50;
  const report = analyzeIntegrity(d);
  const b = report.unreachable.flatMap((c) => c.boundary).find((x) => x.from === "r3")!;
  assert.equal(b.why, "conflict");
  assert.equal(b.other, "r4");
  assert.equal(b.stitch, undefined);
});

test("duplicates are compared on scrubbed prose; distinctive copies with a shared exit are proven", () => {
  const prose = PROSE(5);
  const d = doc([
    room("r1", 0, 0, ["e"], { e: "r2" }, PROSE(1)),
    room("r2", 1, 0, ["w", "e"], { w: "r1", e: "r3" }, prose),
    room("r3", 2, 0, ["w"], { w: "r2" }, PROSE(3)),
    // Copy of r2 minted while lost, with a leaked line on top.
    room("r7", 5, 5, ["w", "e"], { e: "r3" }, `You stop hiding.\n${prose}`),
  ]);
  d.rooms.r1!.visits = 50;
  d.rooms.r2!.visits = 20;
  const report = analyzeIntegrity(d);
  const dup = report.duplicates.find((g) => g.rooms.includes("r7"))!;
  assert.equal(dup.confidence, "certain");
  assert.equal(dup.keep, "r2");
  assert.ok(dup.evidence.includes("shared-exit"));
  assert.ok(dup.evidence.includes("split-by-noise"));

  const map = new WorldMap(d);
  const fix = repairIntegrity(map, report);
  assert.equal(fix.duplicatesMerged, 1);
  assert.equal(map.room("r7")?.id, "r2", "the copy redirects to the survivor");
});

test("repeating prose (a road cycling a few texts) needs the same cell to prove a copy", () => {
  const road = PROSE(42);
  const d = doc([
    room("r1", 0, 0, ["e"], { e: "r2" }, PROSE(1)),
    room("r2", 1, 0, ["w", "e"], { w: "r1", e: "r3" }, road),
    room("r3", 2, 0, ["w", "e"], { w: "r2", e: "r4" }, PROSE(3)),
    room("r4", 3, 0, ["w", "e"], { w: "r3", e: "r5" }, road),
    room("r5", 4, 0, ["w"], { w: "r4" }, PROSE(5)),
    room("r6", 9, 0, ["w", "e"], { e: "r3" }, road),
  ]);
  const report = analyzeIntegrity(d);
  assert.ok(report.duplicates.every((g) => g.confidence !== "certain"));
});

// Guard for the committed map: a sync that brings leaked lines or proven duplicates back fails here.
const LIVE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/world/powermud.graph.json");
test("committed world graph has no leaked description lines and no proven duplicate rooms", { skip: !fs.existsSync(LIVE) }, () => {
  const graph = JSON.parse(fs.readFileSync(LIVE, "utf8")) as WorldGraphDocument;
  const report = analyzeIntegrity(graph);
  const leaked = report.contaminated.map((c) => `${c.room}: ${c.removed.map((r) => r.text.slice(0, 50)).join(" | ")}`);
  assert.deepEqual(leaked.slice(0, 10), [], `${leaked.length} rooms; run: node --import tsx scripts/map-integrity.ts --fix`);
  const proven = report.duplicates.filter((g) => g.confidence === "certain").map((g) => g.rooms.join("="));
  assert.deepEqual(proven, []);
});
