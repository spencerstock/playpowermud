import {
  addVec,
  DIRECTION_VECTORS,
  isGeometricDirection,
  isVertical,
  reverseDirection,
  sameExitSet,
  subVec,
  type Vec3,
} from "../game/directions.js";
import { descriptionWithDoorStates, OPEN_DOOR_COMMAND, parseDoors } from "../game/doors.js";
import { cleanseRoomDescription, isRoomDescriptionNoiseLine } from "../game/roomDescriptionNoise.js";
import { isLearnedSpecial, looksLikeTravelCommand } from "./specialExits.js";
import type { DoorState, RoomDoor, RoomObservation } from "../game/types.js";
import { areaDisplayLabel, propagateAreas } from "./areaInfer.js";
import { buildNoiseContext, type NoiseContext, scrubDescription } from "./descriptionIntegrity.js";
import { CONTRADICTED_GUESS_COST, isTeleportOnlyCommand, linkNeverPathed, PREFER_AVOID_ROOM_COST, transitLinkAllowed } from "./pathPolicy.js";
import { npcMatchFor, npcNamesForRoom, syncRoomNpcs } from "./npcs.js";
import { isNumericRoomIdQuery } from "./roomIdQuery.js";
import { ensureWaypoints, normalizeWaypointName, remapWaypointRoomIds } from "./waypoints.js";
import type {
  ExitKind,
  MapLink,
  MapPlane,
  MapPos,
  MapRoom,
  MapTransit,
  PathOptions,
  PathStep,
  StoredContent,
  WorldGraphDocument,
} from "./types.js";

const DESC_KEY_LEN = 80;
/** A description key stored before door state was ignored: `... ( closed ).` */
const DOOR_STATE_IN_KEY = /\(\s*(?:opened|closed|locked)\s*\)/;
/** A tail this long that is another room's whole description proves the lines above it are chatter. */
const MIN_PREFIX_PROOF_DESC = 60;
const MAX_PREFIX_LINES = 8;
/** Prose at least this long (normalized) is distinctive enough to merge copies by their neighbors. */
const CHAIN_MERGE_MIN_DESC = 120;
/** A compass link neither end lists that no listed exit explains, kept only as a costly guess. */
export const SUSPECT_LINK_NOTE = "neither room lists this exit";
const SUSPECT_LINK_WEIGHT = 8;
/** Least path cost of a ride (ships cost a pass and minutes; walking wins when it exists). */
const TRANSIT_MIN_WEIGHT = 20;
/** Same-plane copies farther apart than this are look-alikes (a road reusing prose), not copies. */
const CHAIN_MERGE_MAX_CELLS = 2;
/** How long a failed move stays off pathing and the unmapped-exit frontier. */
export const BLOCK_TTL_MS = 10 * 60_000;
/**
 * Consecutive failed moves on one link before pathing treats it as blocked.
 * One miss (a crawl that didn't take, a mob in the way) stays usable so the walker retries.
 */
export const BLOCK_AFTER_CONSECUTIVE_FAILS = 20;
/** Failed compass moves on the same link before it is removed and the map is healed. */
export const NAV_FAILURES_BEFORE_HEAL = 20;
/** The game's flat "no exit that way" answers (not a guard, door or fight in the way). */
const UNLISTED_REFUSALS_BEFORE_HEAL = 3;
const UNLISTED_REFUSAL_RE = /cannot go that direction|can't go that way|alas, you cannot go that way/i;

export type NavFailureResult = {
  failures: number;
  healed: boolean;
  detail?: string;
};

/** Room predicates normalize the same stored descriptions over and over; strings are immutable, so memoize. */
const NORMALIZED_DESC_CACHE_MAX = 4096;
const normalizedDescCache = new Map<string, string>();

export function normalizeDescription(desc: string): string {
  const hit = normalizedDescCache.get(desc);
  if (hit !== undefined) return hit;
  const norm = desc
    .toLowerCase()
    .replace(/\(\s*(?:opened|closed|locked)\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalizedDescCache.size >= NORMALIZED_DESC_CACHE_MAX) normalizedDescCache.clear();
  normalizedDescCache.set(desc, norm);
  return norm;
}

/** Suffix key: travel/flavor text is prepended to arrival descriptions, never appended. */
export function descKey(desc: string): string {
  return normalizeDescription(desc).slice(-DESC_KEY_LEN);
}

/** Shortest normalized description whose middle can identify a room by itself. */
const CORE_MIN_LEN = 150;

/**
 * Two long descriptions of one room that differ only at the edges: a combat or flavor line
 * glued to the start, or a last line cut off (`... but OUCH!` vs `... OUCH! You hit your
 * head on a stalactite!`). The shorter text, or its middle 60%, must appear in the other.
 * Both inputs are normalized (see `normalizeDescription`).
 */
export function descriptionCoresOverlap(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < CORE_MIN_LEN) return false;
  if (long.includes(short)) return true;
  const from = Math.floor(short.length * 0.2);
  const core = short.slice(from, Math.ceil(short.length * 0.8));
  // Aligned on the core, the texts may only differ by a glued-on start (one head ends the other)
  // and a cut-off end (one tail starts the other). Rooms sharing boilerplate prose (Kalinport's
  // "You are in Kalinport's merchant section, …" + one distinct last line) share a core but not
  // the tail.
  for (let p = long.indexOf(core); p >= 0; p = long.indexOf(core, p + 1)) {
    const sTail = short.slice(from);
    const lTail = long.slice(p);
    const sHead = short.slice(0, from);
    const lHead = long.slice(0, p);
    const tailsAgree = lTail.startsWith(sTail) || sTail.startsWith(lTail);
    const headsAgree = lHead.endsWith(sHead) || sHead.endsWith(lHead);
    if (tailsAgree && headsAgree) return true;
  }
  return false;
}

/** Whole-line system/travel/mob chatter prepended before the real room display. */
function isFlavorPrefix(prefix: string): boolean {
  if (!prefix.endsWith("\n")) return false;
  const lines = prefix.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => isRoomDescriptionNoiseLine(l));
}

/**
 * `prefix` stands apart from the prose that follows it: it ends at a blank line, or its last line
 * ends a sentence while the next word would still have fit on it (a hard break — wrapped prose
 * never does that). A prefix that runs on in the same wrapped paragraph is a real first line.
 */
export function isDetachedPrefix(prefix: string, rest: string): boolean {
  if (!prefix.endsWith("\n")) return false;
  if (/\n\s*\n$/.test(prefix)) return true;
  const last = prefix.trimEnd().split("\n").pop()!.trimEnd();
  const firstWord = rest.trimStart().split(/\s+/)[0] ?? "";
  return /[.!?'")\]]$/.test(last) && last.length + 1 + firstWord.length <= 77 && /^[A-Z]/.test(rest.trimStart());
}

/**
 * Which description to keep when a room is seen again. Travel flavor is prepended to arrival
 * displays, so a shorter view may be the clean one — but a view whose start was cut off (replayed
 * buffer, partial capture) is also shorter.
 *
 * A prefix is dropped when it is known flavor or when it is *detached* from the prose (see
 * {@link isDetachedPrefix}); a longer view wins only when its extra start runs on in the same
 * wrapped paragraph (it restores a cut-off first line). The old rule — "longer wins unless the
 * prefix is on the denylist" — let every unknown message (`You are no longer blessed.`) replace a
 * clean description; scripts/map-integrity.ts found 107 rooms dirtied that way in two days.
 */
export function preferDescription(
  stored: string | undefined,
  next: string,
  matches: (d: string) => boolean,
): string {
  if (!stored || !matches(stored)) return next;
  if (stored === next) return stored;
  if (stored.endsWith(next)) {
    const prefix = stored.slice(0, -next.length);
    return isFlavorPrefix(prefix) || isDetachedPrefix(prefix, next) ? next : stored;
  }
  if (next.endsWith(stored)) {
    const prefix = next.slice(0, -stored.length);
    return isFlavorPrefix(prefix) || isDetachedPrefix(prefix, stored) ? stored : next;
  }
  return next.length < stored.length ? next : stored;
}

/**
 * Description to keep when two records of a room merge. Chatter is glued to the top of a
 * display, so when one copy ends with the other the shorter one is the clean one. Otherwise the
 * longer wins (it may restore a cut-off end).
 */
export function mergedDescription(keep: string | undefined, drop: string | undefined): string | undefined {
  if (!keep || !drop) return keep ?? drop;
  const [short, long] = keep.length <= drop.length ? [keep, drop] : [drop, keep];
  return normalizeDescription(long).endsWith(normalizeDescription(short)) ? short : long;
}

/**
 * How far apart two copies sit for merging: cells on one plane (Chebyshev), 0 across planes
 * (separately mapped pieces have unrelated coordinates).
 */
function copyDistance(a: MapPos, b: MapPos): number {
  if (a.plane !== b.plane) return 0;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

/** The older of two room ids (`r12` before `r120`); falls back to string order. */
function olderRoomId(a: string, b: string): string {
  const na = Number(a.replace(/^\D+/, ""));
  const nb = Number(b.replace(/^\D+/, ""));
  if (a.replace(/\d+$/, "") === b.replace(/\d+$/, "") && Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na < nb ? a : b;
  return a <= b ? a : b;
}

function posKey(p: MapPos): string {
  return `${p.plane}:${p.x},${p.y},${p.z}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function exitKindFor(cmd: string, listedExits: readonly string[]): ExitKind {
  if (isGeometricDirection(cmd)) return isVertical(cmd) ? "vertical" : "dir";
  return listedExits.includes(cmd) ? "named" : "special";
}

export function emptyWorldGraph(mud: string): WorldGraphDocument {
  return {
    version: 1,
    mud,
    updatedAt: nowIso(),
    nextRoom: 1,
    nextPlane: 1,
    rooms: {},
    planes: {},
    areas: {},
  };
}

export type ObservationMatch = { room: MapRoom | null; candidates: number };

export type HealReport = {
  /** Duplicate rooms folded into the room they copy. */
  merged: number;
  /** Links on exits the room does not have (or inferred links whose reason is gone). */
  linksPruned: number;
  /** Unexplored exits joined to the adjacent room that lists the way back. */
  linksStitched: number;
  /** Rooms that should not exist: blank placeholders and disconnected copies. */
  roomsRemoved: number;
  planesRemoved: number;
  /** Room area labels inferred or updated from descriptions and map links. */
  areasInferred: number;
  /** Stored verbose descriptions scrubbed of leaked game lines. */
  descriptionsCleaned: number;
  /** Self-learned secret exits that only duplicated a better-attested way to the same room. */
  redundantSpecials?: number;
  /** Two records of one room merged on neighbor evidence (same cell / exit back and forth). */
  conflictsResolved?: number;
  /** Redirects to rooms that no longer exist, dropped; chains flattened. */
  redirectsPruned?: number;
  /** Planes rooms sit on that were missing from the plane list, registered. */
  planesRegistered?: number;
  /** Descriptions whose leading lines were chatter another room's clean copy proves. */
  prefixesStripped?: number;
  /** Descriptions with leaked edge lines found by shape + map evidence (descriptionIntegrity.ts). */
  leakedLinesScrubbed?: number;
  /** Copies of one room (rare prose, same exits, neighbors that agree) merged. */
  chainsMerged?: number;
  /** Thin look-alike fragments folded into their well-wired original. */
  lookalikesFolded?: number;
};

/**
 * World graph with spatial/title/description indexes. Rooms live on planes (layout
 * coordinate systems). Compass moves stay on a plane, up/down change z, named/secret
 * exits open "aside" planes. Disconnected discoveries start new surface planes and are
 * merged (translated) when a compass link between them is found.
 */
export class WorldMap {
  private byPos = new Map<string, Set<string>>();
  private byTitle = new Map<string, Set<string>>();
  private byDesc = new Map<string, Set<string>>();
  private incoming = new Map<string, Set<string>>();
  private dirty = false;
  /** Map-wide evidence for leaked-line detection; rebuilt by heal() and every N observations. */
  private noiseCtx: NoiseContext | null = null;
  private noiseCtxAge = 0;

  constructor(readonly doc: WorldGraphDocument) {
    this.reindex();
  }

  static empty(mud: string): WorldMap {
    return new WorldMap(emptyWorldGraph(mud));
  }

  /** Drop all rooms/planes and start a fresh graph (same on-disk path, new ids). */
  replaceWithEmpty(mud: string): void {
    const empty = emptyWorldGraph(mud);
    this.doc.version = empty.version;
    this.doc.mud = empty.mud;
    this.doc.updatedAt = empty.updatedAt;
    this.doc.nextRoom = empty.nextRoom;
    this.doc.nextPlane = empty.nextPlane;
    this.doc.rooms = empty.rooms;
    this.doc.planes = empty.planes;
    this.doc.areas = empty.areas;
    delete this.doc.redirects;
    delete this.doc.waypoints;
    this.reindex();
    this.touch();
  }

  /** True when the document changed since the last `markClean()`. */
  get isDirty(): boolean {
    return this.dirty;
  }

  markClean(): void {
    this.dirty = false;
  }

  touch(): void {
    this.dirty = true;
    this.doc.updatedAt = nowIso();
  }

  reindex(): void {
    this.byPos.clear();
    this.byTitle.clear();
    this.byDesc.clear();
    this.incoming.clear();
    for (const room of Object.values(this.doc.rooms)) this.indexRoom(room);
  }

  private addTo(map: Map<string, Set<string>>, key: string, id: string): void {
    let s = map.get(key);
    if (!s) map.set(key, (s = new Set()));
    s.add(id);
  }

  private removeFrom(map: Map<string, Set<string>>, key: string, id: string): void {
    const s = map.get(key);
    if (!s) return;
    s.delete(id);
    if (s.size === 0) map.delete(key);
  }

  /** Graph JSON and merges may omit arrays; keep invariants before indexing or API export. */
  private ensureRoomShape(room: MapRoom): void {
    room.descKeys ??= [];
    room.exits ??= [];
    room.links ??= {};
    room.contents ??= {};
    room.tags ??= [];
    room.notes ??= [];
    room.meta ??= {};
  }

  private indexRoom(room: MapRoom): void {
    this.ensureRoomShape(room);
    syncRoomNpcs(room);
    this.addTo(this.byPos, posKey(room.pos), room.id);
    if (room.title) this.addTo(this.byTitle, room.title, room.id);
    for (const t of room.titleAliases ?? []) this.addTo(this.byTitle, t, room.id);
    for (const k of room.descKeys) this.addTo(this.byDesc, k, room.id);
    for (const link of Object.values(room.links)) {
      if (link.to) this.addTo(this.incoming, link.to, room.id);
    }
  }

  private unindexRoom(room: MapRoom): void {
    this.removeFrom(this.byPos, posKey(room.pos), room.id);
    if (room.title) this.removeFrom(this.byTitle, room.title, room.id);
    for (const t of room.titleAliases ?? []) this.removeFrom(this.byTitle, t, room.id);
    for (const k of room.descKeys) this.removeFrom(this.byDesc, k, room.id);
    for (const link of Object.values(room.links)) {
      if (link.to) this.removeFrom(this.incoming, link.to, room.id);
    }
  }

  room(id: string | null | undefined): MapRoom | undefined {
    const c = this.canonicalId(id);
    return c ? this.doc.rooms[c] : undefined;
  }

  /** Follow merge redirects to the surviving room id. */
  canonicalId(id: string | null | undefined): string | undefined {
    if (!id) return undefined;
    let cur = id;
    for (let i = 0; i < 32 && !this.doc.rooms[cur]; i++) {
      const next = this.doc.redirects?.[cur];
      if (!next) return undefined;
      cur = next;
    }
    return this.doc.rooms[cur] ? cur : undefined;
  }

  rooms(): MapRoom[] {
    return Object.values(this.doc.rooms);
  }

  roomCount(): number {
    return Object.keys(this.doc.rooms).length;
  }

  roomsAt(pos: MapPos): MapRoom[] {
    const ids = this.byPos.get(posKey(pos));
    return ids ? [...ids].map((id) => this.doc.rooms[id]!).filter(Boolean) : [];
  }

  roomsWithTitle(title: string): MapRoom[] {
    const ids = this.byTitle.get(title);
    return ids ? [...ids].map((id) => this.doc.rooms[id]!).filter(Boolean) : [];
  }

  /** Rooms with a link into `id`. */
  incomingRooms(id: string): MapRoom[] {
    const ids = this.incoming.get(id);
    return ids ? [...ids].map((r) => this.doc.rooms[r]!).filter(Boolean) : [];
  }

  newPlane(kind: MapPlane["kind"], parent?: MapPlane["parent"], label?: string): MapPlane {
    const id = `p${this.doc.nextPlane++}`;
    const plane: MapPlane = { id, kind, parent, label, createdAt: nowIso() };
    this.doc.planes[id] = plane;
    this.touch();
    return plane;
  }

  /** The transit-only landmass a plane belongs to (its own mark, or its parent chain's). */
  continentOf(planeId: string | undefined): string | undefined {
    const seen = new Set<string>();
    let p = planeId ? this.doc.planes[planeId] : undefined;
    while (p && !seen.has(p.id)) {
      if (p.continent) return p.continent;
      seen.add(p.id);
      p = p.parent ? this.doc.planes[p.parent.plane] : undefined;
    }
    return undefined;
  }

  /** Both rooms on the same landmass: walking, merging and matching may join them. */
  sameContinent(a: MapRoom, b: MapRoom): boolean {
    return this.continentOf(a.pos?.plane) === this.continentOf(b.pos?.plane);
  }

  createRoom(pos: MapPos, obs?: RoomObservation): MapRoom {
    const id = `r${this.doc.nextRoom++}`;
    const at = nowIso();
    const room: MapRoom = {
      id,
      descKeys: [],
      exits: [],
      links: {},
      pos: { ...pos },
      contents: {},
      tags: [],
      notes: [],
      meta: {},
      visits: 0,
      firstSeenAt: at,
      lastSeenAt: at,
    };
    this.doc.rooms[id] = room;
    this.indexRoom(room);
    if (obs) this.applyObservation(room, obs);
    this.touch();
    return room;
  }

  /**
   * Evidence that `obs` describes `room`: -1 contradicts, 0 no evidence (e.g. dark
   * placeholder), >0 positive (title 2, description 3, exits 1).
   */
  compatibility(room: MapRoom, obs: RoomObservation): number {
    if (obs.mode === "dark") return 0;
    let score = 0;
    let descMatched = false;
    if (obs.title && room.title) {
      if (!this.titleMatches(room, obs.title)) return -1;
      score += 2;
    }
    if (obs.description && room.descKeys.length) {
      if (this.descriptionMatches(room, obs.description)) {
        score += 3;
        descMatched = true;
      } else if (!score) return -1;
    }
    const roomKnown = room.exits.length > 0 || room.title !== undefined || room.descKeys.length > 0;
    if (roomKnown) {
      if (sameExitSet(room.exits, obs.exits)) score += 1;
      // Same title but different exits is a different room ("Swamp (n, s)" vs "Swamp (nw, se)")
      // unless the description proves otherwise or the room is known to have doors.
      else if (!descMatched && !room.tags.includes("dynamic-exits")) return -1;
    }
    return score;
  }

  /** `title` is this room's game title or one of the names it is also known by. */
  titleMatches(room: MapRoom, title: string): boolean {
    return room.title === title || !!room.titleAliases?.includes(title);
  }

  private descriptionMatches(room: MapRoom, description: string): boolean {
    const norm = normalizeDescription(description);
    const key = norm.slice(-DESC_KEY_LEN);
    if (room.descKeys.some((stored) => this.descKeyMatches(stored, norm, key))) return true;
    // A display with a glued-on first line or a cut-off last line is still this room.
    return !!room.description && descriptionCoresOverlap(norm, normalizeDescription(room.description));
  }

  /** Both rooms carry verbose text and it is the same prose (exact key or matching core). */
  descriptionsAgree(a: MapRoom, b: MapRoom): boolean {
    if (!a.descKeys.length || !b.descKeys.length) return false;
    if (a.descKeys.some((k) => b.descKeys.includes(k))) return true;
    if (b.description && this.descriptionMatches(a, b.description)) return true;
    return !!a.description && this.descriptionMatches(b, a.description);
  }

  /**
   * Rooms the description index points at for `norm`. Falls back to a scan for rooms whose
   * stored prose shares the core of this one when no suffix key matches (cut-off displays).
   */
  private descriptionCandidateIds(norm: string, key: string): Set<string> {
    const ids = new Set(this.byDesc.get(key) ?? []);
    const exactMiss = ids.size === 0;
    for (const [k, set] of this.byDesc) {
      if (k === key) continue;
      const extra = DOOR_STATE_IN_KEY.test(k) || (exactMiss && k.length < DESC_KEY_LEN);
      if (!extra || !this.descKeyMatches(k, norm, key)) continue;
      for (const id of set) ids.add(id);
    }
    if (ids.size === 0 && norm.length >= CORE_MIN_LEN) {
      for (const r of this.rooms()) {
        if (r.description && descriptionCoresOverlap(norm, normalizeDescription(r.description))) ids.add(r.id);
      }
    }
    return ids;
  }

  /**
   * `stored` is a suffix key. Door state used to be part of that suffix, so an older key
   * still matches once `( opened|closed|locked )` is stripped.
   */
  private descKeyMatches(stored: string, norm: string, key: string): boolean {
    if (stored === key) return true;
    const doorish = DOOR_STATE_IN_KEY.test(stored);
    const nk = doorish ? normalizeDescription(stored) : stored;
    if (nk === key) return true;
    if (stored.length < DESC_KEY_LEN && norm.endsWith(stored)) return true;
    return doorish && nk.length >= 40 && norm.endsWith(nk);
  }

  /** Global lookup by description (strong) or a title that exists exactly once (weak). */
  findByObservation(obs: RoomObservation, opts?: { allowTitle?: boolean }): ObservationMatch {
    if (obs.mode === "dark") return { room: null, candidates: 0 };
    if (obs.description) {
      const norm = normalizeDescription(obs.description);
      const key = norm.slice(-DESC_KEY_LEN);
      const ids = this.descriptionCandidateIds(norm, key);
      const matches = [...ids]
        .map((id) => this.doc.rooms[id]!)
        .filter((r) => r && this.compatibility(r, obs) > 0);
      const sharedDesc = this.roomIdsMatchingDescription(obs);
      // Same prose in several rooms (uniform swamp, corridor tiles): never treat description
      // lookup as unique just because title/exits filtered compatibility down to one.
      if (sharedDesc.length >= 2) {
        // Look-alike fragments minted after a tripped batch (r731/r3379, r2980/r3584) must not
        // hide the one well-wired original forever: pin to it when the rest are thin copies.
        const est = this.soleEstablished(sharedDesc);
        if (est && this.compatibility(est, obs) > 0) return { room: est, candidates: 1 };
        return { room: null, candidates: Math.max(matches.length, sharedDesc.length) };
      }
      return { room: matches.length === 1 ? matches[0]! : null, candidates: matches.length };
    }
    if (obs.title && opts?.allowTitle !== false) {
      const titled = this.roomsWithTitle(obs.title);
      const matches = titled.filter((r) => this.compatibility(r, obs) > 0);
      // A title shared by several rooms (e.g. "Swamp") is never trusted for global lookup.
      if (titled.length === 1 && matches.length === 1) return { room: matches[0]!, candidates: 1 };
      return { room: null, candidates: matches.length };
    }
    return { room: null, candidates: 0 };
  }

  /**
   * Of rooms sharing one prose, the single well-wired original (2+ confirmed exits) when every
   * other is a thin look-alike fragment (at most 1 confirmed exit, fewer visits); else null.
   * Genuine twins and uniform tiles are each wired, so they never qualify.
   */
  soleEstablished(ids: string[]): MapRoom | null {
    const rooms = ids.map((id) => this.doc.rooms[id]).filter((r): r is MapRoom => !!r);
    const confirmed = (r: MapRoom) => Object.values(r.links).filter((l) => l?.confirmed).length;
    const strong = rooms.filter((r) => confirmed(r) >= 2);
    if (strong.length !== 1) return null;
    const s = strong[0]!;
    return rooms.every((r) => r === s || (confirmed(r) <= 1 && r.visits < s.visits)) ? s : null;
  }

  /** Known rooms whose verbose text matches `obs` (ignores title and exits). */
  roomIdsMatchingDescription(obs: RoomObservation): string[] {
    if (obs.mode === "dark" || !obs.description) return [];
    const norm = normalizeDescription(obs.description);
    const key = norm.slice(-DESC_KEY_LEN);
    const ids = this.descriptionCandidateIds(norm, key);
    return [...ids].filter((id) => {
      const r = this.doc.rooms[id];
      return r && this.descriptionMatches(r, obs.description!);
    });
  }

  applyObservation(stale: MapRoom, obs: RoomObservation): void {
    // Callers may hold a room that a merge has since folded into another one.
    const room = this.room(stale.id);
    if (!room) return;
    this.unindexRoom(room);
    const at = nowIso();
    if (obs.mode === "dark") {
      if (!room.title && room.descKeys.length === 0) room.dark = true;
    } else {
      room.dark = undefined;
      if (obs.title) room.title = obs.title;
      if (obs.description) {
        const cleaned = this.scrubLeakedLines(cleanseRoomDescription(obs.description.trim()), room.id, obs);
        if (cleaned) {
          const key = descKey(cleaned);
          const normCleaned = normalizeDescription(cleaned);
          // Only an exact key counts here: a core-only match still indexes this variant.
          const matched = room.descKeys.some((k) => this.descKeyMatches(k, normCleaned, key));
          if (!room.descKeys.includes(key) && (!matched || key.length < DESC_KEY_LEN || room.descKeys.some((k) => DOOR_STATE_IN_KEY.test(k)))) {
            room.descKeys.push(key);
            while (room.descKeys.length > 6) room.descKeys.shift();
          }
          room.description = preferDescription(room.description, cleaned, (d) => this.descriptionMatches(room, d));
        }
      }
      room.exits = [...obs.exits];
      if (obs.doors?.length) this.syncDoors(room, obs.doors);
      else if (obs.mode === "brief" && room.doors?.length) {
        this.syncDoors(
          room,
          room.doors.map((d) =>
            d.state === "locked" ? d : { ...d, state: obs.exits.includes(d.direction) ? "open" : "closed" },
          ),
        );
      }
      for (const c of obs.contents) {
        // Players walk around; they are not room metadata (and `/to <player>` should not route).
        if (c.kind === "player") continue;
        const path = c.path?.replace(/#\d+$/, "");
        const key = path ?? c.name;
        const prev = room.contents[key];
        const stored: StoredContent = {
          name: c.name,
          kind: c.kind,
          path,
          lastCount: c.count,
          seenCount: (prev?.seenCount ?? 0) + 1,
          lastSeenAt: at,
          ...(c.hidden ? { hidden: true } : {}),
        };
        room.contents[key] = stored;
      }
      if (obs.mode === "verbose") {
        const pileSeen = obs.contents.some((c) => /pile of coins/i.test(c.name));
        if (!pileSeen) {
          for (const [key, c] of Object.entries(room.contents)) {
            if (/pile of coins/i.test(c.name)) delete room.contents[key];
          }
        }
      }
      syncRoomNpcs(room);
    }
    room.visits += 1;
    room.lastSeenAt = at;
    this.indexRoom(room);
    this.touch();
  }

  /** Drop a grind NPC hint from map contents (bot confirmed absent). */
  forgetRoomGrindMob(roomId: string, mobName: string): boolean {
    const room = this.room(roomId);
    if (!room) return false;
    const needle = mobName.trim().toLowerCase();
    if (!needle) return false;
    let changed = false;
    this.unindexRoom(room);
    for (const [key, c] of Object.entries(room.contents ?? {})) {
      const n = c.name?.trim().toLowerCase() ?? "";
      if (n === needle || key.toLowerCase() === needle) {
        delete room.contents[key];
        changed = true;
      }
    }
    if (room.npcs?.length) {
      const next = room.npcs.filter((n) => n.trim().toLowerCase() !== needle);
      if (next.length !== room.npcs.length) {
        room.npcs = next;
        changed = true;
      }
    }
    if (changed) {
      syncRoomNpcs(room);
      this.indexRoom(room);
      this.touch();
    }
    return changed;
  }

  /** Record door state. Closed doors keep their direction and require `open door` first. */
  applyDoors(stale: MapRoom, doors: RoomDoor[]): void {
    const room = this.room(stale.id);
    if (!room || !doors.length) return;
    this.unindexRoom(room);
    this.syncDoors(room, doors);
    this.indexRoom(room);
    this.touch();
  }

  private syncDoors(room: MapRoom, doors: RoomDoor[]): void {
    if (!doors.length) return;
    if (!room.tags.includes("dynamic-exits")) room.tags.push("dynamic-exits");
    room.doors = doors.map((d) => ({ ...d }));
    if (room.description) room.description = descriptionWithDoorStates(room.description, room.doors);
    for (const door of room.doors) {
      const dir = door.direction;
      if (door.state === "locked") {
        room.exits = room.exits.filter((e) => e !== dir);
        let link = room.links[dir];
        if (!link) {
          link = room.links[dir] = {
            to: null,
            kind: exitKindFor(dir, room.exits),
            confirmed: false,
            uses: 0,
          };
        }
        if (link.pre?.length === 1 && link.pre[0] === OPEN_DOOR_COMMAND) delete link.pre;
        link.blocked = { reason: "locked", at: nowIso() };
        continue;
      }
      if (!room.exits.includes(dir)) room.exits.push(dir);
      let link = room.links[dir];
      if (!link && door.state === "closed") {
        link = room.links[dir] = {
          to: null,
          kind: exitKindFor(dir, room.exits),
          confirmed: false,
          uses: 0,
        };
      }
      if (!link) continue;
      if (link.blocked?.reason === "locked") delete link.blocked;
      if (door.state === "closed") {
        if (!link.pre?.length || (link.pre.length === 1 && link.pre[0] === OPEN_DOOR_COMMAND)) {
          link.pre = [OPEN_DOOR_COMMAND];
        }
      } else if (link.pre?.length === 1 && link.pre[0] === OPEN_DOOR_COMMAND) {
        delete link.pre;
      }
    }
  }

  link(
    fromId: string,
    cmd: string,
    toId: string | null,
    opts: { kind: ExitKind; confirmed: boolean; hidden?: boolean },
  ): MapLink {
    const from = this.room(fromId)!;
    if (toId) toId = this.canonicalId(toId) ?? toId;
    this.unindexRoom(from);
    const prev = from.links[cmd];
    const keepPrev = prev && prev.confirmed && !opts.confirmed && prev.to;
    // Re-pointed at another room: what was learned about the old destination does not carry over.
    const retarget = !!prev?.to && !!toId && this.canonicalId(prev.to) !== toId;
    const link: MapLink = keepPrev
      ? prev
      : {
          ...prev,
          to: toId,
          kind: opts.kind,
          hidden: opts.hidden || undefined,
          confirmed: opts.confirmed || (prev?.confirmed === true && prev.to === toId),
          uses: retarget ? 0 : (prev?.uses ?? 0),
          blocked: undefined,
        };
    if (!keepPrev && retarget) {
      delete link.contested;
      delete link.verified;
      delete link.failCount;
    }
    if (opts.confirmed) {
      link.uses += 1;
      link.lastUsedAt = nowIso();
      // A traversal that landed clears the consecutive-failure streak. `blocked` is already
      // dropped above; expiry of an older block is otherwise unchanged.
      if (link.failCount) link.failCount = 0;
    }
    from.links[cmd] = link;
    this.indexRoom(from);
    this.touch();
    return link;
  }

  /**
   * Record a ride (`MapLink.transit`) from `fromId` by `cmd` to `toId`. Teleport-kind (never
   * part of the layout), hidden, costed by the voyage time so paths prefer walking.
   */
  linkTransit(fromId: string, cmd: string, toId: string, transit: MapTransit): MapLink {
    const link = this.link(fromId, cmd, toId, { kind: "teleport", confirmed: true, hidden: true });
    const prev = link.transit;
    link.transit = { ...prev, ...transit, seconds: transit.seconds ?? prev?.seconds };
    if (!link.transit.seconds) delete link.transit.seconds;
    link.weight = Math.max(TRANSIT_MIN_WEIGHT, Math.round((link.transit.seconds ?? 0) / 10));
    const how = transit.howTo ? `: ${transit.howTo}` : "";
    link.note = `${transit.label}${transit.place ? ` to ${transit.place}` : ""}${how}`;
    this.touch();
    return link;
  }

  unlink(fromId: string, cmd: string): boolean {
    const from = this.doc.rooms[fromId];
    if (!from?.links[cmd]) return false;
    this.unindexRoom(from);
    delete from.links[cmd];
    this.indexRoom(from);
    this.touch();
    return true;
  }

  /** A move along `cmd` was eaten without moving (tripped); see `MapLink.hindered`. */
  recordHindrance(fromId: string, cmd: string): boolean {
    const link = this.doc.rooms[fromId]?.links[cmd];
    if (!link?.to) return false;
    link.hindered = (link.hindered ?? 0) + 1;
    this.touch();
    return true;
  }

  markBlocked(fromId: string, cmd: string, reason: string): void {
    const from = this.doc.rooms[fromId];
    if (!from) return;
    const link = from.links[cmd];
    if (link) link.blocked = { reason, at: nowIso() };
    else {
      from.links[cmd] = {
        to: null,
        kind: exitKindFor(cmd, from.exits),
        confirmed: false,
        uses: 0,
        blocked: { reason, at: nowIso() },
      };
    }
    this.touch();
  }

  /**
   * One failed move on `cmd` (`did not move`, `in your way`, `You cannot go that direction`, …).
   * Increments the consecutive-failure counter. Sets `blocked` only at
   * {@link BLOCK_AFTER_CONSECUTIVE_FAILS}. A live block is left alone so its expiry does not move.
   */
  noteConsecutiveFailure(fromId: string, cmd: string, reason: string): { failures: number; blocked: boolean } {
    const from = this.doc.rooms[fromId];
    if (!from) return { failures: 0, blocked: false };
    const tracked = from.exits.includes(cmd) || !!from.links[cmd]?.to || !!from.links[cmd];
    if (!tracked) return { failures: 0, blocked: false };
    let link = from.links[cmd];
    if (!link) {
      link = from.links[cmd] = {
        to: null,
        kind: exitKindFor(cmd, from.exits),
        confirmed: false,
        uses: 0,
      };
    }
    link.failCount = (link.failCount ?? 0) + 1;
    const failures = link.failCount;
    const blockFresh = !!link.blocked && Date.now() - Date.parse(link.blocked.at) < BLOCK_TTL_MS;
    if (failures >= BLOCK_AFTER_CONSECUTIVE_FAILS && !blockFresh) this.markBlocked(fromId, cmd, reason);
    else this.touch();
    const nowBlocked = !!link.blocked && Date.now() - Date.parse(link.blocked.at) < BLOCK_TTL_MS;
    return { failures, blocked: nowBlocked };
  }

  /** A successful traversal of `cmd`: the consecutive-failure streak ends. */
  clearConsecutiveFailures(fromId: string, cmd: string): void {
    const link = this.doc.rooms[fromId]?.links[cmd];
    if (!link?.failCount) return;
    link.failCount = 0;
    this.touch();
  }

  /**
   * Record a failed navigation on `cmd` from `fromId`. The link stays on the path until
   * {@link BLOCK_AFTER_CONSECUTIVE_FAILS} consecutive failures. After {@link NAV_FAILURES_BEFORE_HEAL}
   * failures the link is removed and duplicate/orphan destinations are merged or deleted.
   */
  recordNavigationFailure(fromId: string, cmd: string, reason: string): NavFailureResult {
    const from = this.doc.rooms[fromId];
    if (!from) return { failures: 0, healed: false };
    const tracked = from.exits.includes(cmd) || !!from.links[cmd]?.to;
    if (!tracked) return { failures: 0, healed: false };

    const noted = this.noteConsecutiveFailure(fromId, cmd, reason);
    const failures = noted.failures;

    // The game flatly refused, again and again, a compass move the room does not even list:
    // the link is a mapping error, not a flaky exit — drop it instead of waiting for 20.
    const refusedUnlisted =
      failures >= UNLISTED_REFUSALS_BEFORE_HEAL &&
      isGeometricDirection(cmd) &&
      from.exits.length > 0 &&
      !from.exits.includes(cmd) &&
      UNLISTED_REFUSAL_RE.test(reason);
    if (refusedUnlisted || failures >= NAV_FAILURES_BEFORE_HEAL) {
      const detail = this.healBrokenLink(fromId, cmd) ?? undefined;
      return { failures, healed: true, detail };
    }
    return { failures, healed: false };
  }

  /** Drop a bad link and collapse a duplicate or orphan destination room when safe. */
  private healBrokenLink(fromId: string, cmd: string): string | null {
    const from = this.room(fromId);
    if (!from) return null;
    const toId = from.links[cmd]?.to ?? null;
    this.unlink(fromId, cmd);
    if (!toId) return `removed link ${fromId}:${cmd}`;
    const to = this.room(toId);
    if (!to) return `removed link ${fromId}:${cmd}`;

    const duplicate =
      from.id !== toId &&
      (this.signaturesAgree(from, to) ||
        (from.descKeys.length > 0 &&
          to.descKeys.some((k) => from.descKeys.includes(k)) &&
          sameExitSet(from.exits, to.exits)));
    if (duplicate) {
      this.mergeRooms(fromId, toId);
      return `merged ${toId} into ${fromId}`;
    }
    // Only throw away a throwaway: a room walked many times or carrying notes / tags / meta / contents
    // (Dante's shop r6, 1478 visits, was deleted 2026-11 after its door link failed) stays, just unlinked.
    const kept = to.visits > 1 || to.tags.length > 0 || to.notes.length > 0 || Object.keys(to.meta ?? {}).length > 0 || Object.keys(to.contents ?? {}).length > 0;
    if (this.incomingRooms(toId).length === 0 && !kept) {
      this.deleteRoom(toId);
      return `deleted orphan ${toId}`;
    }
    return `removed link ${fromId}:${cmd} → ${toId}`;
  }

  setPos(room: MapRoom, pos: MapPos): void {
    this.unindexRoom(room);
    room.pos = { ...pos };
    this.indexRoom(room);
    this.touch();
  }

  /** Move many rooms by the same delta (optional plane change). Used to de-overlap layout regions. */
  shiftRooms(ids: Iterable<string>, delta: Vec3, opts: { plane?: string } = {}): number {
    let n = 0;
    for (const id of ids) {
      const room = this.room(id);
      if (!room) continue;
      const p: MapPos = { ...addVec(room.pos, delta), plane: opts.plane ?? room.pos.plane };
      this.setPos(room, p);
      n += 1;
    }
    return n;
  }

  /** Translate every room on `drop` by `offset` onto `keep` and delete `drop`. */
  /** Rooms of `drop`, shifted by `offset`, that would land on a different room of `keep`. */
  planeMergeCollisions(keep: string, drop: string, offset: Vec3): number {
    if (keep === drop) return 0;
    const cells = new Map<string, MapRoom[]>();
    for (const r of this.rooms()) {
      if (r.pos.plane !== keep) continue;
      const k = `${r.pos.x},${r.pos.y},${r.pos.z}`;
      const list = cells.get(k);
      if (list) list.push(r);
      else cells.set(k, [r]);
    }
    let n = 0;
    for (const r of this.rooms()) {
      if (r.pos.plane !== drop) continue;
      const p = addVec(r.pos, offset);
      const there = cells.get(`${p.x},${p.y},${p.z}`);
      if (there?.length && !there.some((o) => o.id === r.id || this.samePlace(o, r))) n++;
    }
    return n;
  }

  mergePlanes(keep: string, drop: string, offset: Vec3): void {
    if (keep === drop) return;
    for (const room of this.rooms()) {
      if (room.pos.plane !== drop) continue;
      const p = addVec(room.pos, offset);
      this.setPos(room, { plane: keep, x: p.x, y: p.y, z: p.z });
    }
    for (const plane of Object.values(this.doc.planes)) {
      if (plane.parent?.plane === drop) plane.parent.plane = keep;
    }
    const dropped = this.doc.planes[drop];
    const kept = this.doc.planes[keep];
    if (kept && dropped?.kind === "surface") kept.kind = "surface";
    if (kept && dropped) {
      kept.label ??= dropped.label;
      kept.continent ??= dropped.continent;
    }
    delete this.doc.planes[drop];
    this.touch();
  }

  /** Position the destination of a compass move from `from` should occupy. */
  expectedPos(from: MapRoom, cmd: string): MapPos | null {
    const v = DIRECTION_VECTORS[cmd];
    if (!v) return null;
    const p = addVec(from.pos, v);
    return { plane: from.pos.plane, ...p };
  }

  /**
   * Connect `from --cmd--> to`, merging planes when a compass link joins two layouts.
   * Returns true when planes were merged.
   */
  connect(from: MapRoom, cmd: string, to: MapRoom, opts: { confirmed: boolean; hidden?: boolean }): boolean {
    const kind = exitKindFor(cmd, from.exits);
    this.link(from.id, cmd, to.id, { kind, confirmed: opts.confirmed, hidden: opts.hidden });
    if (!from.pos?.plane || !to.pos?.plane) return false;
    if (!isGeometricDirection(cmd) || from.pos.plane === to.pos.plane) return false;
    if (this.continentOf(from.pos.plane) !== this.continentOf(to.pos.plane)) return false;
    const expected = this.expectedPos(from, cmd);
    if (!expected) return false;
    const offset = subVec(expected, to.pos);
    // Overlaying the two layouts would stack different rooms on one cell (a wrapping desert
    // around a city, a maze): keep the link but leave the planes apart.
    if (this.planeMergeCollisions(from.pos.plane, to.pos.plane, offset) > 0) return false;
    // Keep a continent's plane, then a named one ("p-merevia" is not a number: NaN made the
    // live hub fold Merevia into p222), then the older plane id so references stay stable.
    const rank = (id: string) => {
      if (this.doc.planes[id]?.continent) return -2;
      const n = Number(id.slice(1));
      return Number.isFinite(n) ? n : -1;
    };
    const fromN = rank(from.pos.plane);
    const toN = rank(to.pos.plane);
    if (fromN <= toN) this.mergePlanes(from.pos.plane, to.pos.plane, offset);
    else this.mergePlanes(to.pos.plane, from.pos.plane, { x: -offset.x, y: -offset.y, z: -offset.z });
    return true;
  }

  /** Inferred reverse compass link when the destination lists it, or the step matches the grid. */
  inferReverse(from: MapRoom, cmd: string, to: MapRoom): void {
    const rev = reverseDirection(cmd);
    if (!rev || !isGeometricDirection(rev)) return;
    if (!to.exits.includes(rev) && !this.geometryAgrees(from, cmd, to.id)) return;
    const existing = to.links[rev];
    if (existing?.to) return;
    if (!to.exits.includes(rev) && this.namedWayBack(to, from.id)) return;
    this.link(to.id, rev, from.id, { kind: exitKindFor(rev, to.exits), confirmed: false });
  }

  /**
   * `room` already has a confirmed non-compass command (`down the manhole`, `enter shack`) to
   * `toId`: that is the way back, so an unlisted compass reverse is only a guess that walks would
   * trip over ("You cannot go that direction") — don't infer one.
   */
  private namedWayBack(room: MapRoom, toId: string): boolean {
    const target = this.canonicalId(toId);
    return Object.entries(room.links).some(
      ([c, l]) => !!l?.to && l.confirmed && !isGeometricDirection(c) && this.canonicalId(l.to) === target,
    );
  }

  /** `cmd` from `room` lands on `toId` (same plane and the compass offset). */
  private geometryAgrees(room: MapRoom, cmd: string, toId: string): boolean {
    if (!isGeometricDirection(cmd)) return false;
    const dest = this.room(toId);
    const expected = dest && this.expectedPos(room, cmd);
    if (!dest || !expected) return false;
    return (
      dest.pos.plane === expected.plane &&
      dest.pos.x === expected.x &&
      dest.pos.y === expected.y &&
      dest.pos.z === expected.z
    );
  }

  /**
   * Neither end lists this compass step: `room` does not list `cmd` and the destination, with a
   * known exit list, does not list the way back (nor has a named command back, like a manhole's
   * `grab the handle`). A real unlisted door is missing from one list, not both. Such links come
   * from a display credited to the previous command, and the layout they built "agrees" with
   * them, so geometry is no defence.
   */
  private bothEndsDeny(room: MapRoom, cmd: string, toId: string, opts: { listed?: boolean } = {}): boolean {
    const rev = reverseDirection(cmd);
    const dest = this.room(toId);
    if (!rev || !isGeometricDirection(cmd) || !dest || dest.id === room.id) return false;
    // `listed`: only the destination's side is checked (the room lists `cmd`).
    if (!opts.listed && room.exits.includes(cmd)) return false;
    if (dest.dark || !dest.exits.length || dest.tags.includes("dynamic-exits")) return false;
    return !dest.exits.includes(rev) && !this.namedWayBack(dest, room.id);
  }

  /**
   * A link neither end lists still records that the two rooms are neighbors: the display was
   * credited to the command before (or after) the one that made it. When exactly one exit
   * `room` does list fits — the destination lists its reverse, and neither end already uses
   * those slots for another room — the link moves there (inferred until walked). If that
   * exit already leads to the destination, or to a copy of it, the stray link just goes.
   * Returns false when no single exit fits (the caller drops or demotes the link). `freeOnly`: the
   * room's slot must be unused; `strict`: the destination's too (no inferred link in the way).
   */
  private rekeyMisattributed(
    room: MapRoom,
    cmd: string,
    toId: string,
    copies: Map<string, string>,
    opts: { freeOnly?: boolean; strict?: boolean } = {},
  ): boolean {
    const dest = this.room(toId);
    if (!dest) return false;
    const sameAs = (id: string | null | undefined, want: MapRoom) => {
      const c = id ? this.canonicalId(id) : undefined;
      return !!c && (c === want.id || (copies.has(c) && copies.get(c) === copies.get(want.id)));
    };
    const fits: { exit: string; present: boolean }[] = [];
    for (const x of room.exits) {
      const rev = reverseDirection(x);
      if (x === cmd || !rev || !isGeometricDirection(x) || !dest.exits.includes(rev)) continue;
      const back = dest.links[rev];
      if (back?.to && (back.confirmed || opts.strict) && !sameAs(back.to, room)) continue;
      const here = room.links[x];
      if (opts.freeOnly && here?.to && !sameAs(here.to, dest)) continue;
      if (here?.to && sameAs(here.to, dest)) fits.push({ exit: x, present: true });
      else if (!here?.to || !here.confirmed) fits.push({ exit: x, present: false });
    }
    if (fits.length !== 1) return false;
    const { exit, present } = fits[0]!;
    const link = room.links[cmd]!;
    this.unlink(room.id, cmd);
    if (!present) {
      this.unindexRoom(room);
      room.links[exit] = { ...link, to: dest.id, kind: exitKindFor(exit, room.exits), confirmed: false, hidden: undefined };
      this.indexRoom(room);
      const rev = reverseDirection(exit)!;
      if (!dest.links[rev]?.to) this.link(dest.id, rev, room.id, { kind: exitKindFor(rev, dest.exits), confirmed: false });
      this.touch();
    }
    return true;
  }

  /** The other end of `cmd` has a link on the reverse direction back to `room`. */
  private backPointsHere(room: MapRoom, cmd: string, toId: string): boolean {
    const rev = reverseDirection(cmd);
    if (!rev) return false;
    const back = this.room(toId)?.links[rev];
    return !!back?.to && this.canonicalId(back.to) === room.id;
  }

  /** Merge `dropId` into `keepId` (agent-driven dedupe). Links are re-pointed. */
  mergeRooms(keepId: string, dropId: string, depth = 0): boolean {
    const keep = this.doc.rooms[keepId];
    const drop = this.doc.rooms[dropId];
    if (!keep || !drop || keepId === dropId) return false;
    // Exits are deterministic: if both copies were confirmed to lead the same compass way to
    // different rooms, those destinations are duplicates too (merged after this one).
    const cascade: [string, string][] = [];
    for (const [cmd, link] of Object.entries(drop.links)) {
      const k = keep.links[cmd];
      if (!isGeometricDirection(cmd) || !k?.to || !link.to || !k.confirmed || !link.confirmed) continue;
      if (k.to !== link.to && k.to !== dropId && link.to !== keepId) cascade.push([k.to, link.to]);
    }
    for (const r of this.incomingRooms(dropId)) {
      this.unindexRoom(r);
      for (const link of Object.values(r.links)) if (link.to === dropId) link.to = keepId;
      this.indexRoom(r);
    }
    this.unindexRoom(keep);
    this.unindexRoom(drop);
    for (const [cmd, link] of Object.entries(drop.links)) {
      const kept = keep.links[cmd];
      if (!kept || (!kept.confirmed && link.confirmed)) {
        if (!link.pre?.length && kept?.pre?.length) link.pre = [...kept.pre];
        keep.links[cmd] = link;
      } else if (!kept.pre?.length && link.pre?.length) {
        kept.pre = [...link.pre];
      }
    }
    keep.exits = [...new Set([...keep.exits, ...drop.exits])];
    if (drop.doors?.length) {
      const byDir = new Map((keep.doors ?? []).map((d) => [d.direction, { ...d }]));
      for (const d of drop.doors) if (!byDir.has(d.direction)) byDir.set(d.direction, { ...d });
      keep.doors = [...byDir.values()];
    }
    const names = new Set([...(keep.titleAliases ?? []), ...(drop.titleAliases ?? [])]);
    if (keep.title && drop.title && keep.title !== drop.title) names.add(drop.title);
    keep.title ??= drop.title;
    if (keep.title) names.delete(keep.title);
    if (names.size) keep.titleAliases = [...names];
    keep.description = mergedDescription(keep.description, drop.description);
    keep.descKeys = [...new Set([...keep.descKeys, ...drop.descKeys])];
    keep.tags = [...new Set([...keep.tags, ...drop.tags])];
    keep.notes = [...new Set([...keep.notes, ...drop.notes])];
    keep.meta = { ...drop.meta, ...keep.meta };
    keep.contents = { ...drop.contents, ...keep.contents };
    syncRoomNpcs(keep);
    keep.visits += drop.visits;
    if (drop.firstSeenAt < keep.firstSeenAt) keep.firstSeenAt = drop.firstSeenAt;
    delete this.doc.rooms[dropId];
    remapWaypointRoomIds(this.doc, dropId, keepId);
    const redirects = (this.doc.redirects ??= {});
    redirects[dropId] = keepId;
    delete redirects[keepId];
    for (const [from, to] of Object.entries(redirects)) if (to === dropId) redirects[from] = keepId;
    this.indexRoom(keep);
    this.touch();
    if (depth < 64) {
      for (const [a, b] of cascade) {
        const ra = this.room(a);
        const rb = this.room(b);
        if (ra && rb && ra.id !== rb.id && this.signaturesAgree(ra, rb)) this.mergeRooms(ra.id, rb.id, depth + 1);
      }
    }
    return true;
  }

  /**
   * Merge duplicate rooms until fixpoint. Two rooms are the same place when their
   * signatures (title, exits, description) agree and they lead the same way to the same
   * room. Uniform corridors/grids never share a neighbor in the same direction, so they
   * survive; duplicate chains created while lost collapse back onto the established rooms.
   * Returns the number of rooms merged away.
   */
  consolidate(): number {
    let merged = 0;
    for (let pass = 0; pass < 50; pass++) {
      const groups = new Map<string, MapRoom[]>();
      for (const room of this.rooms()) {
        if (room.dark || (!room.title && room.descKeys.length === 0)) continue;
        const sig = `${room.title ?? ""}|${[...room.exits].sort().join(",")}`;
        let g = groups.get(sig);
        if (!g) groups.set(sig, (g = []));
        g.push(room);
      }
      let changed = 0;
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const byNeighbor = new Map<string, MapRoom>();
        for (const room of group) {
          if (!this.doc.rooms[room.id]) continue;
          for (const [cmd, link] of Object.entries(room.links)) {
            if (!link.to || !link.confirmed || link.kind === "teleport") continue;
            const key = `${cmd}>${this.canonicalId(link.to)}`;
            const other = byNeighbor.get(key);
            if (!other || other.id === room.id || !this.doc.rooms[other.id]) {
              byNeighbor.set(key, room);
              continue;
            }
            if (!this.signaturesAgree(other, room)) continue;
            const [keep, drop] = Number(other.id.slice(1)) < Number(room.id.slice(1)) ? [other, room] : [room, other];
            if (keep.pos.plane !== drop.pos.plane) {
              this.mergePlanes(keep.pos.plane, drop.pos.plane, subVec(keep.pos, drop.pos));
            }
            this.mergeRooms(keep.id, drop.id);
            byNeighbor.set(key, keep);
            changed += 1;
            break;
          }
        }
      }
      merged += changed;
      if (changed === 0) break;
    }
    return merged;
  }

  /**
   * Self-healing pass, safe to run any time: merge duplicates, drop links the rooms' own
   * exit lists rule out, remove rooms that should not exist, join adjacent rooms (including
   * when one exit list omitted the way back), reciprocate one-way compass links, and forget
   * empty planes. `protect` rooms are never removed.
   */
  heal(opts: { protect?: (string | null | undefined)[] } = {}): HealReport {
    const protect = new Set(opts.protect?.map((id) => this.canonicalId(id)).filter((id): id is string => !!id));
    const report: HealReport = {
      merged: 0,
      linksPruned: 0,
      linksStitched: 0,
      roomsRemoved: 0,
      planesRemoved: 0,
      areasInferred: 0,
      descriptionsCleaned: 0,
    };
    report.descriptionsCleaned += this.cleanseStoredDescriptions();
    this.noiseCtx = null;
    report.leakedLinesScrubbed = this.scrubStoredLeakedLines();
    report.descriptionsCleaned += report.leakedLinesScrubbed;
    report.prefixesStripped = this.stripKnownPrefixes();
    report.descriptionsCleaned += report.prefixesStripped;
    report.planesRegistered = this.registerMissingPlanes();
    report.linksPruned += this.pruneTeleportOnlyLinks();
    report.redundantSpecials = this.pruneRedundantSpecials();
    report.linksPruned += report.redundantSpecials;
    // Misattributed links first: they would otherwise "prove" wrong merges below.
    report.linksPruned += this.pruneLinks();
    report.merged += this.mergeDoorCopies();
    report.merged += this.consolidate();
    report.conflictsResolved = this.resolveIdentityConflicts();
    report.merged += report.conflictsResolved;
    report.chainsMerged = this.mergeDuplicateChains();
    report.merged += report.chainsMerged;
    report.linksPruned += this.pruneLinks();
    report.roomsRemoved += this.removeGhosts(protect);
    report.merged += this.consolidate();
    report.lookalikesFolded = this.foldThinLookalikes();
    report.merged += report.lookalikesFolded;
    report.linksStitched += this.stitchExits();
    report.planesRemoved += this.dropEmptyPlanes();
    report.redirectsPruned = this.pruneRedirects();
    for (const room of this.rooms()) syncRoomNpcs(room);
    report.areasInferred = propagateAreas(this);
    return report;
  }

  /** Map-wide evidence for {@link scrubDescription}, cached (about 50 ms to build on 4k rooms). */
  noiseContext(): NoiseContext {
    if (!this.noiseCtx || this.noiseCtxAge >= 250) {
      this.noiseCtx = buildNoiseContext(this.doc);
      this.noiseCtxAge = 0;
    }
    return this.noiseCtx;
  }

  /**
   * Drop edge lines that are game output, judged by shape plus map evidence (see
   * descriptionIntegrity.ts): the denylist in cleanseRoomDescription only knows lines it has seen.
   */
  private scrubLeakedLines(text: string | undefined, roomId: string, obs?: RoomObservation): string | undefined {
    if (!text) return text;
    const ctx = this.noiseContext();
    this.noiseCtxAge += 1;
    // Mobs in this very display count even before they are stored.
    for (const c of obs?.contents ?? []) if (c.kind === "npc" && c.name.length >= 3) ctx.actors.add(c.name.toLowerCase());
    return scrubDescription(text, ctx, { roomId }).text || text;
  }

  /** heal(): scrub leaked edge lines from stored descriptions. */
  private scrubStoredLeakedLines(): number {
    let n = 0;
    const ctx = this.noiseContext();
    for (const room of this.rooms()) {
      if (!room.description) continue;
      const res = scrubDescription(room.description, ctx, { roomId: room.id });
      if (!res.removed.length || !res.text) continue;
      this.setDescription(room, res.text);
      n += 1;
    }
    if (n) this.noiseCtx = null;
    return n;
  }

  /** Strip leaked game output from stored verbose descriptions and refresh desc index keys. */
  private cleanseStoredDescriptions(): number {
    return this.cleanseDescriptions().cleaned.length;
  }

  /**
   * Description-only scrub (no merges): strip leaked prompt/chat/combat/travel lines from stored
   * descriptions and rebuild their desc keys. A description that would be all junk is left as is
   * and reported in `allJunk` rather than blanked. `dryRun` reports without changing anything.
   */
  cleanseDescriptions(opts: { dryRun?: boolean } = {}): { cleaned: string[]; allJunk: string[] } {
    const cleanedIds: string[] = [];
    const allJunk: string[] = [];
    for (const room of this.rooms()) {
      if (!room.description) continue;
      const cleaned = cleanseRoomDescription(room.description);
      if (cleaned === room.description) continue;
      if (!cleaned) {
        allJunk.push(room.id);
        continue;
      }
      cleanedIds.push(room.id);
      if (opts.dryRun) continue;
      this.setDescription(room, cleaned);
    }
    return { cleaned: cleanedIds, allJunk };
  }

  /** Public entry for repair tools: replace a stored description and rebuild its desc keys. */
  replaceDescription(room: MapRoom, text: string): void {
    this.setDescription(room, text);
  }

  /** Replace a stored description and keep only the desc keys it still explains. */
  private setDescription(room: MapRoom, text: string): void {
    this.unindexRoom(room);
    room.description = text;
    room.descKeys = room.descKeys.filter((k) => this.descKeyMatches(k, normalizeDescription(text), descKey(text)));
    const key = descKey(text);
    if (!room.descKeys.includes(key)) {
      room.descKeys.push(key);
      while (room.descKeys.length > 6) room.descKeys.shift();
    }
    this.indexRoom(room);
    this.touch();
  }

  /**
   * Leading lines that are not prose, proven by the map itself: a description whose tail is
   * exactly another room's whole description had chatter glued to its top (`The gnoll stares
   * at you.`, an emote no pattern knows). Those lines are learned as noise and also stripped
   * where they lead a description no clean copy exists for.
   */
  stripKnownPrefixes(): number {
    const byNorm = new Map<string, string[]>();
    for (const r of this.rooms()) {
      if (!r.description) continue;
      const n = normalizeDescription(r.description);
      if (n.length < MIN_PREFIX_PROOF_DESC) continue;
      byNorm.set(n, [...(byNorm.get(n) ?? []), r.id]);
    }
    const learned = new Set<string>();
    const fixes = new Map<string, string>();
    for (const r of this.rooms()) {
      const lines = r.description?.split("\n") ?? [];
      for (let i = 1; i <= Math.min(MAX_PREFIX_LINES, lines.length - 1); i++) {
        const head = lines.slice(0, i);
        if (head.some((l) => l.trim().length > 160)) break;
        const rest = lines.slice(i).join("\n").trim();
        if (!(byNorm.get(normalizeDescription(rest)) ?? []).some((id) => id !== r.id)) continue;
        fixes.set(r.id, rest);
        for (const l of head) if (/^\S.{0,99}[.!?]$/.test(l.trim())) learned.add(l.trim());
        break;
      }
    }
    for (const r of this.rooms()) {
      if (fixes.has(r.id) || !r.description) continue;
      const lines = r.description.split("\n");
      let i = 0;
      while (i < Math.min(MAX_PREFIX_LINES, lines.length - 1) && (learned.has(lines[i]!.trim()) || !lines[i]!.trim())) i += 1;
      const rest = lines.slice(i).join("\n").trim();
      if (i > 0 && normalizeDescription(rest).length >= MIN_PREFIX_PROOF_DESC) fixes.set(r.id, rest);
    }
    for (const [id, text] of fixes) this.setDescription(this.doc.rooms[id]!, text);
    return fixes.size;
  }

  /**
   * Thin look-alike fragments minted after a tripped batch (r731/r3379, r2980/r3584) fold into
   * the one well-wired original sharing their prose and exit list (see soleEstablished).
   * Uniform tiles and genuine twins are each wired, so they are never touched.
   */
  private foldThinLookalikes(): number {
    const groups = new Map<string, MapRoom[]>();
    for (const room of this.rooms()) {
      if (!room.description) continue;
      const norm = normalizeDescription(room.description);
      if (norm.length < CHAIN_MERGE_MIN_DESC) continue;
      const key = `${[...room.exits].sort().join(",")}|${norm}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(room);
    }
    let n = 0;
    for (const group of groups.values()) {
      // Rare prose only: a pair, never a field of uniform tiles where some are just unwired.
      if (group.length !== 2) continue;
      const keep = this.soleEstablished(group.map((r) => r.id));
      if (!keep) continue;
      for (const drop of group) {
        if (drop === keep || !this.doc.rooms[drop.id] || !this.doc.rooms[keep.id]) continue;
        // A confirmed exit of the fragment that leads somewhere else than the original's is
        // evidence of a distinct room (look-alike road tiles), not a stray copy.
        const conflicts = Object.entries(drop.links).some(([cmd, link]) => {
          const k = keep.links[cmd];
          return link?.confirmed && k?.to && this.canonicalId(k.to) !== this.canonicalId(link.to);
        });
        if (conflicts) continue;
        if (this.mergeRooms(keep.id, drop.id)) n += 1;
      }
    }
    return n;
  }

  /**
   * Open and closed looks at a door are the same place. Copies stacked on one cell whose
   * descriptions match once the door state is ignored fold together.
   */
  private mergeDoorCopies(): number {
    const groups = new Map<string, MapRoom[]>();
    for (const room of this.rooms()) {
      if (!room.description || !/door leading/i.test(room.description)) continue;
      const norm = normalizeDescription(room.description);
      if (norm.length < 60) continue;
      const key = `${posKey(room.pos)}|${norm}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(room);
    }
    let n = 0;
    for (const group of groups.values()) {
      const alive = group.filter((r) => this.doc.rooms[r.id]);
      if (alive.length < 2) continue;
      alive.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
      const keep = alive[0]!;
      for (const drop of alive.slice(1)) {
        if (!this.doc.rooms[drop.id] || !this.doc.rooms[keep.id]) continue;
        if (this.mergeRooms(keep.id, drop.id)) n += 1;
      }
      const survivor = this.room(keep.id);
      if (!survivor?.description) continue;
      const doors = parseDoors(survivor.description);
      if (doors.length) this.applyDoors(survivor, doors);
    }
    return n;
  }

  /**
   * Drop links for newbie teleports (`homeland`) and similar commands that never represent
   * walkable topology (see `NEVER_PATH_LINKS`).
   */
  private pruneTeleportOnlyLinks(): number {
    let n = 0;
    for (const room of this.rooms()) {
      for (const cmd of Object.keys(room.links)) {
        if (isTeleportOnlyCommand(cmd) && this.unlink(room.id, cmd)) n += 1;
      }
    }
    return n;
  }

  /**
   * Secret exits the mapper learned by itself that only duplicate a better-attested way to the
   * same room. They come from a display credited to the wrong queued command (travel aliases
   * spam `enter crack;climb up;…`, attacks are answered late), and once recorded they reinforce
   * themselves: the stray command now "is" an exit, so the next display is credited to it again.
   *
   * - The room lists an exit that was really walked to that same room: the listed exit is the
   *   game's own word, the secret one goes (r303 `u` and `enter crack`, both → r304).
   * - Several secret commands lead to one room: the most used stays; others with at most a
   *   quarter of its walks go (r312 `climb up` ×124 vs `enter crack` ×3).
   * - A command that is no travel verb at all and was walked at most twice goes when anything
   *   else leads there.
   *
   * Scripted (`pre`), hand-registered and alias-verified links are never touched.
   */
  private pruneRedundantSpecials(): number {
    let n = 0;
    for (const room of this.rooms()) {
      const byDest = new Map<string, [string, MapLink][]>();
      for (const [cmd, link] of Object.entries(room.links)) {
        if (!link.to || link.kind === "teleport") continue;
        const to = this.canonicalId(link.to);
        if (!to || to === room.id) continue;
        let list = byDest.get(to);
        if (!list) byDest.set(to, (list = []));
        list.push([cmd, link]);
      }
      for (const group of byDest.values()) {
        if (group.length < 2) continue;
        const learned = group.filter(([cmd, l]) => isLearnedSpecial(cmd, l, room));
        if (!learned.length) continue;
        const listed = group.some(
          ([cmd, l]) => room.exits.includes(cmd) && l.confirmed && (l.uses >= 2 || !!l.verified),
        );
        const anchored = group.some(([cmd, l]) => !!l.verified || (!isLearnedSpecial(cmd, l, room) && l.confirmed));
        const top = Math.max(...learned.map(([, l]) => l.uses));
        // Ties keep the first one recorded.
        const keep = listed ? undefined : learned.find(([, l]) => l.uses === top)?.[0];
        for (const [cmd, l] of learned) {
          const junk = !looksLikeTravelCommand(cmd, room) && l.uses <= 2 && (anchored || cmd !== keep);
          const minor = cmd !== keep && l.uses * 4 <= top;
          if ((listed || junk || minor) && this.unlink(room.id, cmd)) n += 1;
        }
      }
    }
    return n;
  }

  /**
   * A room's obvious exits are ground truth: a compass or named link on an exit it does not
   * list came from a misattributed move. Rooms with doors (`dynamic-exits`), secret and
   * scripted (`pre`) links are left alone. Inferred links whose reverse now points
   * elsewhere lost their justification and go too.
   */
  private pruneLinks(): number {
    let n = 0;
    // A command that redisplayed the room it was typed in (`gate`, `search`) is not an exit.
    for (const room of this.rooms()) {
      for (const [cmd, link] of Object.entries(room.links)) {
        if (isGeometricDirection(cmd) || link.kind === "teleport") continue;
        if (link.to && this.canonicalId(link.to) === room.id && this.unlink(room.id, cmd)) n += 1;
      }
    }
    const copies = this.distinctivePlaceClasses();
    // A listed exit whose destination does not list the way back, while another free exit of
    // this room fits it exactly: the same slipped attribution (r315 `w`→r316, really `se`).
    // Done first, since it frees the slot the neighbor's stray link belongs in.
    for (const room of this.rooms()) {
      if (room.dark || room.tags.includes("dynamic-exits")) continue;
      for (const [cmd, link] of Object.entries(room.links)) {
        if (!room.exits.includes(cmd) || !link.to || !link.confirmed || link.kind === "special" || link.hidden || link.pre?.length) continue;
        const toId = this.canonicalId(link.to);
        if (!toId || !this.bothEndsDeny(room, cmd, toId, { listed: true })) continue;
        if (this.rekeyMisattributed(room, cmd, toId, copies, { freeOnly: true })) n += 1;
      }
    }
    for (const room of this.rooms()) {
      if (room.dark || !room.exits.length || room.tags.includes("dynamic-exits")) continue;
      for (const [cmd, link] of Object.entries(room.links)) {
        if (link.kind === "special" || link.kind === "teleport" || link.hidden || link.pre?.length) continue;
        if (!room.exits.includes(cmd)) {
          const toId = link.to ? this.canonicalId(link.to) : undefined;
          const denied = !!toId && this.bothEndsDeny(room, cmd, toId);
          // Walked or paired with the reverse step, and the rooms sit on that compass vector.
          // The exit list can omit a real door (or a wrapped exit line dropped it).
          if (
            toId &&
            !denied &&
            this.geometryAgrees(room, cmd, toId) &&
            (link.confirmed || this.backPointsHere(room, cmd, toId))
          ) {
            // Kept as an unlisted door, unless an exit the room does list, free at both ends,
            // fits the same neighbor: then this was that exit, credited to the wrong command.
            const rev = reverseDirection(cmd);
            const listsBack = !!rev && !!this.room(toId)?.exits.includes(rev);
            if (listsBack && this.rekeyMisattributed(room, cmd, toId, copies, { freeOnly: true, strict: true })) n += 1;
            continue;
          }
          if (denied && this.rekeyMisattributed(room, cmd, toId!, copies)) {
            n += 1;
            continue;
          }
          // No exit fits, but the layout and a walk agree: it may be the only known way through
          // (a stretch mapped with a slipped queue). Keep it as a costly guess; refusals on the
          // walk drop it (`recordNavigationFailure`) and the audit keeps listing it.
          const walked = link.confirmed || link.note === SUSPECT_LINK_NOTE || this.backPointsHere(room, cmd, toId!);
          if (denied && this.geometryAgrees(room, cmd, toId!) && walked) {
            if (link.confirmed || link.note !== SUSPECT_LINK_NOTE) {
              link.confirmed = false;
              link.weight = Math.max(link.weight ?? 1, SUSPECT_LINK_WEIGHT);
              link.note = SUSPECT_LINK_NOTE;
              this.touch();
              n += 1;
            }
            continue;
          }
          if (this.unlink(room.id, cmd)) n += 1;
        }
      }
    }
    for (const room of this.rooms()) {
      for (const [cmd, link] of Object.entries(room.links)) {
        if (link.confirmed || !link.to || !isGeometricDirection(cmd)) continue;
        const to = this.room(link.to);
        const back = to?.links[reverseDirection(cmd)!];
        const backTo = back?.to ? this.canonicalId(back.to) : undefined;
        // A reverse into a copy of this room is the same place (the copy merges later).
        const backElsewhere = !!backTo && backTo !== room.id && !(copies.has(backTo) && copies.get(backTo) === copies.get(room.id));
        if (!to || backElsewhere) {
          if (this.unlink(room.id, cmd)) n += 1;
        }
      }
    }
    return n;
  }

  /**
   * Rooms that should not exist: blank placeholders nothing leads to, and disconnected
   * rooms that copy a connected one (folded into it when it is the only twin).
   */
  private removeGhosts(protect: Set<string>): number {
    let n = 0;
    for (const room of this.rooms()) {
      if (protect.has(room.id) || !this.doc.rooms[room.id]) continue;
      const linked =
        Object.values(room.links).some((l) => l.to && l.kind !== "teleport" && this.room(l.to)) ||
        this.incomingRooms(room.id).length > 0;
      if (linked) continue;
      if (!room.title && room.descKeys.length === 0) {
        if (this.deleteRoom(room.id)) n += 1;
        continue;
      }
      const twins = (room.title ? this.roomsWithTitle(room.title) : this.rooms()).filter(
        (r) =>
          r.id !== room.id &&
          this.signaturesAgree(r, room) &&
          (Object.keys(r.links).length > 0 || this.incomingRooms(r.id).length > 0),
      );
      if (twins.length === 1) {
        this.mergeRooms(twins[0]!.id, room.id);
        n += 1;
      } else if (twins.length > 1 && room.visits > 1) {
        // Visited often enough to hold NPCs and contents worth keeping: fold it into the
        // nearest look-alike rather than throw it away.
        const nearest = twins
          .filter((t) => t.pos.plane === room.pos.plane)
          .sort((a, b) => copyDistance(a.pos, room.pos) - copyDistance(b.pos, room.pos))[0];
        if (nearest && copyDistance(nearest.pos, room.pos) <= CHAIN_MERGE_MAX_CELLS) {
          if (this.mergeRooms(nearest.id, room.id)) n += 1;
        } else if (!(room.tags.length || room.notes.length || Object.keys(room.meta).length)) {
          if (this.deleteRoom(room.id)) n += 1;
        }
      } else if (twins.length > 1 && room.visits <= 1) {
        // A copy made while lost in uniform prose, never linked: it holds nothing worth keeping.
        if (this.deleteRoom(room.id)) n += 1;
      }
    }
    return n;
  }

  /**
   * Join an unexplored compass exit to the one room on that cell. The neighbor usually
   * lists the way back. When it does not, join only a neighbor with no verbose display yet
   * (a brief exits list may be cut short) and only if both cells hold a single distinct room.
   * Then reciprocate confirmed geometric links so a one-way shop door is walkable back in.
   */
  private stitchExits(): number {
    let n = 0;
    for (const room of this.rooms()) {
      if (room.dark || room.tags.includes("dynamic-exits")) continue;
      for (const d of room.exits) {
        if (!isGeometricDirection(d) || room.links[d]?.to) continue;
        const rev = reverseDirection(d)!;
        const there = this.roomsAt(this.expectedPos(room, d)!).filter((q) => {
          if (q.id === room.id || q.dark) return false;
          const back = q.links[rev];
          if (back?.to && this.canonicalId(back.to) !== room.id) return false;
          if (q.exits.includes(rev)) return true;
          // A full "obvious exits" line that leaves out the way back is the game's word: the
          // grid just happens to put two unrelated rooms side by side (Merevia's forest path
          // r4812 under the grasslands). Only a brief-only room may have lost an exit.
          if (q.description && q.exits.length > 0) return false;
          if (this.roomsAt(room.pos).length !== 1 || this.roomsAt(q.pos).length !== 1) return false;
          if (this.signaturesAgree(room, q)) return false;
          return true;
        });
        if (there.length !== 1) continue;
        const q = there[0]!;
        this.link(room.id, d, q.id, { kind: exitKindFor(d, room.exits), confirmed: false });
        if (!q.links[rev]?.to) this.link(q.id, rev, room.id, { kind: exitKindFor(rev, q.exits), confirmed: false });
        n += 1;
      }
    }
    n += this.reciprocateExits();
    return n;
  }

  /** `A --west--> B` on the grid implies `B --east--> A`, even when B never listed east. */
  private reciprocateExits(): number {
    let n = 0;
    for (const room of this.rooms()) {
      for (const [cmd, link] of Object.entries(room.links)) {
        if (!link.confirmed || !link.to || link.kind === "teleport" || link.hidden) continue;
        if (!this.geometryAgrees(room, cmd, link.to)) continue;
        const rev = reverseDirection(cmd);
        if (!rev) continue;
        const dest = this.room(link.to);
        if (!dest) continue;
        const back = dest.links[rev];
        if (back?.to) continue;
        if (!dest.exits.includes(rev) && this.namedWayBack(dest, room.id)) continue;
        // A verbose display whose compass exits leave out the way back is the game's word (the
        // Merevia cave dead end r4925 lists only south): do not invent a phantom return.
        if (!dest.exits.includes(rev) && dest.description && dest.exits.some((e) => isGeometricDirection(e))) continue;
        this.link(dest.id, rev, room.id, { kind: exitKindFor(rev, dest.exits), confirmed: false });
        n += 1;
      }
    }
    return n;
  }

  private dropEmptyPlanes(): number {
    const used = new Set(this.rooms().map((r) => r.pos.plane));
    let n = 0;
    for (const id of Object.keys(this.doc.planes)) {
      if (used.has(id)) continue;
      delete this.doc.planes[id];
      n += 1;
    }
    if (n) this.touch();
    return n;
  }

  private signaturesAgree(a: MapRoom, b: MapRoom): boolean {
    if (!this.sameContinent(a, b)) return false;
    if (!this.titlesAgree(a, b)) return false;
    if (a.descKeys.length && b.descKeys.length && !this.descriptionsAgree(a, b)) return false;
    return sameExitSet(a.exits, b.exits);
  }

  /** Same title (or one is an alias of the other); two untitled rooms agree. */
  private titlesAgree(a: MapRoom, b: MapRoom): boolean {
    if (!a.title && !b.title) return true;
    if (!a.title || !b.title) return false;
    return this.titleMatches(a, b.title) || this.titleMatches(b, a.title);
  }

  /**
   * Strong enough that two records are one place once the map around them agrees: same exits
   * (or doors), and matching long prose — titles may differ then (agent label vs game title) —
   * or, for rooms only seen in brief mode, the same title.
   */
  private samePlace(a: MapRoom, b: MapRoom): boolean {
    if (!this.sameContinent(a, b)) return false;
    const doors = a.tags.includes("dynamic-exits") || b.tags.includes("dynamic-exits");
    if (!doors && !sameExitSet(a.exits, b.exits)) return false;
    if (a.description && b.description) {
      if (Math.min(normalizeDescription(a.description).length, normalizeDescription(b.description).length) < 60) {
        return this.titlesAgree(a, b) && this.descriptionsAgree(a, b);
      }
      return this.descriptionsAgree(a, b);
    }
    if (a.description || b.description) return false;
    return !!a.title && this.titlesAgree(a, b);
  }

  /** Both lead the same confirmed way to the same room, or a neighbor sits between them back and forth. */
  private shareConfirmedExit(a: MapRoom, b: MapRoom): boolean {
    for (const [cmd, la] of Object.entries(a.links)) {
      const lb = b.links[cmd];
      if (!la.confirmed || !lb?.confirmed || !la.to || !lb.to || la.kind === "teleport") continue;
      const ta = this.canonicalId(la.to);
      if (ta && ta === this.canonicalId(lb.to) && ta !== a.id && ta !== b.id) return true;
    }
    const crossed = (x: MapRoom, y: MapRoom) =>
      Object.entries(x.links).some(([cmd, l]) => {
        const rev = reverseDirection(cmd);
        if (!l.confirmed || !l.to || !rev || !isGeometricDirection(cmd)) return false;
        const back = this.room(l.to)?.links[rev];
        return !!back?.confirmed && this.canonicalId(back.to) === y.id;
      });
    return crossed(a, b) || crossed(b, a);
  }

  /** Long prose that only these rooms carry (not a uniform corridor or forest). */
  private proseUniqueTo(a: MapRoom, b: MapRoom): boolean {
    if (!a.description || normalizeDescription(a.description).length < 60) return false;
    const ids = this.roomIdsMatchingDescription({ mode: "verbose", description: a.description, exits: [], contents: [] });
    return ids.every((id) => id === a.id || id === b.id);
  }

  /**
   * Two records of one room, proven by the map around them (not by looks alone): they agree
   * as places (see `samePlace`) and either share a cell and a confirmed way out to the same
   * room, or a neighbor's confirmed exit leads back to one while the other's confirmed exit
   * leads to that neighbor (`A --e--> B --w--> A'`) — the second only on the same cell or
   * when the prose is unique to the pair, since mazes and uniform corridors loop.
   * The lower id survives; a differing title is kept as an alias.
   */
  private resolveIdentityConflicts(): number {
    let n = 0;
    for (let pass = 0; pass < 20; pass++) {
      let changed = 0;
      for (const [x, y] of this.identityConflictPairs()) {
        const a = this.room(x);
        const b = this.room(y);
        if (!a || !b || a.id === b.id || !this.samePlace(a, b)) continue;
        const [keep, drop] = olderRoomId(a.id, b.id) === a.id ? [a, b] : [b, a];
        if (keep.pos.plane !== drop.pos.plane) this.mergePlanes(keep.pos.plane, drop.pos.plane, subVec(keep.pos, drop.pos));
        if (this.mergeRooms(keep.id, drop.id)) changed += 1;
      }
      n += changed;
      if (!changed) break;
    }
    return n;
  }

  /**
   * Copies of one room made while lost, often whole chains of them (the Kulajo mine tunnel was
   * on the map five times). Two rooms are copies when they carry the same distinctive prose —
   * long, and never next to itself the way forest, desert or arena squares are — with the same
   * title and exits, at least one confirmed exit leads both to the same room (or to copies of
   * one room), and no confirmed exit leads them to rooms that differ. Twins (Kalinport's Oasis
   * Avenue blocks either side of Vedny Road) differ in a neighbor and stay apart.
   */
  private mergeDuplicateChains(): number {
    let n = 0;
    for (let pass = 0; pass < 20; pass++) {
      const cls = this.distinctivePlaceClasses();
      const groups = new Map<string, MapRoom[]>();
      for (const r of this.rooms()) {
        const c = cls.get(r.id);
        if (c) groups.set(c, [...(groups.get(c) ?? []), r]);
      }
      let changed = 0;
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => (olderRoomId(a.id, b.id) === a.id ? -1 : 1));
        // Nearest pairs first: a road that reuses three descriptions puts look-alikes a few
        // cells apart; a copy made while lost sits a step or two off its original.
        const pairs: [MapRoom, MapRoom, number][] = [];
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const d = copyDistance(group[i]!.pos, group[j]!.pos);
            if (d <= CHAIN_MERGE_MAX_CELLS) pairs.push([group[i]!, group[j]!, d]);
          }
        }
        pairs.sort((p, q) => p[2] - q[2]);
        {
          for (const [x, y] of pairs) {
            const a = this.doc.rooms[x.id];
            const b = this.doc.rooms[y.id];
            if (!a || !b || !this.copiesAgree(a, b, cls)) continue;
            const offset = subVec(a.pos, b.pos);
            if (a.pos.plane !== b.pos.plane && this.planeMergeCollisions(a.pos.plane, b.pos.plane, offset) === 0) {
              this.mergePlanes(a.pos.plane, b.pos.plane, offset);
            }
            if (this.mergeRooms(a.id, b.id)) changed += 1;
          }
        }
      }
      n += changed;
      if (!changed) break;
    }
    return n;
  }

  /** Room id → place class (title, exits, prose) for rooms whose prose is distinctive. */
  private distinctivePlaceClasses(): Map<string, string> {
    const norms = new Map<string, string>();
    for (const r of this.rooms()) if (r.description) norms.set(r.id, normalizeDescription(r.description));
    const selfAdjacent = new Set<string>();
    for (const r of this.rooms()) {
      const mine = norms.get(r.id);
      if (!mine) continue;
      for (const l of Object.values(r.links)) {
        const to = l.to ? this.canonicalId(l.to) : undefined;
        if (to && to !== r.id && norms.get(to) === mine) selfAdjacent.add(mine);
      }
    }
    const out = new Map<string, string>();
    for (const r of this.rooms()) {
      const norm = norms.get(r.id);
      if (!norm || norm.length < CHAIN_MERGE_MIN_DESC || selfAdjacent.has(norm) || r.dark) continue;
      if (r.tags.includes("dynamic-exits")) continue;
      out.set(r.id, `${r.title ?? ""}|${[...r.exits].sort().join(",")}|${norm}`);
    }
    return out;
  }

  private copiesAgree(a: MapRoom, b: MapRoom, cls: Map<string, string>): boolean {
    let evidence = false;
    for (const [cmd, la] of Object.entries(a.links)) {
      const lb = b.links[cmd];
      if (!la.to || !lb?.to || !la.confirmed || !lb.confirmed || la.kind === "teleport" || lb.kind === "teleport") continue;
      const ta = this.canonicalId(la.to);
      const tb = this.canonicalId(lb.to);
      const pair = new Set([a.id, b.id]);
      if (ta === tb || (pair.has(ta!) && pair.has(tb!))) {
        evidence = true;
        continue;
      }
      const ca = cls.get(ta!);
      if (ca && ca === cls.get(tb!)) {
        evidence = true;
        continue;
      }
      return false;
    }
    return evidence;
  }

  private identityConflictPairs(): [string, string][] {
    const out: [string, string][] = [];
    for (const ids of this.byPos.values()) {
      if (ids.size < 2) continue;
      const list = [...ids].map((id) => this.doc.rooms[id]).filter((r): r is MapRoom => !!r);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (this.shareConfirmedExit(list[i]!, list[j]!)) out.push([list[i]!.id, list[j]!.id]);
        }
      }
    }
    for (const a of this.rooms()) {
      for (const [cmd, link] of Object.entries(a.links)) {
        const rev = reverseDirection(cmd);
        if (!link.confirmed || !link.to || !rev || !isGeometricDirection(cmd)) continue;
        const b = this.room(link.to);
        const back = b?.links[rev];
        if (!b || !back?.confirmed || !back.to) continue;
        const c = this.room(back.to);
        if (!c || c.id === a.id || c.id === b.id) continue;
        const sameCell = posKey(c.pos) === posKey(a.pos);
        if (sameCell || this.proseUniqueTo(a, c)) out.push([a.id, c.id]);
      }
    }
    return out;
  }

  /** Rooms on a plane the plane list lost (older merges): register it as a surface plane. */
  private registerMissingPlanes(): number {
    let n = 0;
    for (const r of this.rooms()) {
      const id = r.pos?.plane;
      if (!id || this.doc.planes[id]) continue;
      this.doc.planes[id] = { id, kind: "surface", createdAt: nowIso() };
      const num = Number(id.slice(1));
      if (Number.isFinite(num) && num >= this.doc.nextPlane) this.doc.nextPlane = num + 1;
      n += 1;
    }
    if (n) this.touch();
    return n;
  }

  deleteRoom(id: string): boolean {
    const room = this.doc.rooms[id];
    if (!room) return false;
    for (const r of this.incomingRooms(id)) {
      this.unindexRoom(r);
      for (const [cmd, link] of Object.entries(r.links)) if (link.to === id) delete r.links[cmd];
      this.indexRoom(r);
    }
    this.unindexRoom(room);
    delete this.doc.rooms[id];
    this.pruneRedirects();
    this.touch();
    return true;
  }

  /**
   * Drop redirects that no longer reach a room (the room they pointed at was deleted) and
   * flatten chains so every old id points straight at its surviving room.
   */
  pruneRedirects(): number {
    const redirects = this.doc.redirects;
    if (!redirects) return 0;
    let n = 0;
    for (const [from, to] of Object.entries(redirects)) {
      const live = this.canonicalId(to);
      if (!live || this.doc.rooms[from]) {
        delete redirects[from];
        n += 1;
      } else if (live !== to) redirects[from] = live;
    }
    if (n) this.touch();
    return n;
  }

  /** Rooms mapped from brief mode only (title, no verbose `look` / descKeys). */
  isBriefOnlyRoom(room: MapRoom): boolean {
    if (room.description?.trim() || room.descKeys.length > 0) return false;
    return !!room.title?.trim();
  }

  /** Drop brief-only rooms (re-map with `look` when you return). Never removes `protect` ids. */
  removeBriefOnlyRooms(protect: Set<string> = new Set()): number {
    let n = 0;
    for (const room of [...this.rooms()]) {
      if (protect.has(room.id) || !this.isBriefOnlyRoom(room)) continue;
      if (this.deleteRoom(room.id)) n += 1;
    }
    return n;
  }

  private linkUsable(link: MapLink, opts: PathOptions, now: number, doorState?: DoorState, roomId?: string, cmd?: string): boolean {
    if (doorState === "locked") return false;
    if (!link.to) return false;
    if (roomId !== undefined && cmd !== undefined && linkNeverPathed(roomId, cmd, opts.allowLinks)) return false;
    if (link.kind === "teleport") {
      // Rides (ships) are teleport-kind so they never shape the layout; usable on request.
      if (!link.transit || roomId === undefined || cmd === undefined || !transitLinkAllowed(roomId, cmd, opts.allowLinks)) return false;
    }
    if (opts.allowInferred === false && !link.confirmed) return false;
    if (opts.allowSpecial === false && link.kind === "special") return false;
    if (link.blocked && now - Date.parse(link.blocked.at) < BLOCK_TTL_MS) return false;
    return true;
  }

  private roomAvoided(room: MapRoom, opts: PathOptions): boolean {
    if (opts.maxDanger !== undefined && (room.danger ?? 0) > opts.maxDanger) return true;
    if (opts.avoid?.length) {
      if (opts.avoid.includes(room.id)) return true;
      if (room.tags.some((t) => opts.avoid!.includes(t))) return true;
    }
    return false;
  }

  /**
   * A guessed compass link (unconfirmed, never walked) into a room whose verbose exits list has
   * compass exits but not the way back — the grid put two unrelated rooms side by side.
   */
  guessContradicted(fromId: string, cmd: string, link: MapLink, dest: MapRoom): boolean {
    if (link.confirmed || (link.uses ?? 0) > 0 || link.kind === "teleport" || link.hidden) return false;
    if (!isGeometricDirection(cmd)) return false;
    const rev = reverseDirection(cmd);
    if (!rev || dest.exits.includes(rev)) return false;
    if (!dest.description || !dest.exits.some((e) => isGeometricDirection(e))) return false;
    // A named way back (door, path, etc.) to us explains the missing compass exit.
    return !Object.values(dest.links).some((l) => l.to === fromId);
  }

  /** Dijkstra over known links. Returns null when unreachable. */
  findPath(fromId: string, goal: (room: MapRoom) => boolean, opts: PathOptions = {}): PathStep[] | null {
    const start = this.doc.rooms[fromId];
    if (!start) return null;
    if (goal(start)) return [];
    const now = Date.now();
    const dist = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, PathStep>();
    const done = new Set<string>();
    // Small graphs (thousands of rooms): a sorted frontier array is fast enough.
    const frontier: { id: string; d: number }[] = [{ id: fromId, d: 0 }];
    const maxSteps = opts.maxSteps ?? 10_000;
    while (frontier.length) {
      frontier.sort((a, b) => a.d - b.d);
      const cur = frontier.shift()!;
      if (done.has(cur.id)) continue;
      done.add(cur.id);
      const room = this.doc.rooms[cur.id]!;
      if (cur.id !== fromId && goal(room)) {
        const steps: PathStep[] = [];
        let at = cur.id;
        while (at !== fromId) {
          const s = prev.get(at)!;
          steps.unshift(s);
          at = s.from;
        }
        return steps;
      }
      if ((prev.size > maxSteps)) break;
      for (const [cmd, link] of Object.entries(room.links)) {
        if (!this.linkUsable(link, opts, now, room.doors?.find((d) => d.direction === cmd)?.state, room.id, cmd)) continue;
        if (opts.avoidLinks?.includes(`${room.id}:${cmd}`)) continue;
        const next = this.doc.rooms[link.to!];
        if (!next || done.has(next.id)) continue;
        if (!goal(next) && this.roomAvoided(next, opts)) continue;
        let w = (link.weight ?? 1) + (link.kind === "special" ? 0.5 : 0) + (link.confirmed ? 0 : 0.25);
        if (this.guessContradicted(room.id, cmd, link, next)) w += CONTRADICTED_GUESS_COST;
        if (opts.preferAvoid?.length) {
          if (opts.preferAvoid.includes(next.id) || next.tags.some((t) => opts.preferAvoid!.includes(t))) {
            w += PREFER_AVOID_ROOM_COST;
          }
        }
        const nd = cur.d + w;
        if (nd < (dist.get(next.id) ?? Infinity)) {
          dist.set(next.id, nd);
          prev.set(next.id, { from: room.id, cmd, to: next.id, pre: link.pre });
          frontier.push({ id: next.id, d: nd });
        }
      }
    }
    return null;
  }

  /**
   * Hop count along usable links from `fromId` to each id in `targets`.
   * Missing ids are unreachable (or unknown). Stops once every target is found.
   */
  stepDistances(fromId: string, targets: ReadonlySet<string>, opts: PathOptions = {}): Map<string, number> {
    const out = new Map<string, number>();
    const start = this.doc.rooms[fromId];
    if (!start || targets.size === 0) return out;
    if (targets.has(fromId)) out.set(fromId, 0);
    if (out.size === targets.size) return out;
    const now = Date.now();
    const seen = new Set([fromId]);
    let layer = [start];
    let distance = 0;
    while (layer.length && out.size < targets.size) {
      const next: MapRoom[] = [];
      distance += 1;
      for (const room of layer) {
        for (const [cmd, link] of Object.entries(room.links)) {
          if (!this.linkUsable(link, opts, now, room.doors?.find((d) => d.direction === cmd)?.state, room.id, cmd)) continue;
          if (opts.avoidLinks?.includes(`${room.id}:${cmd}`)) continue;
          const n = this.doc.rooms[link.to!];
          if (!n || seen.has(n.id)) continue;
          if (!targets.has(n.id) && this.roomAvoided(n, opts)) continue;
          seen.add(n.id);
          if (targets.has(n.id)) out.set(n.id, distance);
          next.push(n);
        }
      }
      layer = next;
    }
    return out;
  }

  /** Rooms reachable from `fromId` that still have listed exits without a known destination. */
  frontier(fromId: string, opts: PathOptions & { limit?: number } = {}): { room: MapRoom; exits: string[]; distance: number }[] {
    const out: { room: MapRoom; exits: string[]; distance: number }[] = [];
    const start = this.doc.rooms[fromId];
    if (!start) return out;
    const now = Date.now();
    const seen = new Set([fromId]);
    let layer = [start];
    let distance = 0;
    const limit = opts.limit ?? 20;
    while (layer.length && out.length < limit) {
      const next: MapRoom[] = [];
      for (const room of layer) {
        const unexplored = room.exits.filter((e) => {
          const l = room.links[e];
          if (!l) return true;
          if (l.blocked && now - Date.parse(l.blocked.at) < BLOCK_TTL_MS) return false;
          return !l.to;
        });
        if (unexplored.length && !(room !== start && this.roomAvoided(room, opts))) {
          out.push({ room, exits: unexplored, distance });
        }
        for (const [cmd, link] of Object.entries(room.links)) {
          if (!this.linkUsable(link, opts, now, room.doors?.find((d) => d.direction === cmd)?.state, room.id, cmd)) continue;
          if (opts.avoidLinks?.includes(`${room.id}:${cmd}`)) continue;
          const n = this.doc.rooms[link.to!];
          if (!n || seen.has(n.id) || this.roomAvoided(n, opts)) continue;
          seen.add(n.id);
          next.push(n);
        }
      }
      layer = next;
      distance += 1;
    }
    return out.slice(0, limit);
  }

  /** Connected components over links (ignoring direction). */
  components(): string[][] {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = x;
      while (parent.get(c) !== r) {
        const n = parent.get(c)!;
        parent.set(c, r);
        c = n;
      }
      return r;
    };
    for (const id of Object.keys(this.doc.rooms)) parent.set(id, id);
    for (const room of this.rooms()) {
      for (const link of Object.values(room.links)) {
        if (!link.to || !parent.has(link.to) || link.kind === "teleport") continue;
        const a = find(room.id);
        const b = find(link.to);
        if (a !== b) parent.set(a, b);
      }
    }
    const groups = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const r = find(id);
      let g = groups.get(r);
      if (!g) groups.set(r, (g = []));
      g.push(id);
    }
    return [...groups.values()].sort((a, b) => b.length - a.length);
  }

  /** Save or overwrite a named waypoint at `roomId`. */
  setWaypoint(name: string, roomId: string): void {
    const key = normalizeWaypointName(name);
    if (!key) throw new Error("waypoint name required");
    const canon = this.canonicalId(roomId) ?? roomId;
    if (!this.doc.rooms[canon]) throw new Error(`unknown room ${roomId}`);
    const wps = ensureWaypoints(this.doc);
    wps[key] = { roomId: canon, label: name.trim(), setAt: nowIso() };
    this.touch();
  }

  listWaypoints(): { name: string; roomId: string; label?: string; setAt: string }[] {
    const wps = this.doc.waypoints;
    if (!wps) return [];
    return Object.entries(wps)
      .map(([name, wp]) => ({ name, roomId: wp.roomId, label: wp.label, setAt: wp.setAt }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Room for an exact waypoint label (case-insensitive), if set. */
  waypointRoom(name: string): MapRoom | undefined {
    const key = normalizeWaypointName(name);
    if (!key) return undefined;
    const wp = this.doc.waypoints?.[key];
    if (!wp) return undefined;
    const id = this.canonicalId(wp.roomId) ?? wp.roomId;
    return this.room(id);
  }

  /** Free-text search over title, description, area, tags, notes, NPC names and contents. */
  search(query: string, limit = 20): { room: MapRoom; score: number; npcMatch?: string }[] {
    const trimmed = query.trim();
    if (isNumericRoomIdQuery(trimmed)) {
      const room = this.room(trimmed.toLowerCase());
      return room ? [{ room, score: 1000 }] : [];
    }
    const wpRoom = this.waypointRoom(trimmed);
    if (wpRoom) {
      return [{ room: wpRoom, score: 2000 }];
    }
    const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits: { room: MapRoom; score: number; npcMatch?: string }[] = [];
    for (const room of this.rooms()) {
      const npcNames = npcNamesForRoom(room);
      const npcText = npcNames.join(" ").toLowerCase();
      const fields: [string, number][] = [
        [room.id.toLowerCase(), 10],
        ...npcNames.map((n): [string, number] => [n.toLowerCase(), 8]),
        [npcText, 6],
        [(room.title ?? "").toLowerCase(), 4],
        [areaDisplayLabel(this.doc, room).toLowerCase(), 4],
        [(room.area ?? "").toLowerCase(), 3],
        [(room.tags ?? []).join(" ").toLowerCase(), 3],
        [(room.notes ?? []).join(" ").toLowerCase(), 2],
        [Object.values(room.contents ?? {}).map((c) => `${c.name} ${c.path ?? ""}`).join(" ").toLowerCase(), 2],
        [(room.description ?? "").toLowerCase(), 1],
        [JSON.stringify(room.meta).toLowerCase(), 1],
      ];
      let score = 0;
      for (const term of terms) {
        let best = 0;
        for (const [text, w] of fields) if (text.includes(term)) best = Math.max(best, w);
        if (best === 0) {
          score = 0;
          break;
        }
        score += best;
      }
      if (score > 0) {
        const npcMatch = npcMatchFor(room, terms);
        if (npcMatch) score += 4;
        hits.push({ room, score: score + Math.min(room.visits, 20) / 100, npcMatch });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Resolve a room reference: id, exact tag, exact title (unique), or best search hit. */
  resolve(ref: string): MapRoom | undefined {
    const r = ref.trim();
    if (this.doc.rooms[r]) return this.doc.rooms[r];
    const waypoint = this.waypointRoom(r);
    if (waypoint) return waypoint;
    const tagged = this.rooms().filter((x) => x.tags.includes(r));
    if (tagged.length === 1) return tagged[0];
    const titled = this.roomsWithTitle(r);
    if (titled.length === 1) return titled[0];
    return this.search(r, 1)[0]?.room;
  }
}
