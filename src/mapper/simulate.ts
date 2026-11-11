import { DIRECTION_VECTORS, isGeometricDirection, longDirection, reverseDirection } from "../game/directions.js";
import { GameStream } from "../game/stream.js";
import { Mapper } from "./Mapper.js";
import { WorldMap } from "./WorldMap.js";

/**
 * Synthetic Powermud-shaped world + noisy walker for measuring mapper accuracy against
 * ground truth. The world mixes what makes real mapping hard: streets that share a title,
 * uniform forest grids, look-alike swamp corridors, a warped (non-euclidean) trail,
 * named exits, doors that hide exits, MUD-side speedwalk aliases (one command, many rooms),
 * unannounced moves, teleports and missed room displays. Mazes of identical rooms are left
 * out: text alone cannot tell them apart.
 */

type SimRoom = {
  id: string;
  title: string;
  desc: string;
  exits: Record<string, string>;
  /** Exits only listed while the door is open. */
  door?: string;
  mob?: string;
};

export type SimWorld = { rooms: Record<string, SimRoom>; start: string };

export type SimOptions = {
  seed?: number;
  steps?: number;
  /** Chance a room display is lost (scrolled away / swallowed by spam). */
  dropRate?: number;
  /** Chance per step of being moved without a command (dragged, summoned). */
  driftRate?: number;
  /** Chance per step of a speedwalk alias. */
  aliasRate?: number;
  /** Mapper trace lines, with the true room at that moment. */
  debug?: (msg: string, truth: string) => void;
};

export type SimScore = {
  trueRooms: number;
  mapRooms: number;
  /** Steps where the mapper's position is the map room that stands for the true room. */
  positionAccuracy: number;
  /** True rooms represented by more than one map room. */
  duplicated: number;
  /** Map rooms that stand for more than one true room. */
  conflated: number;
  /** Map rooms never occupied while the true room was known (created then abandoned). */
  ghosts: number;
  linksCorrect: number;
  linksWrong: number;
  /** Geometric links whose endpoints sit on the same plane at the wrong offset. */
  geometryBroken: number;
  planes: number;
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOREST_DESC = [
  "Tall pines crowd close on every side and the needles muffle your footsteps on the forest floor.",
  "The forest is dim and quiet here, the canopy so thick that little light reaches the mossy ground.",
  "Ferns and brambles choke the spaces between the old oaks of this part of the forest.",
];
const SWAMP_DESC = "Black water seeps around your boots and the smell of rot hangs heavy in the humid air of the swamp.";

export function buildSimWorld(seed = 1): SimWorld {
  const rand = rng(seed);
  const rooms: Record<string, SimRoom> = {};
  const add = (id: string, title: string, desc: string, mob?: string) => {
    rooms[id] = { id, title, desc, exits: {}, mob };
    return rooms[id]!;
  };
  const join = (a: string, dir: string, b: string) => {
    rooms[a]!.exits[dir] = b;
    const rev = reverseDirection(dir);
    if (rev) rooms[b]!.exits[rev] = a;
  };

  // Town: a 7x7 street grid. Streets share titles; the square and shops are unique.
  const cell = (x: number, y: number) => `t${x}_${y}`;
  for (let x = 0; x < 7; x++) {
    for (let y = 0; y < 7; y++) {
      const onRow = y % 3 === 0;
      const onCol = x % 3 === 0;
      if (!onRow && !onCol) continue;
      const title = x === 3 && y === 3 ? "Threshold Main Square" : onRow ? (y === 0 ? "Frontiers Street" : y === 3 ? "Market Street" : "Harbor Street") : "Gateway Road";
      const desc = `${title === "Threshold Main Square" ? "A wide square with a dry fountain at its heart." : `The ${title.toLowerCase()} continues, its cobbles worn smooth.`} Block ${x},${y} of the old town, where ${["merchants", "beggars", "guards", "children", "pilgrims", "sailors", "cats"][(x * 7 + y) % 7]} gather.`;
      add(cell(x, y), title, desc, x === 3 && y === 3 ? "d/std/mon/tguard" : undefined);
    }
  }
  for (let x = 0; x < 7; x++) {
    for (let y = 0; y < 7; y++) {
      if (!rooms[cell(x, y)]) continue;
      if (rooms[cell(x + 1, y)] && y % 3 === 0) join(cell(x, y), "e", cell(x + 1, y));
      if (rooms[cell(x, y + 1)] && x % 3 === 0) join(cell(x, y), "n", cell(x, y + 1));
    }
  }
  const shops = ["Supply Depot", "Church of Kertaine", "House of Demetrii", "Weaponsmith", "Tavern", "Bank of Threshold", "Guild Hall", "Stables"];
  shops.forEach((name, i) => {
    const host = cell(1 + (i % 2) * 3, [0, 3, 6, 0][i >> 1]!);
    const dir = i < 4 || i >= 6 ? (i >= 6 ? "n" : "s") : "n";
    const id = `shop${i}`;
    add(id, name, `The ${name.toLowerCase()} is a busy place, full of the noise of trade and the smell of ${["tallow", "incense", "dust", "oil", "ale", "coin", "parchment", "hay"][i]}.`);
    if (rooms[host]!.exits[dir]) return;
    join(host, dir, id);
  });
  // Church has stairs up to a belfry.
  add("belfry", "Belfry", "A cramped belfry; a great bronze bell hangs silent above the trapdoor in the floor.");
  join("shop1", "u", "belfry");

  // Forest: 9x9 uniform grid south-west of town with pruned exits (kept connected).
  const fcell = (x: number, y: number) => `f${x}_${y}`;
  for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) add(fcell(x, y), y < 4 ? "Forest" : "Deep Forest", FOREST_DESC[(x + 2 * y) % 3]!);
  const parent = new Map<string, string>();
  const find = (k: string): string => (parent.get(k) === k || !parent.has(k) ? k : find(parent.get(k)!));
  const edges: [string, string, string][] = [];
  for (let x = 0; x < 9; x++) {
    for (let y = 0; y < 9; y++) {
      if (x < 8) edges.push([fcell(x, y), "e", fcell(x + 1, y)]);
      if (y < 8) edges.push([fcell(x, y), "n", fcell(x, y + 1)]);
      if (x < 8 && y < 8 && rand() < 0.15) edges.push([fcell(x, y), "ne", fcell(x + 1, y + 1)]);
    }
  }
  edges.sort(() => rand() - 0.5);
  for (const [a, d, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
      join(a, d, b);
    } else if (rand() < 0.45) join(a, d, b);
  }
  join(cell(0, 0), "w", fcell(8, 8));

  // Swamp: a winding corridor of identical rooms east of town, ending at a lair.
  let prev = cell(6, 3);
  let dir = "e";
  for (let i = 0; i < 14; i++) {
    const id = `sw${i}`;
    add(id, "Swamp", SWAMP_DESC, i % 5 === 2 ? "d/std/swamp/mon/lizard_man_move" : undefined);
    join(prev, dir, id);
    prev = id;
    dir = rand() < 0.6 ? "e" : rand() < 0.5 ? "ne" : "se";
  }
  add("lair", "Dragon's lair", "Bones and melted armor litter the floor of this vast cavern; the air shimmers with heat.", "d/std/mon/dragon");
  rooms[prev]!.exits.lair = "lair";
  rooms.lair!.exits.out = prev;
  add("lair2", "Dragon's lair", "Deeper in the lair the heat is unbearable and a mound of gold glitters in the dark.");
  join("lair", "w", "lair2");

  // Warped trail north of town: one `n` covers several rooms' worth of ground.
  add("trail0", "Mountain Trail", "A narrow trail switchbacks up the mountainside; far below, the town smokes.");
  add("trail1", "Mountain Trail", "The trail levels out onto a windswept saddle between two peaks.");
  add("summit", "Summit", "The summit is bare rock. You can see the whole valley, the swamp and the forest from here.");
  join(cell(3, 6), "n", "trail0");
  join("trail0", "n", "trail1");
  join("trail1", "ne", "summit");
  // The trail drops straight back down to the harbor end of town (non-euclidean).
  rooms.summit!.exits.d = cell(6, 6);
  rooms[cell(6, 6)]!.exits.u = "summit";

  // Tavern cellar behind a door (exit only listed while open).
  add("cellar", "Tavern Cellar", "Barrels of ale are stacked to the ceiling of this damp cellar.");
  join("shop4", "d", "cellar");
  rooms.shop4!.door = "d";

  return { rooms, start: cell(3, 3) };
}

function listedExits(room: SimRoom, doorOpen: boolean): string[] {
  return Object.keys(room.exits).filter((e) => doorOpen || e !== room.door);
}

function brief(room: SimRoom, doorOpen: boolean): string {
  const mob = room.mob ? `There is one Monster (${room.mob}#${Math.floor(Math.random() * 9000) + 1000}).\n` : "";
  return `${room.title} (${listedExits(room, doorOpen).join(", ")})\n${mob}`;
}

function verbose(room: SimRoom, doorOpen: boolean): string {
  const ex = listedExits(room, doorOpen).map((e) => (isGeometricDirection(e) ? longDirection(e) : e));
  const lines = room.desc.match(/.{1,74}(\s|$)/g)!.map((l) => l.trim());
  return `${lines.join("\n")}\nThe only obvious exits are : ${ex.join(", ")}.\n`;
}

function bfsPath(world: SimWorld, from: string, to: string): string[] | null {
  const prev = new Map<string, [string, string]>();
  const seen = new Set([from]);
  let layer = [from];
  while (layer.length) {
    const next: string[] = [];
    for (const r of layer) {
      for (const [d, t] of Object.entries(world.rooms[r]!.exits)) {
        if (seen.has(t) || d === world.rooms[r]!.door) continue;
        seen.add(t);
        prev.set(t, [r, d]);
        if (t === to) {
          const out: string[] = [];
          let at = to;
          while (at !== from) {
            const [p, dd] = prev.get(at)!;
            out.unshift(dd);
            at = p;
          }
          return out;
        }
        next.push(t);
      }
    }
    layer = next;
  }
  return null;
}

/**
 * A simulated MUD connection: `command` sends one wire command, feeds the reply to the
 * mapper like the live hub does, and returns the reply text.
 */
export type SimSession = {
  world: SimWorld;
  map: WorldMap;
  mapper: Mapper;
  trace: { truth: string; at: string | null }[];
  /** True room id. */
  here(): string;
  command(cmd: string, sent?: boolean): string;
  /** Unprompted output (drags, drifts). */
  emit(text: string): void;
  /** A command the hub sees whose effects the MUD shows later (MUD-side alias). */
  announce(cmd: string): void;
  /** Move the character without telling the mapper. */
  place(roomId: string): void;
  doorOpen(): boolean;
};

const PROMPT = "[HP:100 SP:50]";

export function simSession(
  world: SimWorld,
  map: WorldMap,
  opts: Pick<SimOptions, "dropRate" | "debug" | "seed"> & { rand?: () => number } = {},
): SimSession {
  const rand = opts.rand ?? rng((opts.seed ?? 1) * 104729 + 11);
  const mapper = new Mapper(map);
  const stream = new GameStream();
  const trace: SimSession["trace"] = [];
  let t = 0;
  let here = world.start;
  if (opts.debug) mapper.debug = (msg) => opts.debug!(msg, here);
  let doorOpen = false;
  const feed = (text: string) => {
    for (const ev of [...stream.feed(text), ...stream.settle()]) mapper.onGameEvent(ev, t);
  };
  const show = (verboseMode = false) => {
    if (rand() < (opts.dropRate ?? 0)) return "";
    const r = world.rooms[here]!;
    return verboseMode ? verbose(r, doorOpen) : brief(r, doorOpen);
  };
  /** One wire command and the MUD's reply (room display + prompt). */
  const command = (cmd: string, sent = true): string => {
    t += 900;
    if (sent) mapper.onCommandSent(cmd, t);
    const room = world.rooms[here]!;
    let out = "";
    if (cmd === "look" || cmd === "l") out = show(true);
    else if (cmd === "open door") {
      doorOpen = true;
      out = "You open the door.\n";
    } else if (cmd === "recall") {
      here = world.start;
      out = `You pray to the gods and are whisked away.\n${show()}`;
    } else if (cmd === "smile") out = "You smile happily.\n";
    else {
      const to = room.exits[cmd];
      if (!to || (cmd === room.door && !doorOpen)) out = "You cannot go that direction.\n";
      else {
        here = to;
        doorOpen = false;
        out = show();
      }
    }
    feed(`${out}${PROMPT}`);
    trace.push({ truth: here, at: mapper.position });
    return out;
  };
  const emit = (text: string) => {
    t += 900;
    feed(`${text}${PROMPT}`);
    trace.push({ truth: here, at: mapper.position });
  };
  return {
    world,
    map,
    mapper,
    trace,
    here: () => here,
    command,
    emit,
    announce: (cmd) => {
      t += 900;
      mapper.onCommandSent(cmd, t);
    },
    place: (roomId) => {
      here = roomId;
      doorOpen = false;
    },
    doorOpen: () => doorOpen,
  };
}

export type SimRun = {
  world: SimWorld;
  map: WorldMap;
  mapper: Mapper;
  trace: { truth: string; at: string | null }[];
  session: SimSession;
};

/** Walk the world with a noisy agent, feeding the mapper exactly like the live hub does. */
export function runSimulation(opts: SimOptions = {}, map = WorldMap.empty("sim")): SimRun {
  const seed = opts.seed ?? 1;
  const rand = rng(seed * 7919 + 3);
  const world = buildSimWorld(seed);
  const session = simSession(world, map, { ...opts, rand });
  const { mapper, trace, command } = session;
  const here = () => session.here();
  const doorOpen = () => session.doorOpen();
  const show = () => {
    if (rand() < (opts.dropRate ?? 0)) return "";
    return brief(world.rooms[here()]!, doorOpen());
  };

  session.emit(brief(world.rooms[here()]!, doorOpen()));
  const visits = new Map<string, number>();
  const steps = opts.steps ?? 1500;
  for (let i = 0; i < steps; i++) {
    const roll = rand();
    const room = world.rooms[here()]!;
    if (roll < (opts.aliasRate ?? 0)) {
      // MUD-side speedwalk: the hub only sees the alias name; the MUD shows every room.
      const ids = Object.keys(world.rooms);
      const goal = ids[Math.floor(rand() * ids.length)]!;
      const path = bfsPath(world, here(), goal);
      if (!path || path.length < 2) continue;
      session.announce(`msto${goal}`);
      for (const d of path) command(d, false);
      continue;
    }
    if (roll < (opts.aliasRate ?? 0) + (opts.driftRate ?? 0)) {
      const exits = listedExits(room, doorOpen());
      const d = exits[Math.floor(rand() * exits.length)];
      if (d) {
        session.place(room.exits[d]!);
        session.emit(`A strong current drags you ${d}.\n${show()}`);
      }
      continue;
    }
    if (roll < 0.1) {
      command("look");
      continue;
    }
    if (roll < 0.12) {
      command("recall");
      continue;
    }
    if (roll < 0.14) {
      command("smile");
      continue;
    }
    if (roll < 0.16) {
      command(["n", "s", "e", "w"][Math.floor(rand() * 4)]!);
      continue;
    }
    if (room.door && !doorOpen() && rand() < 0.5) {
      command("open door");
      continue;
    }
    // Prefer less-visited neighbors so the walk covers the world.
    const exits = listedExits(room, doorOpen());
    exits.sort((a, b) => (visits.get(room.exits[a]!) ?? 0) - (visits.get(room.exits[b]!) ?? 0) + (rand() - 0.5) * 3);
    const d = exits[0];
    if (!d) continue;
    visits.set(room.exits[d]!, (visits.get(room.exits[d]!) ?? 0) + 1);
    command(d);
  }
  return { world, map, mapper, trace, session };
}

/** Compare the built map with the true world. */
export function scoreSimulation(run: SimRun): SimScore {
  const { map, world, trace } = run;
  // Votes: which true room each map room stood for while we were there.
  const votes = new Map<string, Map<string, number>>();
  for (const s of trace) {
    const id = map.canonicalId(s.at);
    if (!id) continue;
    let v = votes.get(id);
    if (!v) votes.set(id, (v = new Map()));
    v.set(s.truth, (v.get(s.truth) ?? 0) + 1);
  }
  const truthOf = new Map<string, string>();
  let conflated = 0;
  for (const [id, v] of votes) {
    const sorted = [...v.entries()].sort((a, b) => b[1] - a[1]);
    truthOf.set(id, sorted[0]![0]);
    const total = sorted.reduce((n, [, c]) => n + c, 0);
    if (sorted.length > 1 && sorted[1]![1] >= Math.max(2, total * 0.2)) conflated += 1;
  }
  const reps = new Map<string, number>();
  for (const tr of truthOf.values()) reps.set(tr, (reps.get(tr) ?? 0) + 1);
  const duplicated = [...reps.values()].filter((n) => n > 1).length;
  // The representative of a true room is its most-voted map room.
  const repOf = new Map<string, { id: string; n: number }>();
  for (const [id, v] of votes) {
    const tr = truthOf.get(id)!;
    const n = v.get(tr)!;
    if (!repOf.has(tr) || repOf.get(tr)!.n < n) repOf.set(tr, { id, n });
  }
  let good = 0;
  let total = 0;
  for (const s of trace) {
    total += 1;
    const id = map.canonicalId(s.at);
    if (id && repOf.get(s.truth)?.id === id) good += 1;
  }
  let linksCorrect = 0;
  let linksWrong = 0;
  let geometryBroken = 0;
  for (const r of map.rooms()) {
    const tr = truthOf.get(r.id);
    for (const [cmd, link] of Object.entries(r.links)) {
      if (!link.to) continue;
      const to = map.room(link.to);
      if (!to) continue;
      const tt = truthOf.get(to.id);
      if (tr && tt) {
        if (world.rooms[tr]!.exits[cmd] === tt) linksCorrect += 1;
        else linksWrong += 1;
      }
      const v = DIRECTION_VECTORS[cmd];
      if (v && to.pos.plane === r.pos.plane) {
        if (to.pos.x - r.pos.x !== v.x || to.pos.y - r.pos.y !== v.y || to.pos.z - r.pos.z !== v.z) geometryBroken += 1;
      }
    }
  }
  return {
    trueRooms: new Set(trace.map((s) => s.truth)).size,
    mapRooms: map.roomCount(),
    positionAccuracy: total ? good / total : 0,
    duplicated,
    conflated,
    ghosts: map.rooms().filter((r) => !votes.has(r.id)).length,
    linksCorrect,
    linksWrong,
    geometryBroken,
    planes: Object.keys(map.doc.planes).length,
  };
}
