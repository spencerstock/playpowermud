import assert from "node:assert/strict";
import test from "node:test";
import { computeAreaOverlays, type AreaLayoutRoom } from "./areaLayout.js";

test("computeAreaOverlays groups rooms and returns stable labels", () => {
  const rooms = [
    { area: "nal-shaddar", areaLabel: "Nal Shaddar", pos: { x: 0, y: 0 } },
    { area: "nal-shaddar", areaLabel: "Nal Shaddar", pos: { x: 1, y: 0 } },
    { area: "dunkrist", areaLabel: "Dunkrist", pos: { x: 10, y: 10 } },
    { area: "overworld", areaLabel: "Overworld", pos: { x: 5, y: 5 } },
  ];
  const a = computeAreaOverlays(rooms);
  const b = computeAreaOverlays(rooms);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  const nal = a.find((o) => o.areaId === "nal-shaddar");
  assert.ok(nal);
  assert.equal(nal!.label, "Nal Shaddar");
  assert.equal(nal!.roomCount, 2);
  assert.ok(Math.abs(nal!.x - 0.5) < 0.01);
});

test("computeAreaOverlays separates nearby areas along candidate anchors", () => {
  const rooms = [
    { area: "a", areaLabel: "Alpha", pos: { x: 0, y: 0 } },
    { area: "a", areaLabel: "Alpha", pos: { x: 1, y: 0 } },
    { area: "b", areaLabel: "Beta", pos: { x: 0, y: 1 } },
    { area: "b", areaLabel: "Beta", pos: { x: 1, y: 1 } },
  ];
  const overlays = computeAreaOverlays(rooms);
  assert.equal(overlays.length, 2);
  const alpha = overlays.find((o) => o.areaId === "a")!;
  const beta = overlays.find((o) => o.areaId === "b")!;
  assert.ok(Math.hypot(alpha.x - beta.x, alpha.y - beta.y) >= 0.5);
});

test("computeAreaOverlays splits disconnected blobs within one area id", () => {
  const northText =
    "You are in the Northern Warrens, in the Duergar city of Dunkrist.  Many houses.";
  const southText = "You are in the Southern Warrens, a residential district of Dunkrist.";
  const mk = (
    id: string,
    x: number,
    y: number,
    text: string,
    linkIds: string[],
  ): AreaLayoutRoom => ({
    id,
    area: "dunkrist",
    areaLabel: "Dunkrist",
    pos: { x, y, z: 0 },
    linkIds,
    description: text,
    text,
  });
  const rooms: AreaLayoutRoom[] = [
    mk("n1", 0, 0, northText, ["n2"]),
    mk("n2", 1, 0, northText, ["n1"]),
    mk("s1", 20, 20, southText, ["s2"]),
    mk("s2", 21, 20, southText, ["s1"]),
  ];
  const overlays = computeAreaOverlays(rooms, { z: 0 });
  assert.equal(overlays.length, 2);
  const labels = overlays.map((o) => o.label).sort();
  assert.ok(labels.some((l) => /northern warrens/i.test(l)));
  assert.ok(labels.some((l) => /southern warrens/i.test(l)));
});
