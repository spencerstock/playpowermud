import assert from "node:assert/strict";
import { test } from "node:test";
import { auditWorldGraph } from "./audit.js";
import { fixMissingPlaneRooms, pruneDanglingRedirects, remediateMapErrors } from "./remediateAudit.js";
import { WorldMap } from "./WorldMap.js";

function graph(): WorldMap {
  const map = WorldMap.empty("t");
  map.doc.planes.p1 = { id: "p1", kind: "surface", createdAt: "t" };
  map.doc.nextPlane = 2;
  return map;
}

test("pruneDanglingRedirects removes a redirect whose target room is gone", () => {
  const map = graph();
  const keep = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.doc.redirects = { r523: "r519", r99: keep.id };
  assert.equal(pruneDanglingRedirects(map.doc), 1);
  assert.equal(map.doc.redirects?.r523, undefined);
  assert.equal(map.doc.redirects?.r99, keep.id);
});

test("fixMissingPlaneRooms lays out a fragment from its plane neighbor", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 9, y: 9, z: 0 });
  const c = map.createRoom({ plane: "p1", x: 8, y: 8, z: 0 });
  delete (b.pos as { plane?: string }).plane;
  delete (c.pos as { plane?: string }).plane;
  a.exits = ["w"];
  b.exits = ["e", "s"];
  c.exits = ["n"];
  a.links.w = { to: b.id, kind: "dir", confirmed: true, uses: 1 };
  b.links.e = { to: a.id, kind: "dir", confirmed: true, uses: 1 };
  b.links.s = { to: c.id, kind: "dir", confirmed: true, uses: 1 };
  c.links.n = { to: b.id, kind: "dir", confirmed: true, uses: 1 };
  assert.equal(fixMissingPlaneRooms(map), 2);
  assert.deepEqual(b.pos, { plane: "p1", x: -1, y: 0, z: 0 });
  assert.deepEqual(c.pos, { plane: "p1", x: -1, y: -1, z: 0 });
  assert.equal(auditWorldGraph(map.doc).findings.some((f) => f.code === "missing-plane"), false);
});

test("remediateMapErrors clears audit errors for redirect and missing plane", () => {
  const map = graph();
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 5, y: 5, z: 0 });
  delete (b.pos as { plane?: string }).plane;
  a.exits = ["n"];
  a.links.n = { to: b.id, kind: "dir", confirmed: true, uses: 1 };
  map.doc.redirects = { r404: "r405" };
  remediateMapErrors(map);
  assert.equal(auditWorldGraph(map.doc).findings.filter((f) => f.severity === "error").length, 0);
  assert.equal(b.pos.plane, "p1");
});
