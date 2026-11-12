import { canonicalExit, reverseDirection } from "../game/directions.js";
import type { MapRoom, WorldGraphDocument } from "./types.js";

/**
 * Advanced Nal Shaddar clear. Zones come from the shipped world graph.
 * The svirfneblin mine is cleared room by room. The drow priestess room is
 * part of the same complex and is never entered.
 */

const EXIT_ORDER = ["n", "ne", "e", "se", "s", "sw", "w", "nw", "u", "d"];

/** Map contents stored as npcs that are gems or ore, not something to fight. */
const NOT_MOBS = new Set([
  "amethyst",
  "diamond",
  "emerald",
  "garnet",
  "gem",
  "iron ore",
  "jade",
  "mithril ore",
  "opal",
  "pearl",
  "quartz",
  "ruby",
  "sapphire",
  "small rock",
  "topaz",
]);

const KILL_RANK = [
  "svirfneblin miner",
  "svirfneblin illusionist",
  "drow slavemaster",
  "drow bodyguard",
  "carrion crawler",
  "bat",
];

/** Preferred `kill` target when the map has seen both a plural and a lowercase alias. */
const DISPLAY_NAME: Record<string, string> = {
  bat: "Bat",
  "carrion crawler": "Carrion Crawler",
  "drow bodyguard": "Drow Bodyguard",
  "drow priestess": "Drow Priestess",
  "drow slavemaster": "Drow Slavemaster",
  "svirfneblin illusionist": "Svirfneblin Illusionist",
  "svirfneblin miner": "Svirfneblin Miner",
};

export type GrindKill = {
  /** Singular name as the map recorded it, suitable for `kill <name>`. */
  name: string;
  count: number;
};

export type GrindStep = {
  cmd: string;
  to: string;
  /** Kills for `to` the first time the walk arrives there. Empty on the way back. */
  kills: GrindKill[];
};

export type GrindZone = {
  id: string;
  label: string;
  /** First room of the clear, the mine mouth on the underdark side. */
  startId: string;
  startKills: GrindKill[];
  /** Rooms the bot kills, in walk order of first visit. */
  rooms: { id: string; kills: GrindKill[] }[];
  /** Rooms in the complex the bot must not enter. */
  skip: { id: string; why: string }[];
  /** Covering walk from `startId` through every clear room and back. */
  steps: GrindStep[];
};

function npcContents(room: MapRoom): { name: string; count: number; seen: number }[] {
  const out: { name: string; count: number; seen: number }[] = [];
  for (const c of Object.values(room.contents ?? {})) {
    if (c.kind !== "npc" || !c.name?.trim()) continue;
    out.push({ name: c.name.trim(), count: Math.max(1, c.lastCount || 1), seen: c.seenCount || 0 });
  }
  return out;
}

/** `Bats` / `Drow Slavemasters` fold into the singular. Names with a comma stay whole. */
export function mobKey(name: string): string {
  let n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n.includes(",") && n.endsWith("s") && !n.endsWith("ss")) n = n.slice(0, -1);
  return n;
}

function isPriestessRoom(room: MapRoom): boolean {
  return npcContents(room).some((c) => mobKey(c.name) === "drow priestess");
}

function isMineRoom(room: MapRoom): boolean {
  return npcContents(room).some((c) => {
    const key = mobKey(c.name);
    return key === "svirfneblin miner" || key === "svirfneblin illusionist" || key === "drow slavemaster" || key === "drow bodyguard";
  });
}

function singularName(name: string, key: string): string {
  if (name.toLowerCase() === key) return name;
  return name.replace(/s$/i, "");
}

function titleScore(name: string): number {
  return (name.match(/[A-Z]/g) ?? []).length;
}

export function killsInRoom(room: MapRoom): GrindKill[] {
  const groups = new Map<string, { name: string; count: number; seen: number; singular: boolean }>();
  for (const c of npcContents(room)) {
    const key = mobKey(c.name);
    if (NOT_MOBS.has(key)) continue;
    const singular = c.name.toLowerCase() === key;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { name: singularName(c.name, key), count: c.count, seen: c.seen, singular });
      continue;
    }
    prev.count = Math.max(prev.count, c.count);
    const name = singularName(c.name, key);
    const betterTitle = titleScore(name) > titleScore(prev.name);
    const sameTitle = titleScore(name) === titleScore(prev.name);
    if (singular && !prev.singular) prev.singular = true;
    if (betterTitle || (sameTitle && c.seen > prev.seen && (singular || !prev.singular))) {
      prev.name = name;
      prev.seen = c.seen;
    }
  }
  const kills = [...groups.entries()].map(([key, g]) => ({ key, name: g.name, count: g.count }));
  kills.sort((a, b) => {
    const ia = KILL_RANK.indexOf(a.key);
    const ib = KILL_RANK.indexOf(b.key);
    const oa = ia === -1 ? 100 : ia;
    const ob = ib === -1 ? 100 : ib;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });
  return kills.map(({ key, name, count }) => ({ name: DISPLAY_NAME[key] ?? name, count }));
}

function exits(room: MapRoom): { cmd: string; to: string }[] {
  const out: { cmd: string; to: string }[] = [];
  for (const [cmd, link] of Object.entries(room.links ?? {})) {
    if (!link.to || link.blocked) continue;
    out.push({ cmd: canonicalExit(cmd), to: link.to });
  }
  out.sort((a, b) => {
    const ia = EXIT_ORDER.indexOf(a.cmd);
    const ib = EXIT_ORDER.indexOf(b.cmd);
    const oa = ia === -1 ? 100 : ia;
    const ob = ib === -1 ? 100 : ib;
    if (oa !== ob) return oa - ob;
    return a.cmd.localeCompare(b.cmd) || a.to.localeCompare(b.to);
  });
  return out;
}

function backCommand(doc: WorldGraphDocument, fromId: string, toId: string, cameBy: string): string {
  const room = doc.rooms[fromId];
  if (!room) throw new Error(`missing room ${fromId}`);
  const rev = reverseDirection(canonicalExit(cameBy));
  if (rev) {
    for (const [cmd, link] of Object.entries(room.links ?? {})) {
      if (canonicalExit(cmd) === rev && link.to === toId && !link.blocked) return rev;
    }
  }
  for (const step of exits(room)) {
    if (step.to === toId) return step.cmd;
  }
  throw new Error(`no way back from ${fromId} to ${toId}`);
}

/**
 * Svirfneblin mine: every room of the miner complex, reached from the rooms
 * that actually contain miners. The drow priestess room stays on the skip list
 * and is not a step of the walk.
 */
export function svirfneblinMineZone(doc: WorldGraphDocument): GrindZone {
  const mine = new Set<string>();
  const skip = new Map<string, string>();
  const queue: string[] = [];
  for (const room of Object.values(doc.rooms)) {
    if (isPriestessRoom(room)) continue;
    if (!npcContents(room).some((c) => mobKey(c.name) === "svirfneblin miner")) continue;
    mine.add(room.id);
    queue.push(room.id);
  }
  while (queue.length) {
    const id = queue.shift()!;
    const room = doc.rooms[id];
    if (!room) continue;
    for (const step of exits(room)) {
      const dest = doc.rooms[step.to];
      if (!dest) continue;
      if (isPriestessRoom(dest)) {
        skip.set(dest.id, "Drow Priestess");
        continue;
      }
      if (mine.has(dest.id)) continue;
      if (dest.area && dest.area !== "underdark") continue;
      if (!isMineRoom(dest)) continue;
      mine.add(dest.id);
      queue.push(dest.id);
    }
  }

  let startId: string | null = null;
  let startUses = -1;
  for (const id of mine) {
    const room = doc.rooms[id];
    if (!room) continue;
    for (const [cmd, link] of Object.entries(room.links ?? {})) {
      if (!link.to || link.blocked || mine.has(link.to) || skip.has(link.to)) continue;
      const uses = link.uses ?? 0;
      if (uses > startUses || (uses === startUses && (startId === null || id < startId))) {
        startUses = uses;
        startId = id;
        void cmd;
      }
    }
  }
  if (!startId) throw new Error("svirfneblin mine has no entrance");

  const killsOf = (id: string): GrindKill[] => killsInRoom(doc.rooms[id]!);
  const visited = new Set<string>();
  const steps: GrindStep[] = [];
  const visitOrder: string[] = [];

  const dfs = (id: string): void => {
    visited.add(id);
    visitOrder.push(id);
    for (const step of exits(doc.rooms[id]!)) {
      if (!mine.has(step.to) || visited.has(step.to) || skip.has(step.to)) continue;
      steps.push({ cmd: step.cmd, to: step.to, kills: killsOf(step.to) });
      dfs(step.to);
      steps.push({ cmd: backCommand(doc, step.to, id, step.cmd), to: id, kills: [] });
    }
  };
  dfs(startId);

  return {
    id: "svirfneblin-mine",
    label: "Svirfneblin mine",
    startId,
    startKills: killsOf(startId),
    rooms: visitOrder.map((id) => ({ id, kills: killsOf(id) })),
    skip: [...skip.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, why]) => ({ id, why })),
    steps,
  };
}

/** Zones the advanced Nal Shaddar bot clears. */
export function advancedNalShaddarZones(doc: WorldGraphDocument): GrindZone[] {
  return [svirfneblinMineZone(doc)];
}

/** Commands for one pass: kill the mine mouth, walk the covering route, kill on each first visit. */
export function clearCommands(zone: GrindZone): string[] {
  const cmds = killCommands(zone.startKills);
  for (const step of zone.steps) {
    cmds.push(step.cmd);
    cmds.push(...killCommands(step.kills));
  }
  return cmds;
}

/** `kill` lines for one room, one per mob the map last counted there. */
export function killCommands(kills: readonly GrindKill[]): string[] {
  const cmds: string[] = [];
  for (const k of kills) {
    for (let i = 0; i < k.count; i++) cmds.push(`kill ${k.name}`);
  }
  return cmds;
}

/** Movement-only covering walk, with repeated compass steps collapsed (`e,e,e` → `3e`). */
export function mineSpeedwalk(zone: GrindZone): string {
  const cmds = zone.steps.map((s) => s.cmd);
  const parts: string[] = [];
  let i = 0;
  while (i < cmds.length) {
    let n = 1;
    const cmd = cmds[i]!;
    const short = EXIT_ORDER.includes(cmd);
    while (short && i + n < cmds.length && cmds[i + n] === cmd) n++;
    parts.push(n > 1 ? `${n}${cmd}` : cmd);
    i += n;
  }
  const lines: string[] = [];
  let line = "";
  for (const part of parts) {
    const next = line ? `${line},${part}` : part;
    if (next.length > 76 && line) {
      lines.push(line);
      line = part;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.join(",\n");
}
