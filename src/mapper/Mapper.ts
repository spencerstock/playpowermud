import {
  canonicalDirection,
  DIRECTION_VECTORS,
  isGeometricDirection,
  normalizeCommand,
  reverseDirection,
  subVec,
} from "../game/directions.js";
import { defaultGameProfile, type GameProfile, type TransitRule } from "../game/profile.js";
import { MenuListParser, recordHealingMenu } from "./healingPlaces.js";
import { isFlakyTravelCommand, outputSaysMoveFailed } from "./navFailure.js";
import { isTeleportOnlyCommand } from "./pathPolicy.js";
import { ESTABLISHED_USES, looksLikeTravelCommand } from "./specialExits.js";
import {
  OPEN_DOOR_COMMAND,
  outputSaysAlreadyOpen,
  outputSaysClosedDoor,
  outputSaysLockedDoor,
  outputSaysOpenedDoor,
  parseDoorLine,
  withDoorState,
} from "../game/doors.js";
import type { GameEvent, RoomObservation } from "../game/types.js";
import type { MapRoom } from "./types.js";
import { exitKindFor, normalizeDescription, type HealReport, WorldMap } from "./WorldMap.js";

export type PendingKind = "move" | "look" | "teleport" | "flee" | "maybe" | "ignore";

type Pending = {
  cmd: string;
  /** Canonical exit key for moves (`n`, `out`, `pry floorboard`). */
  key: string;
  kind: PendingKind;
  sentAt: number;
  responded: boolean;
  /** The MUD printed some line while this was the oldest command awaiting its prompt. */
  heard?: boolean;
};

export type MapperEvent =
  | {
      type: "moved";
      from: string | null;
      to: string;
      via?: string;
      how: "exit" | "look" | "relocate";
      created: boolean;
    }
  | { type: "lost"; reason: string }
  | { type: "blocked"; from: string; cmd: string; reason: string }
  | { type: "planes-merged"; into: string };

export type MapperListener = (ev: MapperEvent) => void;

/**
 * One arrival in the recent trajectory. After a contradiction the mapper matches this
 * sequence of observations against the map to find where it really is.
 */
type Step = {
  /** How we got here: exit key, `?` (unannounced move), `=` (same room re-seen), null (jump). */
  key: string | null;
  obs: RoomObservation;
  room: string;
  /** This arrival created `room`. */
  created: boolean;
  /** Room whose `key` link this arrival created (null when the link already existed). */
  linkedFrom: string | null;
  /** Arrived by following the map without doubt: a re-localization may not contradict it. */
  sure: boolean;
  /** A move whose display never came: we may or may not have gone through. */
  unseen?: boolean;
  /** That unseen move got no output at all — no refusal either, so it most likely went through. */
  silent?: boolean;
};

/** Stand-in observation for a move whose room display we never saw. */
const UNSEEN: RoomObservation = { mode: "dark", exits: [], contents: [] };

/**
 * Best explanation of the trajectory ending at a room: rooms oldest → newest. `landmark`:
 * it passes through a display only one known room matches; `beacon`: one that is unique by
 * its title or description, not just its exits (exit patterns repeat along corridors).
 */
type Track = { score: number; path: string[]; tie: boolean; landmark: boolean; beacon: boolean };

const PENDING_TTL_MS = 30_000;
const MAYBE_TTL_MS = 5_000;
/** Cross-plane description matches shorter than this are too generic to merge layouts. */
const MIN_MERGE_DESC = 60;
/** Consecutive identical verbose displays before a description pins us into a known room elsewhere. */
const DESC_PIN_STREAK = 3;
/** Trajectory length kept for re-localization. */
const HISTORY_STEPS = 16;
/** After an unresolved contradiction, keep trying to re-localize for this many arrivals. */
const DOUBT_STEPS = 12;
/**
 * Evidence (bits: how unlikely a brand-new room would look like this) a trajectory needs
 * before it overrides dead reckoning. Little is needed once something contradicted our
 * position; a lot when the only reason is that a new room looks like a known one, because
 * look-alike forests and streets are common.
 */
const NEED_BITS = { contradiction: 6, doubt: 8, lookalike: 14 } as const;
type Evidence = keyof typeof NEED_BITS;
/** Extra bits when the track joins our past through a warp (a non-euclidean exit). */
const WARP_BITS = 4;
/** How far ahead of the runner-up the winning track must be. */
const MARGIN_BITS = 3;
const DOOR_COMMANDS = /^(?:open|close|unlock|lock|pick|bash|kick)\s/i;
/** A ride with no arrival after this long is forgotten (disconnect, missed line). */
const RIDE_MAX_MS = 30 * 60_000;
/** Tag on the off-map room that stands for a vessel's deck while we ride it. */
export const VESSEL_TAG = "vessel";

/**
 * A ride in progress (profile `transits`): where we boarded, by what command, and whether the
 * next room display is where it put us.
 */
type Ride = {
  rule: TransitRule;
  /** Destination named on the ticket. */
  place?: string;
  /** Room we boarded from (the dock). */
  dock: string | null;
  /** Command that boarded (`board ship`); the transit link is recorded under it. */
  boardCmd?: string;
  boardedAt: number;
  departed: boolean;
  /** The arrive line came: the next room display is the landing. */
  arriving: boolean;
};

/**
 * Live position tracker. Wire commands are queued as they are sent; each prompt completes
 * the oldest one. Room displays are attributed to the in-flight command, which decides
 * whether we followed an exit, looked, or were relocated.
 */
export class Mapper {
  position: string | null = null;
  /** Last confident position, kept while lost to disambiguate relocation. */
  private lastKnown: string | null = null;
  private queue: Pending[] = [];
  private fleeDir: string | null = null;
  /** Between a login prompt and the first in-game output, typed lines are credentials. */
  private loggingIn = false;
  private history: Step[] = [];
  /** Arrivals left during which dead reckoning is suspect (see DOUBT_STEPS). */
  private doubt = 0;
  /** Evidence a re-localization needs while in doubt. */
  private doubtNeed: Evidence = "doubt";
  private listeners = new Set<MapperListener>();
  /** Optional trace hook for diagnosing attribution (replay tooling, tests). */
  debug: ((msg: string) => void) | null = null;
  /** Destination of the last ticket bought (`rule` id + place), until we board. */
  private ticket: { rule: string; place?: string } | null = null;
  private ride: Ride | null = null;
  /** Food/Drink `list` tables: the room they print in is a healing place. */
  private readonly menus = new MenuListParser();
  /**
   * After crossing the sea, known rooms we cannot walk to from the landing are not where we
   * are, however alike they look (Merevia's docks vs Dunagin's). Lifted by the next jump.
   */
  private fenceRoot: string | null = null;
  private fenceCache: Set<string> | null = null;
  private eventAt = Date.now();

  constructor(
    readonly map: WorldMap,
    private readonly profile: GameProfile = defaultGameProfile(),
  ) {}

  on(listener: MapperListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(ev: MapperEvent): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        // listeners must not break mapping
      }
    }
  }

  current(): MapRoom | undefined {
    const room = this.map.room(this.position);
    if (room && room.id !== this.position) this.position = room.id;
    return room;
  }

  pendingCommands(): { cmd: string; kind: PendingKind; responded: boolean }[] {
    return this.queue.map((q) => ({ cmd: q.cmd, kind: q.kind, responded: q.responded }));
  }

  setPosition(roomId: string | null): void {
    if (roomId && !this.map.room(roomId)) throw new Error(`Unknown room ${roomId}`);
    const from = this.position;
    this.position = roomId;
    this.history = [];
    this.doubt = 0;
    this.ride = null;
    this.fenceRoot = null;
    if (roomId) this.lastKnown = roomId;
    if (roomId) this.emit({ type: "moved", from, to: roomId, how: "relocate", created: false });
    else this.emit({ type: "lost", reason: "position cleared" });
  }

  reset(): void {
    this.queue = [];
    this.fleeDir = null;
    this.history = [];
    this.ride = null;
    this.ticket = null;
  }

  /** The ride we are on (or just finished and are about to land from), for UIs and bots. */
  riding(): { rule: string; label: string; place?: string; dock: string | null; departed: boolean } | null {
    const r = this.ride;
    return r ? { rule: r.rule.id, label: r.rule.label, place: r.place, dock: r.dock, departed: r.departed } : null;
  }

  /**
   * Self-heal the map (see `WorldMap.heal`) without losing our place, then re-point the
   * trajectory at the surviving rooms.
   */
  heal(): HealReport {
    const report = this.map.heal({ protect: [this.position, this.lastKnown] });
    this.position = this.map.canonicalId(this.position) ?? null;
    this.lastKnown = this.map.canonicalId(this.lastKnown) ?? this.position;
    this.history = this.history.filter((s) => this.map.canonicalId(s.room));
    for (const s of this.history) s.room = this.map.canonicalId(s.room)!;
    return report;
  }

  classify(raw: string): { kind: PendingKind; key: string } | null {
    const n = normalizeCommand(raw);
    if (!n) return null;
    const dir = canonicalDirection(n);
    if (dir) return { kind: "move", key: dir };
    if (this.profile.lookCommands.test(n)) return { kind: "look", key: n };
    if (n === "flee") return { kind: "flee", key: n };
    if (this.profile.teleportCommands.test(n)) return { kind: "teleport", key: n };
    if (isTeleportOnlyCommand(n)) return { kind: "teleport", key: n };
    const cur = this.current();
    if (cur && (cur.exits.includes(n) || cur.links[n])) return { kind: "move", key: n };
    if (this.profile.nonMovementCommands.test(n)) return { kind: "ignore", key: n };
    return { kind: "maybe", key: n };
  }

  onCommandSent(raw: string, at = Date.now()): void {
    if (this.loggingIn) return;
    const c = this.classify(raw);
    if (!c) return;
    // Rooms with doors list different exits open vs closed; never treat that as a new room.
    const cur = this.current();
    if (cur && DOOR_COMMANDS.test(c.key) && !cur.tags.includes("dynamic-exits")) {
      cur.tags.push("dynamic-exits");
      this.map.touch();
    }
    this.queue.push({ cmd: raw.trim(), key: c.key, kind: c.kind, sentAt: at, responded: false });
    if (this.queue.length > 2000) this.queue.shift();
  }

  onGameEvent(ev: GameEvent, at = Date.now()): void {
    this.eventAt = at;
    this.expire(at);
    switch (ev.type) {
      case "prompt": {
        if (ev.vitals) this.loggingIn = false;
        const done = this.queue.shift();
        if (done?.kind === "move" && !done.responded) this.unseenMove(done.key, !done.heard);
        return;
      }
      case "room":
        this.loggingIn = false;
        this.onRoom(ev.room);
        return;
      case "login":
        if (ev.stage === "in-game") {
          this.loggingIn = false;
        } else {
          this.loggingIn = true;
          this.reset();
          if (this.position) {
            this.lastKnown = this.position;
            this.position = null;
            this.emit({ type: "lost", reason: "logging in" });
          }
        }
        return;
      case "move-failed":
        this.onMoveFailed(ev.text);
        return;
      case "move-hindered":
        this.onMoveHindered();
        return;
      case "line":
        if (this.queue[0] && ev.text.trim()) this.queue[0].heard = true;
        this.onDoorResult(ev.text);
        this.onMenuLine(ev.text);
        return;
      case "flee": {
        this.fleeDir = ev.dir;
        return;
      }
      case "flee-failed": {
        const e = this.queue.find((q) => q.kind === "flee" && !q.responded);
        if (e) e.responded = true;
        return;
      }
      case "command-echo":
        for (const c of ev.commands) this.onCommandSent(c, at);
        return;
      case "transit":
        this.onTransit(ev.rule, ev.phase, ev.place, at);
        return;
      default:
        return;
    }
  }

  private onMenuLine(text: string): void {
    const menu = this.menus.feed(text);
    if (!menu) return;
    const room = this.position ? this.map.room(this.position) : undefined;
    if (!room) return;
    if (recordHealingMenu(room, menu, new Date(this.eventAt).toISOString())) this.map.touch();
    this.debug?.(`healing ${menu.kind} menu at ${room.id} (${menu.items.length} items)`);
  }

  private expire(at: number): void {
    while (this.queue.length && at - this.queue[0]!.sentAt > PENDING_TTL_MS) this.queue.shift();
    // Unknown verbs that never produced a prompt must not swallow a later room display.
    this.queue = this.queue.filter((q) => q.kind !== "maybe" || q.responded || at - q.sentAt <= MAYBE_TTL_MS);
  }

  /** In-flight command a failure belongs to. */
  private inFlight(): Pending | undefined {
    return this.queue.find((q) => !q.responded && q.kind !== "ignore");
  }

  /**
   * Whether `e` can explain `obs` from where we think we are: "yes" (listed exit, matching
   * look), "unknown" (unknown verb, unexplored room) or "no" (compass move that is not an exit).
   */
  private plausibility(e: Pending, obs: RoomObservation, from: MapRoom | undefined): "yes" | "unknown" | "no" {
    if (!from) return "unknown";
    switch (e.kind) {
      case "look":
        // After a move whose display never came, a look at another room is that move (see `reobserve`).
        if (this.history.at(-1)?.unseen && obs.mode !== "dark") return "yes";
        return this.map.compatibility(from, obs) >= 0 ? "yes" : "no";
      case "move": {
        if (from.links[e.key]?.to || from.exits.includes(e.key)) return "yes";
        // A compass step the room didn't list can still be a door: shop entrances the MUD
        // never prints, or an exit lost when the exits line wrapped. The room display that
        // follows is that move. A "cannot go" line never becomes a link.
        if (isGeometricDirection(e.key)) {
          // ...unless the arrival doesn't list the way back either. A real unlisted door is
          // missing from one list, not both; this display belongs to another queued command
          // (an unanswered one ahead of it slipped the queue by one).
          return this.neitherEndLists(from, e.key, obs) ? "no" : "unknown";
        }
        const known = from.exits.length > 0 || from.title !== undefined || from.descKeys.length > 0;
        return known && !from.tags.includes("dynamic-exits") ? "no" : "unknown";
      }
      case "maybe":
        return "unknown";
      default:
        return "yes";
    }
  }

  private neitherEndLists(from: MapRoom, cmd: string, obs: RoomObservation): boolean {
    const rev = reverseDirection(cmd);
    if (!rev || from.dark || !from.exits.length || from.tags.includes("dynamic-exits")) return false;
    if (obs.mode === "dark" || !obs.exits.length || obs.exits.includes(rev)) return false;
    // A shop or hut whose only way back is `out`/`leave` is a door the outside never lists.
    return obs.exits.every((x) => isGeometricDirection(x));
  }

  /**
   * Pick the queued command that produced this room display; earlier stale entries are dropped.
   * When nothing explains it, `hint` is the move we sent that the map says is impossible.
   */
  private attribute(obs: RoomObservation): { e?: Pending; hint?: string } {
    const from = this.current();
    const cands = this.queue.filter((q) => !q.responded && q.kind !== "ignore").slice(0, 4);
    const verdicts = cands.map((e) => this.plausibility(e, obs, from));
    let pick = -1;
    for (let i = 0; i < cands.length; i++) {
      const v = verdicts[i]!;
      if (v === "no") continue;
      if (cands[i]!.kind === "maybe" && verdicts.slice(i + 1).includes("yes")) continue;
      pick = i;
      break;
    }
    if (pick < 0) {
      // Nothing explains the display from where we think we are: the oldest command did
      // happen, our position is what's wrong. Consume just that one and relocate.
      if (cands[0]) cands[0].responded = true;
      return { hint: cands[0]?.kind === "move" ? cands[0].key : undefined };
    }
    for (let i = 0; i <= pick; i++) cands[i]!.responded = true;
    return { e: cands[pick] };
  }

  /**
   * `open door` on a closed door makes that direction an exit. A shut or locked door
   * rejects the move in place — that is not a room we failed to see.
   */
  private onDoorResult(text: string): void {
    if (!/door/i.test(text) || parseDoorLine(text)) return;
    const cur = this.current();
    if (!cur) return;
    const move = this.queue.find((q) => !q.responded && q.kind === "move");
    if (move && outputSaysLockedDoor(text)) {
      move.responded = true;
      const prev = cur.doors?.find((d) => d.direction === move.key);
      this.map.applyDoors(cur, withDoorState(cur.doors, { name: prev?.name ?? "door", direction: move.key, state: "locked" }));
      return;
    }
    if (move && outputSaysClosedDoor(text)) {
      move.responded = true;
      const prev = cur.doors?.find((d) => d.direction === move.key);
      this.map.applyDoors(cur, withDoorState(cur.doors, { name: prev?.name ?? "door", direction: move.key, state: "closed" }));
      return;
    }
    const opening = this.queue.some((q) => !q.responded && q.key === OPEN_DOOR_COMMAND);
    const closing = this.queue.some((q) => !q.responded && q.key === "close door");
    if (!cur.doors?.length) return;
    if (opening && (outputSaysOpenedDoor(text) || outputSaysAlreadyOpen(text))) {
      const next = cur.doors.map((d) => (d.state === "closed" ? { ...d, state: "open" as const } : d));
      if (next.some((d, i) => d.state !== cur.doors![i]!.state)) this.map.applyDoors(cur, next);
      return;
    }
    if (opening && (outputSaysLockedDoor(text) || /^it(?:'s| is) locked\b/i.test(text.trim()))) {
      const next = cur.doors.map((d) => (d.state === "closed" ? { ...d, state: "locked" as const } : d));
      if (next.some((d, i) => d.state !== cur.doors![i]!.state)) this.map.applyDoors(cur, next);
      return;
    }
    if (closing && /^you close\b/i.test(text.trim()) && /\bdoor\b/i.test(text)) {
      const next = cur.doors.map((d) => (d.state === "open" ? { ...d, state: "closed" as const } : d));
      if (next.some((d, i) => d.state !== cur.doors![i]!.state)) this.map.applyDoors(cur, next);
    }
  }

  /**
   * The in-flight move was eaten on the way out (tripped): we did not move, and the exit is not
   * at fault — no failure charged, no block. Answering it keeps the next display paired with the
   * command that really produced it instead of an unseen move.
   */
  private onMoveHindered(): void {
    const e = this.inFlight();
    if (!e || e.kind !== "move") return;
    e.responded = true;
    const from = this.current();
    if (from) this.map.recordHindrance(from.id, e.key);
  }

  private onMoveFailed(text: string): void {
    const e = this.inFlight();
    if (!e) return;
    e.responded = true;
    const from = this.current();
    if (e.kind === "move" && from && (from.exits.includes(e.key) || !!from.links[e.key]?.to)) {
      const link = from.links[e.key];
      if (isFlakyTravelCommand(e.key, link, { map: this.map, fromId: from.id }) && outputSaysMoveFailed(text))
        return;
      const rec = this.map.recordNavigationFailure(from.id, e.key, text);
      this.emit({
        type: "blocked",
        from: from.id,
        cmd: e.key,
        reason: rec.healed ? (rec.detail ?? text) : text,
      });
    }
  }

  /**
   * A ride's own lines (see `TransitRule`). Boarding moves us onto the vessel, off the map;
   * the arrive line makes the next display a landing instead of the queued command's exit.
   */
  private onTransit(ruleId: string, phase: "ticket" | "board" | "depart" | "arrive", place: string | undefined, at: number): void {
    const rule = this.profile.transits?.find((r) => r.id === ruleId);
    if (!rule) return;
    const answer = (kinds: PendingKind[]) => {
      const q = this.queue.find((e) => !e.responded && kinds.includes(e.kind));
      if (q) q.responded = true;
      return q;
    };
    switch (phase) {
      case "ticket":
        this.ticket = { rule: rule.id, place };
        answer(["maybe"]);
        return;
      case "board": {
        const q = answer(["maybe", "move"]);
        const dock = this.position ?? this.lastKnown;
        const ticket = this.ticket?.rule === rule.id ? this.ticket : null;
        this.ticket = null;
        const boardCmd = q?.key ?? (rule.command ? normalizeCommand(rule.command) : undefined);
        this.ride = { rule, place: ticket?.place, dock, boardCmd, boardedAt: at, departed: false, arriving: false };
        this.debug?.(`transit board ${rule.id} at=${dock} via=${boardCmd ?? "?"} place=${ticket?.place ?? "?"}`);
        if (rule.vessel) {
          const vessel = this.vesselRoom(rule);
          this.setHere(vessel.id);
          this.history = [];
          this.doubt = 0;
          this.emit({ type: "moved", from: dock, to: vessel.id, via: boardCmd, how: "relocate", created: false });
        }
        return;
      }
      case "depart":
        if (this.ride?.rule.id === rule.id) this.ride.departed = true;
        return;
      case "arrive":
        // The command that set off a forced relocation (arena: the step south) or `disembark`
        // is answered by this line, not by the display that follows.
        answer(["move", "maybe", "flee"]);
        if (this.ride?.rule.id === rule.id) this.ride.arriving = true;
        else this.ride = { rule, dock: this.position ?? this.lastKnown, boardedAt: at, departed: true, arriving: true };
        this.debug?.(`transit arrive ${rule.id} from=${this.ride.dock}`);
        return;
    }
  }

  /** The off-map room standing for `rule`'s vessel: its own aside plane, never matched to land. */
  private vesselRoom(rule: TransitRule): MapRoom {
    const tag = `${VESSEL_TAG}:${rule.id}`;
    const known = this.map.rooms().find((r) => r.tags.includes(tag));
    if (known) return known;
    const plane = this.map.newPlane("aside", undefined, `${rule.label} (vessel)`);
    const room = this.map.createRoom({ plane: plane.id, x: 0, y: 0, z: 0 });
    room.title = rule.label;
    if (rule.vessel?.description) room.description = rule.vessel.description;
    room.tags.push(VESSEL_TAG, tag);
    room.notes.push(`Aboard ${rule.label}: not a place on the map. Arrival is recorded as a transit link from the boarding room.`);
    this.map.reindex();
    this.map.touch();
    return room;
  }

  /** Where the ride put us: the display after the arrive line. */
  private land(obs: RoomObservation): void {
    const ride = this.ride!;
    this.ride = null;
    const at = this.eventAt;
    this.fenceRoot = null;
    this.fenceCache = null;
    const dock = this.map.room(ride.dock);
    const from = this.position;
    this.debug?.(`transit land ${ride.rule.id} dock=${dock?.id} departed=${ride.departed} obs=(${obs.exits})`);
    // A forced relocation (no boarding): a plain jump, placed by the usual relocation logic.
    if (!ride.rule.board || obs.mode === "dark") {
      this.relocate(obs, null);
      return;
    }
    let target: MapRoom | undefined;
    // Stepped back off before sailing.
    if (!ride.departed && dock && this.map.compatibility(dock, obs) > 0) target = dock;
    const linked = dock && ride.boardCmd ? this.map.room(dock.links[ride.boardCmd]?.to) : undefined;
    if (!target && linked && linked.id !== dock?.id && this.fullyMatches(linked, obs)) target = linked;
    if (!target) {
      // A known port, but only on the exact same prose: every company berth ends alike.
      const exact = this.candidatePool(obs).filter((r) => r.id !== dock?.id && this.exactlyMatches(r, obs));
      if (exact.length === 1) target = exact[0];
    }
    let created = false;
    if (!target) {
      const label = ride.place ?? `${ride.rule.label} landing`;
      const plane = this.map.newPlane("surface", undefined, label);
      // Only the ship reaches it: keep its rooms from ever matching look-alikes back home.
      if (ride.departed) plane.continent = label;
      target = this.map.createRoom({ plane: plane.id, x: 0, y: 0, z: 0 });
      created = true;
    }
    this.map.applyObservation(target, obs);
    this.setHere(target.id);
    this.record(null, obs, target.id, { created });
    const crossed = ride.departed && !!dock && dock.id !== target.id;
    if (crossed && ride.boardCmd && ride.rule.link !== false) {
      const seconds = Math.round((at - ride.boardedAt) / 1000);
      this.map.linkTransit(dock!.id, ride.boardCmd, target.id, {
        rule: ride.rule.id,
        label: ride.rule.label,
        ...(ride.place ? { place: ride.place } : {}),
        ...(seconds > 0 ? { seconds } : {}),
        ...(ride.rule.howTo ? { howTo: ride.rule.howTo } : {}),
      });
    }
    if (crossed) this.fenceRoot = target.id;
    this.debug?.(`transit landed ${target.id}${created ? " (new plane)" : ""}`);
    this.emit({ type: "moved", from, to: target.id, via: ride.boardCmd, how: "relocate", created });
  }

  /** Full match on the very same prose (not just a shared ending), title and exits. */
  private exactlyMatches(room: MapRoom, obs: RoomObservation): boolean {
    if (!this.fullyMatches(room, obs)) return false;
    if (!obs.description) return !!obs.title && room.title === obs.title;
    return !!room.description && normalizeDescription(room.description) === normalizeDescription(obs.description);
  }

  /** Inside the post-ride fence (or no fence): walkable from the landing without riding back. */
  private reachable(room: MapRoom): boolean {
    if (!this.fenceRoot) return true;
    const root = this.map.canonicalId(this.fenceRoot);
    if (!root) {
      this.fenceRoot = null;
      return true;
    }
    if (!this.fenceCache) {
      const seen = new Set<string>([root]);
      const todo = [root];
      while (todo.length) {
        const r = this.map.room(todo.pop()!);
        if (!r) continue;
        const next: (string | null | undefined)[] = Object.values(r.links)
          .filter((l) => l.kind !== "teleport")
          .map((l) => l.to);
        for (const p of this.map.incomingRooms(r.id)) {
          if (Object.values(p.links).some((l) => l.kind !== "teleport" && this.map.canonicalId(l.to) === r.id)) next.push(p.id);
        }
        for (const n of next) {
          const id = this.map.canonicalId(n);
          if (id && !seen.has(id)) {
            seen.add(id);
            todo.push(id);
          }
        }
      }
      this.fenceCache = seen;
    }
    return this.fenceCache.has(room.id);
  }

  private onRoom(obs: RoomObservation): void {
    this.fenceCache = null;
    if (this.ride && this.eventAt - this.ride.boardedAt > RIDE_MAX_MS) this.ride = null;
    if (this.ride?.arriving) {
      this.land(obs);
      return;
    }
    if (this.ride) {
      // Aboard: anything shown (`view`) is outside the ship, not where we stand.
      this.debug?.(`room ${obs.title ?? obs.mode}(${obs.exits}) ignored aboard ${this.ride.rule.id}`);
      return;
    }
    if (this.fleeDir) {
      const dir = this.fleeDir;
      this.fleeDir = null;
      const e = this.queue.find((q) => q.kind === "flee" && !q.responded);
      if (e) e.responded = true;
      this.arrive(obs, dir);
      return;
    }
    const { e, hint } = this.attribute(obs);
    this.debug?.(
      `room ${obs.title ?? obs.mode}(${obs.exits}) at=${this.position} attributed=${e ? `${e.kind}:${e.key}` : `none${hint ? `(${hint}?)` : ""}`} queue=[${this.queue.map((q) => `${q.key}${q.responded ? "*" : ""}`).join(" ")}]`,
    );
    if (!e) {
      this.relocate(obs, "?", hint);
      return;
    }
    switch (e.kind) {
      case "look":
        this.reobserve(obs);
        return;
      case "move":
      case "maybe":
        this.arrive(obs, e.key);
        return;
      case "flee":
        // Fled without the "you flee <dir>" line: we went through one of our exits.
        this.relocate(obs, "?");
        return;
      default:
        this.relocate(obs, null);
    }
  }

  private reobserve(obs: RoomObservation): void {
    const cur = this.current();
    // The last move never showed a room. If this look is not exactly the room we stayed in,
    // that move went through: a look-alike neighbor (same title, other description) must
    // not be folded into this room. A listed exit the MUD answered with silence (no refusal)
    // went through even when the rooms are identical.
    const last = this.history.at(-1);
    const moved =
      !!cur &&
      !!last?.unseen &&
      !!last.key &&
      obs.mode !== "dark" &&
      ((last.silent && cur.exits.includes(last.key)) || !this.fullyMatches(cur, obs));
    if (cur && last?.key && moved) {
      this.history.pop();
      this.arrive(obs, last.key);
      return;
    }
    if (cur && this.map.compatibility(cur, obs) >= 0) {
      this.map.applyObservation(cur, obs);
      this.record("=", obs, cur.id, { sure: this.history.at(-1)?.sure });
      this.emit({ type: "moved", from: cur.id, to: cur.id, how: "look", created: false });
      return;
    }
    // Looking around contradicts where we think we are; the room is the one we last saw.
    this.relocate(obs, "=");
  }

  /** `obs` is `room` by a long enough description plus title/exits, not just a look-alike. */
  private isSameSpot(room: MapRoom, obs: RoomObservation): boolean {
    if (obs.mode === "dark" || !obs.description || room.descKeys.length === 0) return false;
    if (obs.description.trim().length < MIN_MERGE_DESC) return false;
    return this.fullyMatches(room, obs);
  }

  /** `obs` agrees with everything we know about `room`: title, description and exits. */
  private fullyMatches(room: MapRoom, obs: RoomObservation): boolean {
    const known = room.exits.length > 0 || room.title !== undefined || room.descKeys.length > 0;
    const full =
      (obs.title && room.title ? 2 : 0) + (obs.description && room.descKeys.length ? 3 : 0) + (known ? 1 : 0);
    return this.map.compatibility(room, obs) >= full;
  }

  /**
   * Work out where a room display puts us when the command queue cannot. `key` is how we
   * got here relative to the previous display: `?` some exit, `=` no move, null a jump.
   */
  private relocate(obs: RoomObservation, key: string | null, hint?: string, opts: { knownOnly?: boolean } = {}): boolean {
    const from = this.position;
    if (obs.mode === "dark") {
      if (opts.knownOnly) return false;
      if (this.position) this.lastKnown = this.position;
      this.position = null;
      this.history = [];
      this.emit({ type: "lost", reason: "relocated into a dark room" });
      return true;
    }
    const cur = this.current();
    if (cur && key !== "=" && this.map.compatibility(cur, obs) > 0) {
      this.map.applyObservation(cur, obs);
      this.record("=", obs, cur.id, { sure: this.history.at(-1)?.sure });
      this.emit({ type: "moved", from, to: cur.id, how: "look", created: false });
      return true;
    }
    if (key === "?" && cur) {
      const via = this.neighborVia(cur, obs, hint);
      if (via) {
        this.creditQueued(via);
        this.arrive(obs, via);
        return true;
      }
    }
    if (key !== null) {
      if (hint && this.relocalize(obs, hint, "contradiction")) return true;
      if (this.relocalize(obs, key, "contradiction")) return true;
    }
    let unique = this.map.findByObservation(obs, { allowTitle: true }).room;
    if (unique && (!this.reachable(unique) || unique.tags.includes(VESSEL_TAG))) unique = null;
    if (
      unique &&
      obs.description &&
      obs.description.trim().length >= MIN_MERGE_DESC &&
      !this.descriptionPinAllowed(obs)
    ) {
      unique = null;
    }
    const descPin = this.descriptionPinAllowed(obs);
    let target =
      unique ??
      this.contentsCandidate(obs, true) ??
      (descPin ? this.nearestCandidate(obs) : undefined) ??
      this.contentsCandidate(obs, false);
    let created = false;
    // `knownOnly`: only a room the display identifies by itself counts; a guess among
    // look-alikes or a brand-new room is the caller's business.
    if (opts.knownOnly && !unique) return false;
    if (!target) {
      const plane = this.map.newPlane("surface");
      target = this.map.createRoom({ plane: plane.id, x: 0, y: 0, z: 0 });
      created = true;
    }
    this.map.applyObservation(target, obs);
    this.setHere(target.id);
    this.record(key, obs, target.id, { created });
    // Anything short of a unique match is a guess: keep checking it against what we see next.
    if (!unique) this.suspectFor("doubt");
    this.emit({ type: "moved", from, to: target.id, how: "relocate", created });
    return true;
  }

  /** The display was produced by the queued `key` after all: its prompt owes us nothing more. */
  private creditQueued(key: string): void {
    const q = this.queue.slice(0, 8).find((e) => !e.responded && e.kind === "move" && e.key === key);
    if (q) q.responded = true;
  }

  /**
   * An unannounced move from `cur`: the exit whose known destination (link, else the room on
   * that side) matches `obs`, or the only unexplored exit whose far side lists the way back.
   */
  private neighborVia(cur: MapRoom, obs: RoomObservation, hint?: string, knownOnly = false): string | undefined {
    const dest = (cmd: string): MapRoom | undefined => {
      const l = cur.links[cmd];
      if (l?.to) return l.kind === "teleport" ? undefined : this.map.room(l.to);
      const p = isGeometricDirection(cmd) ? this.map.expectedPos(cur, cmd) : null;
      return p ? this.map.roomsAt(p).find((r) => this.map.compatibility(r, obs) > 0) : undefined;
    };
    const fits = (cmd: string) => {
      const t = dest(cmd);
      return !!t && this.map.compatibility(t, obs) > 0;
    };
    if (hint && fits(hint)) return hint;
    const exits = [...new Set([...cur.exits, ...Object.keys(cur.links)])];
    const hits = exits.filter(fits);
    if (hits.length === 1) return hits[0];
    if (hits.length) return this.bestKnownExit(cur, hits);
    if (knownOnly) return undefined;
    const open = cur.exits.filter((d) => {
      const rev = reverseDirection(d);
      return isGeometricDirection(d) && !dest(d) && !!rev && obs.exits.includes(rev);
    });
    return open.length === 1 ? open[0] : undefined;
  }

  /**
   * Several of `cur`'s exits lead to the room we see (duplicates): the one the room lists, else
   * the one walked most.
   */
  private bestKnownExit(cur: MapRoom, cmds: string[]): string | undefined {
    const dests = new Set(cmds.map((c) => this.map.canonicalId(cur.links[c]?.to)));
    if (dests.size !== 1 || dests.has(undefined)) return undefined;
    const rank = (c: string) => (cur.exits.includes(c) ? 1e9 : 0) + (cur.links[c]?.uses ?? 0);
    return [...cmds].sort((a, b) => rank(b) - rank(a))[0];
  }

  /**
   * A move's prompt came back with neither a room display nor a failure we recognize. Maybe
   * the display was lost, maybe something blocked us in words we do not parse. Stay put, but
   * remember the step so a later contradiction can be explained by it. Prompts and commands
   * do not always pair up on a busy MUD, so this alone is no reason for doubt.
   */
  private unseenMove(key: string, silent: boolean): void {
    const cur = this.current();
    if (!cur || (!cur.exits.includes(key) && !cur.links[key]?.to)) return;
    this.history.push({ key, obs: UNSEEN, room: "", created: false, linkedFrom: null, sure: false, unseen: true, silent });
    if (this.history.length > HISTORY_STEPS) this.history.shift();
  }

  /** Start (or strengthen) a doubt window. */
  private suspectFor(need: Evidence): void {
    if (this.doubt <= 0 || NEED_BITS[need] < NEED_BITS[this.doubtNeed]) this.doubtNeed = need;
    this.doubt = DOUBT_STEPS;
  }

  private record(
    key: string | null,
    obs: RoomObservation,
    room: string,
    opts: { created?: boolean; linkedFrom?: string | null; sure?: boolean } = {},
  ): void {
    if (key === null) {
      this.history = [];
      this.fenceRoot = null;
    }
    const { created = false, linkedFrom = null, sure = false } = opts;
    this.history.push({ key, obs, room, created, linkedFrom, sure: sure && !created && this.doubt === 0 });
    if (this.history.length > HISTORY_STEPS) this.history.shift();
    if (this.doubt > 0) this.doubt -= 1;
  }

  /** Re-localize from the recent trajectory; on success move there and repair the trail. */
  private relocalize(obs: RoomObservation, key: string, evidence: Evidence): boolean {
    const loc = this.localize(obs, key, evidence);
    if (!loc) return false;
    const from = this.position;
    const { target } = loc;
    // The track found no known way into the target, but we were sure of the room we left and
    // it lists this exit with nothing behind it yet: that exit is the way in. Linking it is how
    // two separately mapped pieces of the world get joined (Kalinport r1417 s → r1416 looped
    // forever relocating without ever learning the link).
    const pred = loc.pred ?? this.unlinkedPredecessor(from, key, target);
    let merged = false;
    if (pred && key !== "?" && key !== "=" && pred.id !== target.id) {
      merged = this.map.connect(pred, key, target, { confirmed: true, hidden: exitKindFor(key, pred.exits) === "special" });
      if (isGeometricDirection(key)) this.map.inferReverse(pred, key, target);
      if (merged) this.dedupePlane(this.map.room(target.id)!.pos.plane);
    }
    const here = this.map.room(target.id)!;
    this.map.applyObservation(here, obs);
    this.setHere(here.id);
    this.doubt = 0;
    this.record(key, obs, here.id, { sure: true });
    this.debug?.(`relocalized ${from} → ${here.id} via ${key} (${evidence})`);
    if (merged) this.emit({ type: "planes-merged", into: here.pos.plane });
    this.emit({ type: "moved", from, to: here.id, via: key, how: "relocate", created: false });
    return true;
  }

  /**
   * The room we surely just left, when its `key` exit is listed but unmapped and leading into
   * `target` keeps the layout sane (and `target` lists the way back, for compass moves).
   */
  private unlinkedPredecessor(fromId: string | null, key: string, target: MapRoom): MapRoom | undefined {
    if (!fromId || key === "?" || key === "=") return undefined;
    const prev = this.map.room(fromId);
    const last = this.history.at(-1);
    if (!prev || prev.id === target.id || !last?.sure || this.map.canonicalId(last.room) !== prev.id) return undefined;
    // Compass moves must be listed; a named command (`down the manhole`) is a secret exit that
    // the exit list never shows.
    if (prev.links[key]?.to || (isGeometricDirection(key) && !prev.exits.includes(key))) return undefined;
    const rev = reverseDirection(key);
    // Up/down often comes back by a named command (`u` out of a manhole, `down the manhole` in).
    const vertical = key === "u" || key === "d";
    if (isGeometricDirection(key) && !vertical && rev && target.exits.length && !target.exits.includes(rev)) return undefined;
    if (rev && target.links[rev]?.to && this.map.canonicalId(target.links[rev]!.to) !== prev.id) return undefined;
    if (this.layoutAgrees(prev, key, target)) return prev;
    // The grid disagrees, but the game does not: the room we surely left lists this exit with
    // nothing behind it, and the room we reached lists the way back with nothing behind it.
    // Trails that bend (Merevia's forest: spring r4891 e → junction r4821) are not a grid;
    // without this the mapper relocated on every pass and never learned the link.
    if (isGeometricDirection(key) && !vertical && rev && target.exits.includes(rev) && !target.links[rev]?.to) return prev;
    return undefined;
  }

  /**
   * Find the known room whose recent past best explains the trajectory we just walked
   * (titles, descriptions and exits of the last few displays, connected the way we moved).
   * Rooms and links this trajectory created are not evidence: they are what is in doubt.
   * When a unique track wins clearly, phantom rooms created along it are merged into the
   * rooms they really were.
   */
  private localize(obs: RoomObservation, key: string, evidence: Evidence): { target: MapRoom; pred?: MapRoom } | undefined {
    if (obs.mode === "dark" || !this.history.length) return undefined;
    const steps: Step[] = [...this.history, { key, obs, room: "", created: false, linkedFrom: null, sure: false }];
    const fresh = new Set<string>();
    const freshLinks = new Set<string>();
    for (const s of this.history) {
      const id = this.map.canonicalId(s.room);
      if (s.created && id) fresh.add(id);
      const from = this.map.canonicalId(s.linkedFrom);
      if (from && s.key) freshLinks.add(`${from}|${s.key}`);
    }
    // Bits each display carries: how few known rooms look like it. A title repeated from the
    // previous display says nothing new (we are still in the same forest), only the exits do.
    const total = this.map.roomCount() + 1;
    // Known rooms that genuinely match each display; a step only counts for rooms among them.
    const pools = steps.map((s) => new Set(s.obs.mode === "dark" ? [] : this.candidatePool(s.obs).filter((r) => !fresh.has(r.id)).map((r) => r.id)));
    const likeCount = pools.map((p) => p.size);
    const beacon = steps.map((s, i) => {
      if (likeCount[i] !== 1) return false;
      if (s.obs.description && s.obs.description.trim().length >= MIN_MERGE_DESC) {
        if (!this.sharedDescriptionArea(s.obs)) return true;
        return this.descriptionStreakAt(steps, i) >= DESC_PIN_STREAK;
      }
      // Unique by name, counting rooms this trajectory created under that name too (but not
      // the phantom made for this very display).
      const own = s.created ? this.map.canonicalId(s.room) : undefined;
      return !!s.obs.title && this.map.roomsWithTitle(s.obs.title).filter((r) => r.id !== own).length === 1;
    });
    const info = steps.map((s, i) => {
      if (s.obs.mode === "dark") return 0;
      const like = likeCount[i]! + 1;
      const prev = steps[i - 1]?.obs;
      const sameTitle = !!s.obs.title && prev?.title === s.obs.title;
      const base = sameTitle ? this.map.roomsWithTitle(s.obs.title!).filter((r) => !fresh.has(r.id)).length + 1 : total;
      return Math.max(0, Math.log2(Math.max(base, like) / like));
    });
    const memo = new Map<string, Track>();
    const walk = (room: MapRoom, i: number): Track => {
      const mk = `${room.id}@${i}`;
      const hit = memo.get(mk);
      if (hit) return hit;
      const step = steps[i]!;
      // A step we were sure of pins the track: it passes through that room or ends here.
      const c = step.sure && this.map.canonicalId(step.room) !== room.id ? -1 : this.map.compatibility(room, step.obs);
      let res: Track;
      if (c < 0) res = { score: -1, path: [], tie: false, landmark: false, beacon: false };
      else {
        let best: Track = { score: 0, path: [], tie: false, landmark: false, beacon: false };
        if (i > 0 && step.key !== null) {
          const preds = this.predecessors(room, step.key, fresh, freshLinks);
          // An unseen move may not have happened at all.
          if (step.unseen && !fresh.has(room.id)) preds.push(room);
          for (const p of preds) {
            const t = walk(p, i - 1);
            if (t.score < 0) continue;
            if (t.score > best.score || !best.path.length) best = t;
            else if (t.score === best.score && t.score > 0) best = { ...best, tie: true };
          }
        }
        const real = c > 0 && pools[i]!.has(room.id);
        res = {
          score: best.score + (real ? info[i]! : 0),
          path: [...best.path, room.id],
          tie: best.tie,
          landmark: best.landmark || (real && likeCount[i] === 1),
          beacon: best.beacon || (real && beacon[i]!),
        };
      }
      memo.set(mk, res);
      return res;
    };
    const ranked: { r: MapRoom; t: Track; need: number }[] = [];
    for (const r of this.candidatePool(obs)) {
      if (fresh.has(r.id)) continue;
      const t = walk(r, steps.length - 1);
      const off = steps.length - t.path.length;
      // Where the track begins, it must be reachable from the room we were in before it.
      const join = this.junction(steps[off - 1], steps[off]!.key, this.map.room(t.path[0]), freshLinks);
      // Uniform corridors and forests repeat; without one unmistakable room the track could
      // be any stretch of them, and dead reckoning is the better bet. With nothing actually
      // contradicting dead reckoning, only a room unique by name or description will do.
      if (join === "no" || !(evidence === "lookalike" ? t.beacon : t.landmark)) continue;
      ranked.push({ r, t, need: NEED_BITS[evidence] + (join === "warp" ? WARP_BITS : 0) });
    }
    ranked.sort((a, b) => b.t.score - a.t.score);
    const best = ranked[0];
    if (!best || best.t.score < best.need || best.t.score - Math.max(0, ranked[1]?.t.score ?? 0) < MARGIN_BITS) {
      return undefined;
    }
    const path = best.t.path;
    if (!best.t.tie) this.repairTrail(steps, steps.length - path.length, path, fresh);
    const target = this.map.room(best.r.id);
    if (!target) return undefined;
    return { target, pred: path.length > 1 ? this.map.room(path[path.length - 2]) : undefined };
  }

  /**
   * Could we have stepped from the room of `prev` into `first` via `key`? Only a step we were
   * sure of constrains this. "no" when known exits say otherwise, "warp" when it is possible
   * but breaks the layout (a non-euclidean exit), "ok" otherwise.
   */
  private junction(
    prev: Step | undefined,
    key: string | null,
    first: MapRoom | undefined,
    freshLinks: Set<string>,
  ): "ok" | "warp" | "no" {
    const s = prev?.sure ? this.map.room(prev.room) : undefined;
    if (!s || !first || key === null) return "ok";
    if (key === "=") return s.id === first.id ? "ok" : "no";
    if (key === "?") return Object.values(s.links).some((l) => this.map.canonicalId(l.to) === first.id) ? "ok" : "warp";
    const known = (r: MapRoom, k: string) => (freshLinks.has(`${r.id}|${k}`) ? undefined : this.map.canonicalId(r.links[k]?.to));
    const out = known(s, key);
    if (out === first.id) return "ok";
    if (out) return "no";
    const rev = reverseDirection(key);
    const back = rev ? known(first, rev) : undefined;
    if (back && back !== s.id) return "no";
    return this.layoutAgrees(s, key, first) ? "ok" : "warp";
  }

  /** Rooms we could have been in one step before arriving at `room` via `key`. */
  private predecessors(room: MapRoom, key: string, fresh: Set<string>, freshLinks: Set<string>): MapRoom[] {
    const out = new Map<string, MapRoom>();
    const add = (r: MapRoom | undefined, viaExit?: string) => {
      if (!r || fresh.has(r.id)) return;
      // Coordinate/back-link guesses must at least have listed the exit we took.
      if (viaExit && r.exits.length && !r.exits.includes(viaExit) && !r.tags.includes("dynamic-exits")) return;
      out.set(r.id, r);
    };
    if (key === "=") {
      add(room);
      return [...out.values()];
    }
    for (const p of this.map.incomingRooms(room.id)) {
      for (const [k, l] of Object.entries(p.links)) {
        if (l.kind === "teleport" || (key !== "?" && k !== key) || freshLinks.has(`${p.id}|${k}`)) continue;
        if (this.map.canonicalId(l.to) === room.id) add(p);
      }
    }
    if (key === "?") {
      for (const l of Object.values(room.links)) if (l.kind !== "teleport") add(this.map.room(l.to));
    } else if (isGeometricDirection(key)) {
      const rev = reverseDirection(key)!;
      const back = room.links[rev];
      if (back?.to && !freshLinks.has(`${room.id}|${rev}`)) add(this.map.room(back.to), key);
      const v = DIRECTION_VECTORS[key]!;
      const at = { plane: room.pos.plane, x: room.pos.x - v.x, y: room.pos.y - v.y, z: room.pos.z - v.z };
      for (const r of this.map.roomsAt(at)) add(r, key);
    }
    return [...out.values()];
  }

  /** Apply a winning track: drop links made from rooms we were not in, fold phantoms in. */
  private repairTrail(steps: Step[], off: number, path: string[], fresh: Set<string>): void {
    const last = path.length - 1; // path[last] is the arrival being placed, not yet in history
    for (let j = 1; j < last; j++) {
      const s = steps[off + j]!;
      const from = this.map.canonicalId(s.linkedFrom);
      if (!from || !s.key || fresh.has(from) || from === this.map.canonicalId(path[j - 1])) continue;
      const l = this.map.room(from)?.links[s.key];
      if (l && this.map.canonicalId(l.to) === this.map.canonicalId(s.room)) this.map.unlink(from, s.key);
    }
    const onPath = new Set(path);
    for (let j = 0; j < last; j++) {
      const s = steps[off + j]!;
      const was = this.map.room(s.room);
      const real = this.map.room(path[j]);
      if (!real) continue;
      if (was && was.id !== real.id && s.created && fresh.has(was.id)) {
        for (const [cmd, l] of Object.entries(was.links)) {
          const to = this.map.canonicalId(l.to);
          if (!l.confirmed || (to && !fresh.has(to) && !onPath.has(to))) this.map.unlink(was.id, cmd);
        }
        this.map.mergeRooms(real.id, was.id);
        this.debug?.(`merged phantom ${was.id} into ${real.id}`);
      }
      s.room = this.map.canonicalId(real.id) ?? real.id;
      s.created = false;
      s.linkedFrom = null;
    }
  }

  private setHere(id: string): void {
    this.position = id;
    this.lastKnown = id;
  }

  /** Ambiguous relocation: pick the matching room closest to where we last knew we were. */
  private nearestCandidate(obs: RoomObservation): MapRoom | undefined {
    const anchor = this.map.room(this.lastKnown);
    if (!anchor) return undefined;
    const ids = new Set(this.candidatePool(obs).map((r) => r.id));
    if (ids.size === 0) return undefined;
    const path = this.map.findPath(anchor.id, (r) => ids.has(r.id), { maxSteps: 400, allowLinks: ["*"] });
    if (path && path.length <= 12) return this.map.room(path[path.length - 1]?.to ?? anchor.id);
    return ids.has(anchor.id) ? anchor : undefined;
  }

  /**
   * Ambiguous relocation with no recent position (fresh login): stationary mobs/items are a
   * strong fingerprint (only one room has PowerMud Pete). `strict`: only a unique best
   * overlap counts; otherwise the most visited room wins among equal overlaps.
   */
  private contentsCandidate(obs: RoomObservation, strict: boolean): MapRoom | undefined {
    if (!obs.contents.length) return undefined;
    // Wandering mobs (`..._move` paths on Powermud) and corpses prove nothing about the room.
    const want = obs.contents
      .filter((c) => c.kind !== "corpse" && !/_move\b/.test(c.path ?? ""))
      .map((c) => c.path?.replace(/#\d+$/, "") ?? c.name);
    if (!want.length) return undefined;
    let best: { room: MapRoom; score: number } | undefined;
    let tied = false;
    for (const r of this.candidatePool(obs)) {
      const overlap = want.filter((k) => r.contents[k] || Object.values(r.contents).some((c) => c.name === k)).length;
      if (overlap === 0) continue;
      const score = strict ? overlap : overlap * 1e6 + r.visits;
      if (!best || score > best.score) {
        tied = false;
        best = { room: r, score };
      } else if (score === best.score) tied = true;
    }
    return best && !tied ? best.room : undefined;
  }

  /** Every known room the observation could describe (title/description + exits). */
  private candidatePool(obs: RoomObservation): MapRoom[] {
    if (obs.mode === "dark") return [];
    const pool = obs.title ? this.map.roomsWithTitle(obs.title) : this.map.rooms();
    return pool.filter(
      (r) =>
        this.map.compatibility(r, obs) > 0 &&
        (!obs.description || r.descKeys.length > 0) &&
        !r.tags.includes(VESSEL_TAG) &&
        this.reachable(r),
    );
  }

  /**
   * Arrival into an unlinked spot: look for a known room that matches and whose neighbor
   * back along `key` is (or duplicates) the room we came from. Returns the target and,
   * when `from` turned out to be a duplicate fragment room, the established room it equals.
   */
  private verifiedCandidate(
    obs: RoomObservation,
    from: MapRoom,
    key: string,
  ): { target: MapRoom; absorbInto?: MapRoom } | undefined {
    const rev = reverseDirection(key);
    const strong: MapRoom[] = [];
    const dup: { target: MapRoom; x: MapRoom }[] = [];
    const weak: MapRoom[] = [];
    for (const c of this.candidatePool(obs)) {
      if (c.id === from.id || !this.map.sameContinent(from, c)) continue;
      if (!rev) {
        weak.push(c);
        continue;
      }
      if (!c.exits.includes(rev)) continue;
      const backId = c.links[rev]?.to;
      if (backId === from.id) strong.push(c);
      else if (backId) {
        const back = this.map.room(backId);
        if (back && back.pos.plane !== from.pos.plane && this.sameRoom(back, from)) dup.push({ target: c, x: back });
      } else weak.push(c);
    }
    if (strong.length === 1) return { target: strong[0]! };
    if (strong.length > 1) return undefined;
    if (dup.length === 1) return { target: dup[0]!.target, absorbInto: dup[0]!.x };
    if (dup.length > 1) return undefined;
    if (weak.length === 1) {
      const c = weak[0]!;
      const titled = obs.title ? this.map.roomsWithTitle(obs.title).length : 0;
      const strongSig = !!obs.description && (c.description?.length ?? 0) >= MIN_MERGE_DESC;
      if (c.pos.plane !== from.pos.plane && ((strongSig && this.descriptionPinAllowed(obs)) || titled === 1)) {
        return { target: c };
      }
    }
    return undefined;
  }

  /**
   * A confirmed link led somewhere that does not match: we probably missed a room display
   * and are a step or two off. Jump to the unique matching room nearby without linking.
   */
  private resyncNear(from: MapRoom, obs: RoomObservation): boolean {
    const seen = new Set([from.id]);
    let layer = [from];
    const hits: MapRoom[] = [];
    for (let depth = 0; depth < 3 && layer.length; depth++) {
      const next: MapRoom[] = [];
      for (const r of layer) {
        for (const l of Object.values(r.links)) {
          const n = this.map.room(l.to);
          if (!n || seen.has(n.id)) continue;
          seen.add(n.id);
          next.push(n);
          if (this.map.compatibility(n, obs) > 1) hits.push(n);
        }
      }
      if (hits.length) break;
      layer = next;
    }
    if (hits.length !== 1) return false;
    const target = hits[0]!;
    this.map.applyObservation(target, obs);
    this.setHere(target.id);
    this.emit({ type: "moved", from: from.id, to: target.id, how: "relocate", created: false });
    return true;
  }

  /** `from` is a fragment duplicate of `into`: align its plane onto `into`'s and merge. */
  private absorb(from: MapRoom, into: MapRoom): MapRoom {
    if (from.pos.plane !== into.pos.plane) {
      const offset = subVec(into.pos, from.pos);
      this.map.mergePlanes(into.pos.plane, from.pos.plane, offset);
      this.dedupePlane(into.pos.plane);
    }
    if (this.map.room(from.id)) this.map.mergeRooms(into.id, from.id);
    this.emit({ type: "planes-merged", into: into.pos.plane });
    return this.map.room(into.id)!;
  }

  private arrive(obs: RoomObservation, key: string): void {
    let from = this.current();
    if (!from) {
      this.relocate(obs, key);
      return;
    }
    // Still unsure of our footing after a contradiction: let the trajectory speak first. When
    // the map itself explains this step (a link to a matching room), only a beacon overrides it.
    if (this.doubt > 0) {
      const t = this.map.room(from.links[key]?.to);
      const explained = !!t && this.map.compatibility(t, obs) > 0;
      if (this.relocalize(obs, key, explained ? "lookalike" : this.doubtNeed)) return;
    }
    const geometric = isGeometricDirection(key);
    const kind = exitKindFor(key, from.exits);
    // An unlisted command with no exit behind it yet is the weakest explanation there is for a
    // room display: commands answered late (combat rounds) or without a prompt leave it at the
    // head of the queue while a later move's display arrives. Before it becomes a secret exit:
    if (kind === "special" && !from.links[key]?.to && obs.mode !== "dark") {
      // ...a neighbor we already know explains the display (`enter crack` → the room `se` leads to).
      const via = this.neighborVia(from, obs, undefined, true);
      if (via && via !== key) {
        this.debug?.(`special ${key} from ${from.id} explained by known exit ${via}`);
        this.creditQueued(via);
        this.arrive(obs, via);
        return;
      }
      // ...and a command that is no travel verb (`double-thrust`, `globe of darkness on lich`)
      // never leads into a room the map already knows: that is an unexplained move, placed by
      // the trajectory. It may still discover a brand-new room (benefit of the doubt).
      if (!looksLikeTravelCommand(key, from) && this.relocate(obs, "?", undefined, { knownOnly: true })) {
        this.debug?.(`non-travel ${key} from ${from.id} not recorded as an exit`);
        return;
      }
    }
    let target: MapRoom | undefined;
    // Followed the map (link or coordinate) rather than a guess.
    let mapped = false;
    // Evidence that dead reckoning is off: the exit is not one the room has, the link leads
    // to a room that looks nothing like this, or a different room already sits where we land.
    let suspect = geometric && from.exits.length > 0 && !from.exits.includes(key) && !from.tags.includes("dynamic-exits");

    const link = from.links[key];
    // Nothing to see (dark, or Deepwater's blinding glare) and the map only guesses where this
    // exit goes, a guess the far room's own exits deny (no way back): following it would confirm
    // it unseen, and the next refusals would be charged to a room we are not in (r2183 `n` →
    // fish shop r4774, which only opens east; really Waterside Road). We moved, but to an
    // unknown room: drop our footing until the next display places us.
    if (obs.mode === "dark" && link?.to && !link.confirmed && this.guessDenied(key, link.to)) {
      this.lastKnown = from.id;
      this.position = null;
      this.history = [];
      this.emit({ type: "lost", reason: `unseen step ${key} along an unwalked link` });
      return;
    }
    if (link?.to) {
      const t = this.map.room(link.to);
      if (t && this.map.compatibility(t, obs) >= 0) {
        target = t;
        mapped = true;
      } else if (t) {
        if (this.relocalize(obs, key, "contradiction")) return;
        if (link.confirmed && this.resyncNear(from, obs)) return;
        suspect = true;
      }
    }

    // An unlisted move answered by this very room (long description and exits agree): the
    // step never happened — a mid-fight redisplay, or a refusal we did not recognise. Never
    // mint a look-alike copy beside the room we are in (Rothe Island shore r88 → r471/r472).
    if (!target && !from.exits.includes(key) && !link?.to && this.isSameSpot(from, obs)) {
      this.map.applyObservation(from, obs);
      this.record("=", obs, from.id, { sure: this.history.at(-1)?.sure });
      this.emit({ type: "moved", from: from.id, to: from.id, how: "look", created: false });
      return;
    }

    if (!target && geometric) {
      const expected = this.map.expectedPos(from, key)!;
      const there = this.map.roomsAt(expected);
      const scored = there
        .map((r) => ({ r, s: this.map.compatibility(r, obs) }))
        .filter(({ r, s }) => s > 0 || (s === 0 && r.dark))
        .sort((a, b) => b.s - a.s);
      target = scored[0]?.r;
      mapped = !!target;
      if (!target && there.some((r) => !r.dark && r.visits > 1)) suspect = true;
    }

    if (!target && !geometric) {
      // `out` / `leave` usually returns to a room that leads here.
      const back = this.map.incomingRooms(from.id).filter((r) => this.map.compatibility(r, obs) > 0);
      if (back.length === 1) target = back[0];
    }

    // A description we already know pins us down regardless of where we thought we were.
    let described = !target && obs.mode !== "dark" ? this.describedRoom(obs, from) : undefined;
    // We surely stood in `from` and took an exit it lists, but the known room with this prose
    // is already wired elsewhere on the way back and sits somewhere else: the game has two
    // rooms with identical text (Kalinport's twin Oasis Avenue blocks around r1352), not a warp.
    const twin = !!described && this.isTwinOf(from, key, described);
    if (twin) described = undefined;
    // About to invent a room that looks like one we know (warped exit, missed display):
    // check whether the way we came matches the way into that known room.
    const lookalike = !twin && !target && obs.mode !== "dark" && this.candidatePool(obs).length > 0;
    if (!target && !twin && (suspect || described || lookalike)) {
      if (this.relocalize(obs, key, suspect || described ? "contradiction" : "lookalike")) return;
    }

    if (!target && !twin && obs.mode !== "dark") {
      const v = this.verifiedCandidate(obs, from, key);
      if (v) {
        target = v.target;
        if (v.absorbInto) from = this.absorb(from, v.absorbInto);
      }
    }

    if (!target && described) {
      // The grid agrees, or the exits do (a bent trail: both ends list the step, neither is wired).
      if (this.layoutAgrees(from, key, described) || this.unlinkedPredecessor(from.id, key, described)) target = described;
      else {
        // We are in that room, but the way we got here says we were not where we thought.
        this.map.applyObservation(described, obs);
        const was = from.id;
        this.setHere(described.id);
        this.record(key, obs, described.id);
        this.suspectFor("doubt");
        this.emit({ type: "moved", from: was, to: described.id, via: key, how: "relocate", created: false });
        return;
      }
    }

    let created = false;
    if (!target) {
      if (geometric) {
        target = this.map.createRoom(this.map.expectedPos(from, key)!);
      } else {
        const plane = this.map.newPlane("aside", { plane: from.pos.plane, fromRoom: from.id, via: key });
        target = this.map.createRoom({ plane: plane.id, x: 0, y: 0, z: 0 });
      }
      created = true;
      if (suspect) this.suspectFor("doubt");
      else if (lookalike) this.suspectFor("lookalike");
    }

    from = this.map.room(from.id) ?? from;
    target = this.map.room(target.id) ?? target;
    // A named or secret command that redisplayed the room it was typed in (`gate`, `search`)
    // did not move us: never record it as an exit back into the same room.
    if (!geometric && target.id === from.id) {
      this.map.applyObservation(from, obs);
      this.record("=", obs, from.id, { sure: this.history.at(-1)?.sure });
      this.emit({ type: "moved", from: from.id, to: from.id, how: "look", created: false });
      return;
    }
    if (isTeleportOnlyCommand(key)) {
      this.map.applyObservation(target, obs);
      this.setHere(target.id);
      this.record(null, obs, target.id, { created });
      this.emit({ type: "moved", from: from.id, to: target.id, how: "relocate", created });
      return;
    }
    // A well-walked exit that suddenly leads somewhere else: one observation (a slipped queue, a
    // missed display, a shove) does not rewrite it. We go where the display says, in doubt, and
    // only the same other room showing up again re-points the link.
    const old = from.links[key];
    const oldTo = this.map.canonicalId(old?.to);
    if (old && oldTo && oldTo !== target.id && old.confirmed && (old.uses >= ESTABLISHED_USES || old.verified) && obs.mode !== "dark") {
      const again = old.contested && this.map.canonicalId(old.contested.to) === target.id ? old.contested.count + 1 : 1;
      if (again < (old.verified ? 4 : 2)) {
        old.contested = { to: target.id, count: again };
        this.map.touch();
        this.map.applyObservation(target, obs);
        this.setHere(target.id);
        this.record(key, obs, target.id, { created });
        this.suspectFor("doubt");
        this.debug?.(`contested ${from.id} ${key}: ${oldTo} (u${old.uses}) vs ${target.id} #${again}`);
        this.emit({ type: "moved", from: from.id, to: target.id, via: key, how: "relocate", created });
        return;
      }
    }
    if (old?.contested && oldTo === target.id) {
      delete old.contested;
      this.map.touch();
    }
    const newLink = this.map.canonicalId(from.links[key]?.to) !== target.id;
    const merged = this.map.connect(from, key, target, { confirmed: true, hidden: kind === "special" });
    this.map.applyObservation(target, obs);
    if (geometric) this.map.inferReverse(from, key, target);
    this.setHere(target.id);
    if (merged) {
      this.dedupePlane(this.map.room(target.id)!.pos.plane);
      this.emit({ type: "planes-merged", into: this.current()?.pos.plane ?? "" });
    }
    if (!this.map.room(this.position)) this.position = null;
    this.record(key, obs, this.position ?? target.id, {
      created,
      linkedFrom: newLink ? from.id : null,
      sure: mapped && !suspect && obs.mode !== "dark",
    });
    this.emit({ type: "moved", from: from.id, to: this.position ?? target.id, via: key, how: "exit", created });
  }

  /** The room a compass guess leads to has a known exit list without the way back. */
  private guessDenied(key: string, toId: string): boolean {
    const rev = reverseDirection(key);
    const to = this.map.room(toId);
    if (!rev || !isGeometricDirection(key) || !to || to.dark || to.tags.includes("dynamic-exits")) return false;
    return to.exits.length > 0 && !to.exits.includes(rev);
  }

  /** Normalized verbose text long enough to treat as a cross-area fingerprint. */
  private pinDescription(obs: RoomObservation): string | undefined {
    if (obs.mode === "dark" || !obs.description?.trim()) return undefined;
    const norm = normalizeDescription(obs.description);
    return norm.length >= MIN_MERGE_DESC ? norm : undefined;
  }

  /** How many consecutive displays ending at `endIndex` share the same long normalized description. */
  private descriptionStreakAt(steps: Pick<Step, "obs">[], endIndex: number): number {
    const pin = this.pinDescription(steps[endIndex]?.obs ?? { mode: "dark", exits: [], contents: [] });
    if (!pin) return 0;
    let streak = 0;
    for (let i = endIndex; i >= 0; i--) {
      if (this.pinDescription(steps[i]!.obs) !== pin) break;
      streak += 1;
    }
    return streak;
  }

  private descriptionPinReady(obs: RoomObservation): boolean {
    const steps: Pick<Step, "obs">[] = [...this.history, { obs }];
    return this.descriptionStreakAt(steps, steps.length - 1) >= DESC_PIN_STREAK;
  }

  /** Several mapped rooms share this prose — need a uniform run before a description pin. */
  private sharedDescriptionArea(obs: RoomObservation): boolean {
    const ids = this.map.roomIdsMatchingDescription(obs);
    return ids.length >= 2 && !this.map.soleEstablished(ids);
  }

  private descriptionPinAllowed(obs: RoomObservation): boolean {
    if (!this.sharedDescriptionArea(obs)) return true;
    return this.descriptionPinReady(obs);
  }

  /**
   * The one known room this display identifies by itself: a long enough description only it
   * has (or three identical displays when that prose is shared), or a title only it has
   * (with matching exits) when it is the only room by that name.
   */
  private describedRoom(obs: RoomObservation, from: MapRoom): MapRoom | undefined {
    if (obs.description && obs.description.trim().length >= MIN_MERGE_DESC) {
      if (!this.descriptionPinAllowed(obs)) return undefined;
      const r = this.map.findByObservation(obs, { allowTitle: false }).room;
      // Another landmass is never a walk away (Kelton's Profession trainer is word for word
      // Dunagin's r1370, which the old mapper wired to Kelton's street).
      return r && r.id !== from.id && (r.description?.length ?? 0) >= MIN_MERGE_DESC && this.reachable(r) && this.map.sameContinent(from, r)
        ? r
        : undefined;
    }
    if (!obs.title || obs.description) return undefined;
    const titled = this.map.roomsWithTitle(obs.title);
    const r = titled.length === 1 ? titled[0]! : undefined;
    return r && r.id !== from.id && r.visits > 1 && this.map.compatibility(r, obs) > 0 ? r : undefined;
  }

  /**
   * `known` matches the display, but we surely left `from` by a listed, still-unmapped compass
   * exit, `known` sits elsewhere, and its way back already leads to a different known room.
   */
  private isTwinOf(from: MapRoom, key: string, known: MapRoom): boolean {
    if (!isGeometricDirection(key) || this.doubt > 0) return false;
    const last = this.history.at(-1);
    if (!last?.sure || this.map.canonicalId(last.room) !== from.id) return false;
    if (!from.exits.includes(key) || from.links[key]?.to) return false;
    if (this.layoutAgrees(from, key, known)) return false;
    const rev = reverseDirection(key);
    const back = rev ? known.links[rev] : undefined;
    if (!back?.to || !back.confirmed) return false;
    const other = this.map.canonicalId(back.to);
    return !!other && other !== from.id && !!this.map.room(other);
  }

  /** Linking `from --key--> to` keeps the layout sane (other plane, named exit, or right spot). */
  private layoutAgrees(from: MapRoom, key: string, to: MapRoom): boolean {
    if (!this.map.sameContinent(from, to)) return false;
    if (!isGeometricDirection(key) || from.pos.plane !== to.pos.plane) return true;
    const p = this.map.expectedPos(from, key)!;
    return p.x === to.pos.x && p.y === to.pos.y && p.z === to.pos.z;
  }

  private sameRoom(a: MapRoom, b: MapRoom): boolean {
    return sameRoomIn(this.map, a, b);
  }

  /** After a plane merge, collapse duplicate rooms that landed on the same coordinate. */
  private dedupePlane(plane: string): void {
    const seen = new Map<string, MapRoom[]>();
    for (const r of this.map.rooms()) {
      if (r.pos.plane !== plane) continue;
      const k = `${r.pos.x},${r.pos.y},${r.pos.z}`;
      let list = seen.get(k);
      if (!list) seen.set(k, (list = []));
      list.push(r);
    }
    for (const list of seen.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
      const keep = list[0]!;
      for (const other of list.slice(1)) {
        if (!this.sameRoom(keep, other)) continue;
        if (this.position === other.id) this.position = keep.id;
        if (this.lastKnown === other.id) this.lastKnown = keep.id;
        this.map.mergeRooms(keep.id, other.id);
      }
    }
  }
}

function sameRoomIn(map: WorldMap, a: MapRoom, b: MapRoom): boolean {
  let evidence = false;
  if (a.title && b.title) {
    if (!map.titleMatches(a, b.title) && !map.titleMatches(b, a.title)) return false;
    evidence = true;
  }
  if (a.descKeys.length && b.descKeys.length) {
    if (!map.descriptionsAgree(a, b)) return false;
    evidence = true;
  }
  if (a.exits.length && b.exits.length) {
    const sa = new Set(a.exits);
    if (a.exits.length !== b.exits.length || !b.exits.every((e) => sa.has(e))) return false;
  }
  return evidence;
}
