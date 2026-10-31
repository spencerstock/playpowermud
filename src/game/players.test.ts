import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enrichRoomPlayers,
  guildMatchesChannel,
  loadPowermudKnownPlayers,
  parsePowermudSocialLine,
} from "./players.js";
import type { RoomContent } from "./types.js";

test("known admin registry loads from data/powermud/known-players.json", () => {
  const reg = loadPowermudKnownPlayers();
  assert.ok(reg.get("weaver")?.roles.includes("admin"));
  assert.equal(reg.get("zedd")?.guild, "Ranger");
});

test("enrichRoomPlayers tags known admins as player kind", () => {
  const reg = loadPowermudKnownPlayers();
  const contents: RoomContent[] = [{ name: "Zedd", count: 1, kind: "unknown" }];
  const out = enrichRoomPlayers(contents, reg);
  assert.equal(out[0]!.kind, "player");
});

test("enrichRoomPlayers stores untracked PCs as npc until confirmed", () => {
  const reg = loadPowermudKnownPlayers();
  const pc: RoomContent = { name: "Hogi", count: 1, kind: "npc", path: "std/body/player#11028" };
  assert.equal(enrichRoomPlayers([pc], reg, null, () => false)[0]!.kind, "npc");
  assert.equal(enrichRoomPlayers([pc], reg, null, () => true)[0]!.kind, "player");
});

test("parsePowermudSocialLine handles channel, movement, and tell patterns", () => {
  assert.deepEqual(parsePowermudSocialLine("[Adventurer] You : hi"), {
    kind: "channel",
    name: "You",
    channel: "Adventurer",
    text: "hi",
  });
  assert.equal(parsePowermudSocialLine("Zedd arrives from the north.")?.kind, "arrive");
  assert.equal(parsePowermudSocialLine("Zedd leaves east.")?.kind, "leave");
  assert.equal(parsePowermudSocialLine("Weaver tells you hello.")?.kind, "tell");
});

test("guildMatchesChannel accepts melee-magthere guild label", () => {
  assert.ok(guildMatchesChannel("Melee-magthere", "Melee-Magthere"));
});
