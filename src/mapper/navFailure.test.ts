import assert from "node:assert/strict";
import test from "node:test";
import { Mapper } from "./Mapper.js";
import { GameStream } from "../game/stream.js";
import {
  FLAKY_MOVE_MAX_ATTEMPTS,
  flakyBatchRepeatCount,
  isFlakyTravelCommand,
  isOneWayAsideExit,
  moveMaxAttempts,
  retryCompassMove,
  type FlakyTravelContext,
} from "./navFailure.js";
import { FLAKY_BATCH_REPEATS } from "./flakyTravelCatalog.js";
import { NAV_FAILURES_BEFORE_HEAL, WorldMap } from "./WorldMap.js";

const P = "[HP:100 SP:50]";

test("forgetRoomGrindMob removes NPC from contents and npcs", () => {
  const map = WorldMap.empty("test");
  const r = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(r, {
    mode: "verbose",
    title: "Market",
    exits: ["n"],
    contents: [{ name: "Duergar merchant", kind: "npc", count: 1 }],
  });
  assert.ok(map.room(r.id)?.contents["Duergar merchant"]);
  assert.ok(map.forgetRoomGrindMob(r.id, "Duergar merchant"));
  assert.equal(map.room(r.id)?.contents["Duergar merchant"], undefined);
});

test("recordNavigationFailure removes phantom link and orphan after threshold", () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Market", exits: ["n", "e", "se"], contents: [] });
  const b = map.createRoom({ plane: "p1", x: -1, y: 0, z: 0 });
  map.applyObservation(b, { mode: "brief", title: "Phantom", exits: ["n", "e", "se"], contents: [] });
  map.link(a.id, "w", b.id, { kind: "dir", confirmed: true });

  let healed = false;
  for (let i = 0; i < NAV_FAILURES_BEFORE_HEAL; i++) {
    const rec = map.recordNavigationFailure(a.id, "w", "You cannot go that direction.");
    if (rec.healed) {
      healed = true;
      assert.match(rec.detail ?? "", /removed link|deleted orphan|merged/);
      break;
    }
  }
  assert.equal(healed, true);
  assert.equal(a.links.w, undefined);
  assert.equal(map.room(b.id), undefined);
});

test("mapper counts failures on confirmed links not listed in exits", () => {
  const map = WorldMap.empty("test");
  const mapper = new Mapper(map);
  const stream = new GameStream();
  let t = 0;
  const step = (cmd: string | null, output: string) => {
    t += 100;
    if (cmd) mapper.onCommandSent(cmd, t);
    for (const ev of [...stream.feed(output), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  step(null, `Market (n, e, se)\n${P}`);
  const market = mapper.current()!;
  const phantom = map.createRoom({ plane: market.pos.plane, x: market.pos.x - 1, y: 0, z: 0 });
  map.link(market.id, "w", phantom.id, { kind: "dir", confirmed: true });
  step("w", `You cannot go that direction.\n${P}`);
  assert.equal(market.links.w?.failCount, 1);
  assert.ok(market.links.w?.blocked);
});

test("flaky travel commands are detected from aliases-style verbs", () => {
  assert.equal(isFlakyTravelCommand("n"), false);
  assert.equal(isFlakyTravelCommand("enter crack"), true);
  assert.equal(isFlakyTravelCommand("climb up"), true);
  assert.equal(isFlakyTravelCommand("search southern wall"), true);
  assert.equal(isFlakyTravelCommand("out", { kind: "named", to: "r2" }), false);
  assert.equal(isFlakyTravelCommand("push west wall"), true);
  assert.equal(isFlakyTravelCommand("move south"), true);
  assert.equal(isFlakyTravelCommand("enter hole"), true);
  assert.ok(Object.keys(FLAKY_BATCH_REPEATS).length >= 30, "alias catalog should list spammed cmds");
  assert.equal(flakyBatchRepeatCount("move south"), 10);
  assert.equal(flakyBatchRepeatCount("enter crack"), 4);
});

test("named shop out is not flaky when the destination links back", () => {
  const map = WorldMap.empty("test");
  const shop = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const street = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  map.link(shop.id, "out", street.id, { kind: "named", confirmed: true });
  map.link(street.id, "out", shop.id, { kind: "named", confirmed: true });
  const ctx: FlakyTravelContext = { map, fromId: shop.id };
  assert.equal(isFlakyTravelCommand("out", shop.links.out, ctx), false);
  assert.equal(isOneWayAsideExit(ctx, shop.links.out!), false);
});

test("one-way special with prior failures is flaky", () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p2", x: 0, y: 0, z: 0 });
  map.link(a.id, "pry floorboard", b.id, { kind: "special", confirmed: true, hidden: true });
  a.links["pry floorboard"]!.failCount = 1;
  const ctx: FlakyTravelContext = { map, fromId: a.id };
  assert.equal(isFlakyTravelCommand("pry floorboard", a.links["pry floorboard"], ctx), true);
});

test("retryCompassMove spams flaky exits without healing the link", async () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Tunnel", exits: ["s"], contents: [] });
  const b = map.createRoom({ plane: "p2", x: 0, y: 0, z: 0 });
  map.link(a.id, "enter crack", b.id, { kind: "special", confirmed: true, hidden: true });
  let sends = 0;
  const r = await retryCompassMove({
    fromId: a.id,
    cmd: "enter crack",
    map,
    send: async () => {
      sends += 1;
      return { output: sends < 3 ? "You fail to enter the crack.\n" : `Crack Room (s)\n${P}` };
    },
    moved: () => sends >= 3,
  });
  assert.equal(r.ok, true);
  assert.equal(sends, 3);
  assert.equal(a.links["enter crack"]?.failCount, undefined);
  assert.equal(a.links["enter crack"]?.to, b.id);
});

test("retryCompassMove aborts after silent failures and shouldAbort", async () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Shop", exits: ["nw"], contents: [] });
  const b = map.createRoom({ plane: "p1", x: -1, y: 0, z: 0 });
  map.link(a.id, "nw", b.id, { kind: "dir", confirmed: true });
  let sends = 0;
  let phase = "in-game" as string;
  const r = await retryCompassMove({
    fromId: a.id,
    cmd: "nw",
    map,
    send: async () => {
      sends += 1;
      return { output: "" };
    },
    moved: () => false,
    shouldAbort: () => phase !== "in-game",
  });
  assert.equal(r.ok, false);
  assert.equal(sends, 2);
  assert.match(r.detail ?? "", /silent|aborted/i);
  phase = "disconnected";
  sends = 0;
  const r2 = await retryCompassMove({
    fromId: a.id,
    cmd: "nw",
    map,
    send: async () => {
      sends += 1;
      return { output: "" };
    },
    moved: () => false,
    shouldAbort: () => phase !== "in-game",
  });
  assert.equal(r2.ok, false);
  assert.equal(sends, 0);
});

test("retryCompassMove uses full flaky attempt budget before giving up", async () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p2", x: 0, y: 0, z: 0 });
  map.link(a.id, "climb up", b.id, { kind: "special", confirmed: true });
  let sends = 0;
  const r = await retryCompassMove({
    fromId: a.id,
    cmd: "climb up",
    map,
    send: async () => {
      sends += 1;
      return { output: "You fail to climb.\n" };
    },
    moved: () => false,
  });
  assert.equal(r.ok, false);
  assert.equal(sends, FLAKY_MOVE_MAX_ATTEMPTS);
  assert.equal(a.links["climb up"]?.to, b.id);
});

test("an unlisted compass link the game keeps refusing is dropped after a few tries, not 20", () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Road", exits: ["n", "s"], contents: [] });
  const b = map.createRoom({ plane: "p1", x: -1, y: 1, z: 0 });
  map.applyObservation(b, { mode: "brief", title: "Alley", exits: ["se"], contents: [] });
  map.link(a.id, "nw", b.id, { kind: "dir", confirmed: true });
  assert.equal(map.recordNavigationFailure(a.id, "nw", "You cannot go that direction.").healed, false);
  assert.equal(map.recordNavigationFailure(a.id, "nw", "You cannot go that direction.").healed, false);
  assert.equal(map.recordNavigationFailure(a.id, "nw", "You cannot go that direction.").healed, true);
  assert.equal(a.links.nw, undefined);
  // A listed exit that refuses (a guard, a closed gate) is kept far longer.
  const c = map.createRoom({ plane: "p1", x: 0, y: -1, z: 0 });
  map.link(a.id, "s", c.id, { kind: "dir", confirmed: true });
  for (let i = 0; i < 5; i++) map.recordNavigationFailure(a.id, "s", "You cannot go that direction.");
  assert.equal(a.links.s?.to, c.id);
  assert.equal(moveMaxAttempts("s", a.links.s), 3, "a walk tries a plain exit only a few times before rerouting");
});
