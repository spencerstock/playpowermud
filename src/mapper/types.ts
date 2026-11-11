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
  /**
   * Consecutive failed moves on this exit. Reset to 0 on a successful traversal.
   * Pathing marks the link blocked at `BLOCK_AFTER_CONSECUTIVE_FAILS`; repeated hard
   * refusals can still remove the link at `NAV_FAILURES_BEFORE_HEAL`.
   */
  failCount?: number;
  /**
   * Times a move along this exit was eaten without moving (`The small boy trips you!`). The exit
   * works; batch speedwalks send this step on its own and repeat it until it goes through.
   */
  hindered?: number;
  uses: number;
  lastUsedAt?: string;
  note?: string;
  /**
   * Proven by something stronger than one walk: `alias` — a travel alias round trip only works
   * on the map with this link (see `aliasTruth.ts`). Heal never prunes it as redundant and a
   * single contradicting arrival never rewrites it.
   */
  verified?: "alias";
  /**
   * An arrival along this (well-used) exit that led somewhere else. The link is only re-pointed
   * when the same other room shows up again; one bad observation does not rewrite the map.
   */
  contested?: { to: string; count: number };
  /**
   * A ride, not a walk (ship, ferry — profile `transits`). Stored as `kind: "teleport"` so it
   * never shapes the layout; pathing takes it only when `allowLinks` opts in (`transit`, `*`,
   * the command or `roomId:cmd`).
   */
  transit?: MapTransit;
};

export type MapTransit = {
  /** Profile rule id (`kendrite-ship`). */
  rule: string;
  label: string;
  /** Destination named on the ticket (`Merevia`). */
  place?: string;
  /** Last measured board → arrive time. */
  seconds?: number;
  /** What to do before the link's command (buy a pass…). */
  howTo?: string;
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
  /** Last seen only as a hidden mob (`You notice X skulking around…`). */
  hidden?: boolean;
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
  /**
   * A landmass reached only by a transit (the Merevia ship): no walking link, merge or
   * description match crosses into or out of it. Aside planes inherit it from their parent.
   */
  continent?: string;
  createdAt: string;
};

export type MapArea = {
  label: string;
  notes: string[];
  meta: Record<string, unknown>;
};

export type MapWaypoint = {
  roomId: string;
  /** Display name as typed (may differ in case from the map key). */
  label?: string;
  setAt: string;
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
  /** User labels → room id (`/wp name` then `/to name`). Keys are lowercase. */
  waypoints?: Record<string, MapWaypoint>;
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
  /* `transit` in `allowLinks` opts in to every ride link (ships); see `MapLink.transit`. */
  /** Extra cost to traverse these room ids or tags; still used when no alternate exists. */
  preferAvoid?: string[];
  /** Use inferred (unconfirmed) links (default true). */
  allowInferred?: boolean;
  /** Allow `special` (secret) exits (default true). */
  allowSpecial?: boolean;
  maxSteps?: number;
};

export type PathStep = { from: string; cmd: string; to: string; pre?: string[] };
