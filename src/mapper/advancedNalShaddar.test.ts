import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { advancedNalShaddarZones, clearCommands, killCommands, mineSpeedwalk, mobKey, svirfneblinMineZone } from "./advancedNalShaddar.js";
import type { WorldGraphDocument } from "./types.js";

const doc = JSON.parse(fs.readFileSync("data/world/powermud.graph.json", "utf8")) as WorldGraphDocument;

test("advanced Nal Shaddar clears the svirfneblin mine and skips the drow priestess", () => {
  const zones = advancedNalShaddarZones(doc);
  assert.deepEqual(zones.map((z) => z.id), ["svirfneblin-mine"]);
  const mine = zones[0]!;
  assert.equal(mine.startId, svirfneblinMineZone(doc).startId);

  assert.deepEqual(mine.skip, [{ id: "r243", why: "Drow Priestess" }]);
  const clear = new Set(mine.rooms.map((r) => r.id));
  assert.equal(clear.has("r243"), false);
  assert.equal(clear.has("r242"), true, "antechamber is cleared; the priestess is the next room east");
  assert.equal(mine.startId, "r195");

  for (const room of Object.values(doc.rooms)) {
    const names = Object.values(room.contents ?? {})
      .filter((c) => c.kind === "npc")
      .map((c) => mobKey(c.name));
    if (!names.includes("svirfneblin miner")) continue;
    assert.equal(clear.has(room.id), true, `${room.id} has a svirfneblin miner`);
  }

  const seen = new Set<string>([mine.startId]);
  let here = mine.startId;
  for (const step of mine.steps) {
    const link = Object.entries(doc.rooms[here]!.links).find(([cmd, l]) => l.to === step.to && cmd.replace(/^go /, "") === step.cmd);
    assert.ok(link, `${here} ${step.cmd} -> ${step.to}`);
    assert.equal(step.to === "r243", false);
    here = step.to;
    if (step.kills.length) {
      assert.equal(seen.has(step.to), false, `kills only on the first visit to ${step.to}`);
      seen.add(step.to);
    }
  }
  assert.equal(here, mine.startId, "the clear walks back to the mine mouth");
  assert.deepEqual(seen, clear);

  const killed = new Set(mine.rooms.flatMap((r) => r.kills.map((k) => k.name)));
  assert.equal(killed.has("Drow Priestess"), false);
  assert.equal(killed.has("Waefus, Duergar Assassin"), false);
  assert.equal(killed.has("Amethyst"), false);
  assert.equal(killed.has("Drow slavemaster"), false);
  assert.ok(killed.has("Svirfneblin Miner"));
  assert.ok(killed.has("Svirfneblin Illusionist"));
  assert.ok(killed.has("Drow Slavemaster"));
  assert.ok(killed.has("Drow Bodyguard"));
  const script = clearCommands(mine);
  assert.equal(script.includes("kill Drow Priestess"), false);
  assert.equal(script.includes("kill Waefus, Duergar Assassin"), false);
  assert.equal(script[0], "kill Svirfneblin Miner");

  const mouth = mine.rooms[0]!;
  assert.equal(mouth.id, "r195");
  assert.ok(killCommands(mouth.kills).some((c) => c === "kill Svirfneblin Miner"));
  const walk = mineSpeedwalk(mine);
  assert.equal(walk.includes("r243"), false);
  const page = fs.readFileSync("public/wiki/world/underdark.html", "utf8");
  assert.ok(page.includes(walk), "underdark directions publish the mine covering walk");
  assert.match(page, /Do not go east from the fancy antechamber/);
});
