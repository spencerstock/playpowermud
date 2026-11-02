import type { RoomContentKind, RoomDoor } from "../game/types.js";

/**
 * - `dir`: compass move on the same plane/level.
 * - `vertical`: up/down — same plane, z ± 1.
 * - `named`: listed non-compass exit (`out`, `lair`) — destination gets its own aside plane.
 * - `special`: unlisted command that moved us (`pry floorboard`) — a secret exit, aside plane.
 * - `teleport`: agent-registered relocation (recall/portal) — never used for layout.
 */
export type ExitKind = "dir" | "vertical" | "named" | "special" | "teleport";

export type MapLink = {
  /** Destination room id; null when the exit is known but unexplored or blocked. */
  to: string | null;
  kind: ExitKind;
  /** Not in the room's obvious exits (secret/special). */
  hidden?: boolean;
  /** Traversed for real; false = inferred (e.g. reverse of a compass move). */
  confirmed: boolean;
  /** Commands to send first (e.g. `open door`, `unlock gate`). Agent-editable. */
  pre?: string[];
  /** Extra path cost (default 1). Large values make pathfinding avoid this exit. */
  weight?: number;
  blocked?: { reason: string; at: string };
  /** Consecutive failed move attempts on this exit; at threshold the link is removed. */
  failCount?: number;
  uses: number;
  lastUsedAt?: string;
  note?: string;
};

export type MapPos = { plane: string; x: number; y: number; z: number };

export type StoredContent = {
  name: string;
  kind: RoomContentKind;
  /** LPC path without the `#instance` suffix, e.g. `d/std/mon/tguard`. */
  path?: string;
  lastCount: number;
  seenCount: number;
  lastSeenAt: string;
};

export type MapRoom = {
  id: string;
  /** Brief-mode room name. */
  title?: string;
  /**
   * Other names this same room has been seen or labelled under (an agent title override, or
   * two copies merged after the map proved they were one room). They count as the title.
   */
  titleAliases?: string[];
  /** Shortest clean verbose description seen. */
  description?: string;
  /** Normalized description suffix keys (multiple when the description is dynamic). */
  descKeys: string[];
  /** Obvious exits from the most recent observation, plus unlocked doors (canonical tokens). */
  exits: string[];
  /** Doors seen in the room text. Closed doors need `open door` before their direction. */
  doors?: RoomDoor[];
  links: Record<string, MapLink>;
  pos: MapPos;
  area?: string;
  dark?: boolean;
  /** Keyed by content path (or name when no path). */
  contents: Record<string, StoredContent>;
  /** Stationary NPCs / mobs seen in this room (search index; derived from contents). */
  npcs?: string[];
  tags: string[];
  notes: string[];
  /** Free-form agent metadata (shops, trainers, quest hooks, …). */
  meta: Record<string, unknown>;
  /** 0 safe … 5 deadly; pathfinding avoids rooms above the caller's limit. */
  danger?: number;
  visits: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type MapPlane = {
  id: string;
  label?: string;
  kind: "surface" | "aside";
  /** For aside planes: where it hangs off its parent plane. */
  parent?: { plane: string; fromRoom: string; via: string };
  createdAt: string;
};

export type MapArea = {
  label: string;
  notes: string[];
  meta: Record<string, unknown>;
};

export type WorldGraphDocument = {
  version: 1;
  mud: string;
  updatedAt: string;
  nextRoom: number;
  nextPlane: number;
  rooms: Record<string, MapRoom>;
  planes: Record<string, MapPlane>;
  areas: Record<string, MapArea>;
  /** Merged-away room id → surviving id, so old references keep resolving. */
  redirects?: Record<string, string>;
};

export type PathOptions = {
  /** Skip rooms with danger above this (default: no limit). */
  maxDanger?: number;
  /** Room ids or tags to never enter (except the destination). */
  avoid?: string[];
  /** Exits never to take on this request, as `roomId:cmd` (failed earlier in the same walk). */
  avoidLinks?: string[];
  /**
   * Opt in to links that pathing never takes by default (`NEVER_PATH_LINKS`: the Assassin's Guild
   * red stone to Dunagin, `homeland`). Entries are a bare command (`touch red stone`), a
   * `roomId:cmd` key, or `*` for all of them.
   */
  allowLinks?: string[];
  /** Extra cost to traverse these room ids or tags; still used when no alternate exists. */
  preferAvoid?: string[];
  /** Use inferred (unconfirmed) links (default true). */
  allowInferred?: boolean;
  /** Allow `special` (secret) exits (default true). */
  allowSpecial?: boolean;
  maxSteps?: number;
};

export type PathStep = { from: string; cmd: string; to: string; pre?: string[] };
