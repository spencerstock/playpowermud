import assert from "node:assert/strict";
import test from "node:test";
import { Mapper } from "./Mapper.js";
import { GameStream } from "../game/stream.js";
import {
  FLAKY_MOVE_MAX_ATTEMPTS,
  HINDERED_MOVE_MAX_ATTEMPTS,
  flakyBatchRepeatCount,
  isFlakyTravelCommand,
  isOneWayAsideExit,
  moveMaxAttempts,
  recordUncountedMoveFailure,
  retryCompassMove,
  type FlakyTravelContext,
} from "./navFailure.js";
import { FLAKY_BATCH_REPEATS } from "./flakyTravelCatalog.js";
import { BLOCK_AFTER_CONSECUTIVE_FAILS, NAV_FAILURES_BEFORE_HEAL, WorldMap } from "./WorldMap.js";

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
  assert.equal(market.links.w?.blocked, undefined, "one refusal does not take the exit off the path");
});

test("flaky travel commands are detected from aliases-style verbs", () => {
  assert.equal(isFlakyTravelCommand("n"), false);
  assert.equal(isFlakyTravelCommand("enter crack"), true);
  assert.equal(isFlakyTravelCommand("climb up"), true);
  assert.equal(isFlakyTravelCommand("search southern wall"), true);
  assert.equal(isFlakyTravelCommand("out", { kind: "named", to: "r2", confirmed: true }), false);
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

const noPause = async () => {};

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
    pause: noPause,
    send: async () => {
      sends += 1;
      return { output: sends < 3 ? "You fail to enter the crack.\n" : `Crack Room (s)\n${P}` };
    },
    moved: () => sends >= 3,
  });
  assert.equal(r.ok, true);
  assert.equal(sends, 3);
  assert.equal(a.links["enter crack"]?.failCount ?? 0, 0, "a success clears the streak");
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
    pause: noPause,
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
    pause: noPause,
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
    pause: noPause,
    send: async () => {
      sends += 1;
      return { output: "You fail to climb.\n" };
    },
    moved: () => false,
  });
  assert.equal(r.ok, false);
  assert.equal(sends, FLAKY_MOVE_MAX_ATTEMPTS);
  assert.equal(a.links["climb up"]?.to, b.id);
  assert.equal(a.links["climb up"]?.failCount, FLAKY_MOVE_MAX_ATTEMPTS);
  assert.equal(a.links["climb up"]?.blocked, undefined);
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
  assert.equal(a.links.s?.blocked, undefined, "five refusals stay on the path");
  assert.equal(moveMaxAttempts("s", a.links.s), 3, "a walk tries a plain exit only a few times before rerouting");
});

// Real Powermud line, Zurker at r1540 (Kalin caravan route start) 2026-11-01: the Small boy
// tripped five `ne` tries in a row and the walker blocked the link, breaking the kobold route.
// A short streak is counted so it can add up, but it does not block the only way through.
test("a mob in your way counts toward the streak but does not block after a few tries", async () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Forest trail", exits: ["w", "se"], contents: [] });
  const b = map.createRoom({ plane: "p1", x: -1, y: 0, z: 0 });
  map.applyObservation(b, { mode: "brief", title: "Forest trail west", exits: ["e"], contents: [] });
  map.link(a.id, "w", b.id, { kind: "dir", confirmed: true });
  let sends = 0;
  let pauses = 0;
  const r = await retryCompassMove({
    fromId: a.id,
    cmd: "w",
    map,
    maxAttempts: 3,
    pause: async () => {
      pauses += 1;
    },
    send: async () => {
      sends += 1;
      return { output: `A Lookout is right in your way!\n${P}` };
    },
    moved: () => false,
  });
  assert.equal(r.ok, false);
  assert.equal(sends, 3);
  assert.equal(pauses, 2, "pause between retries, not before the first");
  assert.equal(a.links.w?.to, b.id);
  assert.equal(a.links.w?.failCount, 3);
  assert.equal(a.links.w?.blocked, undefined);
  assert.ok(map.findPath(a.id, (room) => room.id === b.id));
});

test("a mob tripping you counts toward the streak but does not block after a few tries", async () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Caravan Route start", exits: ["ne", "sw", "nw"], contents: [] });
  const b = map.createRoom({ plane: "p1", x: 1, y: 1, z: 0 });
  map.applyObservation(b, { mode: "brief", title: "Mountain path", exits: ["sw"], contents: [] });
  map.link(a.id, "ne", b.id, { kind: "dir", confirmed: true });
  let sends = 0;
  const r = await retryCompassMove({
    fromId: a.id,
    cmd: "ne",
    map,
    maxAttempts: 3,
    pause: noPause,
    send: async () => {
      sends += 1;
      return { output: `The small boy trips you!  What a punk!\n${P}` };
    },
    moved: () => false,
  });
  assert.equal(r.ok, false);
  assert.equal(sends, 3);
  assert.equal(a.links.ne?.to, b.id);
  assert.equal(a.links.ne?.failCount, 3);
  assert.equal(a.links.ne?.blocked, undefined);
});

test("recordNavigationFailure never deletes a well-visited room behind a failing link (Dante's shop r6)", () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Street", exits: ["e"], contents: [] });
  const shop = map.createRoom({ plane: "p1", x: 1, y: 0, z: 0 });
  map.applyObservation(shop, { mode: "brief", title: "Shop", exits: ["w"], contents: [] });
  shop.visits = 1478;
  map.link(a.id, "e", shop.id, { kind: "dir", confirmed: true });
  for (let i = 0; i < NAV_FAILURES_BEFORE_HEAL; i++) if (map.recordNavigationFailure(a.id, "e", "The door is closed.").healed) break;
  assert.equal(a.links.e, undefined);
  assert.ok(map.room(shop.id), "kept, only unlinked");
});

function cavePocket(): { map: WorldMap; from: string; to: string; cmd: string } {
  const map = WorldMap.empty("test");
  const pocket = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  map.applyObservation(pocket, { mode: "brief", title: "Cave pocket", exits: [], contents: [] });
  const out = map.createRoom({ plane: "p2", x: 0, y: 0, z: 0 });
  const cmd = "crawl through space";
  map.link(pocket.id, cmd, out.id, { kind: "special", confirmed: true, hidden: true });
  return { map, from: pocket.id, to: out.id, cmd };
}

/** One unrecognized miss (`did not move`) on the only way out of the pocket. */
function missCrawl(map: WorldMap, from: string, cmd: string) {
  const before = map.room(from)?.links[cmd]?.failCount ?? 0;
  return recordUncountedMoveFailure(map, from, cmd, { output: "You crawl around but stay put.\n" }, before);
}

test("19 consecutive move failures leave the link usable", () => {
  const { map, from, to, cmd } = cavePocket();
  for (let i = 1; i <= BLOCK_AFTER_CONSECUTIVE_FAILS - 1; i++) {
    const rec = missCrawl(map, from, cmd);
    assert.equal(rec?.failures, i);
    assert.equal(rec?.healed, false);
    assert.equal(map.room(from)?.links[cmd]?.failCount, i);
    assert.equal(map.room(from)?.links[cmd]?.blocked, undefined);
  }
  assert.ok(map.findPath(from, (r) => r.id === to), "pathing still uses the only exit");
});

test("20 consecutive move failures block the link", () => {
  const { map, from, to, cmd } = cavePocket();
  for (let i = 0; i < BLOCK_AFTER_CONSECUTIVE_FAILS - 1; i++) missCrawl(map, from, cmd);
  const rec = missCrawl(map, from, cmd);
  const link = map.room(from)?.links[cmd];
  assert.equal(rec?.failures, BLOCK_AFTER_CONSECUTIVE_FAILS);
  assert.equal(link?.failCount, BLOCK_AFTER_CONSECUTIVE_FAILS);
  assert.equal(link?.blocked?.reason, "did not move");
  assert.equal(link?.to, to);
  assert.equal(map.findPath(from, (r) => r.id === to), null);
});

test("a success resets the consecutive-failure streak", () => {
  const { map, from, to, cmd } = cavePocket();
  for (let i = 0; i < 8; i++) missCrawl(map, from, cmd);
  assert.equal(map.room(from)?.links[cmd]?.failCount, 8);
  map.link(from, cmd, to, { kind: "special", confirmed: true, hidden: true });
  assert.equal(map.room(from)?.links[cmd]?.failCount, 0);
  assert.equal(map.room(from)?.links[cmd]?.blocked, undefined);
  assert.ok(map.findPath(from, (r) => r.id === to));
  missCrawl(map, from, cmd);
  assert.equal(map.room(from)?.links[cmd]?.failCount, 1, "the next miss starts a new streak");
  assert.equal(map.room(from)?.links[cmd]?.blocked, undefined);

  for (let i = 0; i < BLOCK_AFTER_CONSECUTIVE_FAILS; i++) missCrawl(map, from, cmd);
  assert.ok(map.room(from)?.links[cmd]?.blocked);
  map.link(from, cmd, to, { kind: "special", confirmed: true, hidden: true });
  assert.equal(map.room(from)?.links[cmd]?.failCount, 0);
  assert.equal(map.room(from)?.links[cmd]?.blocked, undefined);
  assert.ok(map.findPath(from, (r) => r.id === to), "a traversal clears the block and the counter");
});

test("an exit where moves get tripped is retried more than a plain refusal", () => {
  const map = WorldMap.empty("test");
  const a = map.createRoom({ plane: "p1", x: 0, y: 0, z: 0 });
  const b = map.createRoom({ plane: "p1", x: 1, y: 1, z: 0 });
  map.applyObservation(a, { mode: "brief", title: "Caravan Route", exits: ["ne"], contents: [] });
  map.link(a.id, "ne", b.id, { kind: "dir", confirmed: true });
  assert.equal(moveMaxAttempts("ne", a.links.ne), 3);
  assert.ok(map.recordHindrance(a.id, "ne"));
  assert.equal(moveMaxAttempts("ne", a.links.ne), HINDERED_MOVE_MAX_ATTEMPTS);
});
