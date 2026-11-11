import { canonicalDirection, normalizeCommand } from "../game/directions.js";
import type { WorldMap } from "./WorldMap.js";

/**
 * Travel aliases as ground truth. A speedwalk alias (`mstonal`, `naltoms`) is a command list that
 * is known to work in the game — padded with repeats for exits that can fail and for squirrels
 * that trip you. Walked on the map, each command either follows a link from the room we are in
 * or does nothing (it was padding, or not an exit here).
 *
 * A pair `mstoX` + `Xtoms` must come back to where it started. When it does without ever having
 * to ignore a link the map offers, every link on the way is proven by the round trip. When it
 * only comes back by ignoring links, those links are the map's mistakes (a special exit recorded
 * in the wrong room sends the walk off the route). When it never comes back, the map is missing
 * a piece of the route.
 */

export type RouteStep = {
  /** Index into the command list. */
  i: number;
  cmd: string;
  from: string;
  /** Room after the command; same as `from` when it did nothing. */
  to: string;
};

export type RouteCheck = {
  /** The walk ends in the goal room (or, with no goal, somewhere on the map). */
  closed: boolean;
  /** Links the map has that the route can only work without (`room:cmd`). */
  suspects: { room: string; cmd: string; i: number }[];
  /**
   * Compass steps the map has no link for where the walk stood (a listed exit never explored, or
   * no such exit at all): the route is not fully on the map, so `suspects` prove nothing.
   */
  unexplored: { room: string; cmd: string; i: number }[];
  /** Links followed, in order. */
  taken: RouteStep[];
  end: string | null;
};

const IGNORE_LINK_COST = 1;
/**
 * A compass step with nothing behind it on the map. Aliases only pad by repeating a move, so a
 * lone compass command that goes nowhere means the map lacks that stretch; priced above ignoring
 * a link so a walk cannot cheaply "explain" a route by standing still.
 */
const MISSING_COST = 2;

/** Wire commands of a plain speedwalk alias body (`a;b;3n;c`), or null when it is a script. */
export function aliasTravelSteps(body: string): string[] | null {
  if (/[#$@%]/.test(body)) return null;
  const out: string[] = [];
  for (const part of body.replace(/^\{|\}$/g, "").split(";")) {
    const p = part.trim();
    if (!p) continue;
    const rep = p.match(/^(\d{1,2})([a-z]{1,2})$/i);
    if (rep && canonicalDirection(rep[2]!)) {
      for (let k = 0; k < Number(rep[1]); k++) out.push(rep[2]!);
    } else out.push(p);
  }
  return out.length ? out : null;
}

/** Exit key a wire command is stored under (`north` → `n`, `Enter Crack` → `enter crack`). */
function exitKey(cmd: string): string {
  const n = normalizeCommand(cmd);
  return canonicalDirection(n) ?? n;
}

/**
 * Cheapest way to read `steps` as a walk from `startId` (to `goalId` when given): follow a link
 * for free, or ignore the command — free when the room has no such link, costly when it does.
 */
export function walkAliasRoute(map: WorldMap, startId: string, steps: string[], goalId?: string): RouteCheck {
  type Cell = { cost: number; prev: string | null; moved: boolean };
  const start = map.canonicalId(startId);
  const goal = goalId ? map.canonicalId(goalId) : undefined;
  const none: RouteCheck = { closed: false, suspects: [], unexplored: [], taken: [], end: null };
  if (!start) return none;
  const layers: Map<string, Cell>[] = [new Map([[start, { cost: 0, prev: null, moved: false }]])];
  const keys = steps.map(exitKey);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const next = new Map<string, Cell>();
    const offer = (id: string, cell: Cell) => {
      const had = next.get(id);
      if (!had || cell.cost < had.cost) next.set(id, cell);
    };
    for (const [id, cell] of layers[i]!) {
      const room = map.room(id);
      if (!room) continue;
      const link = room.links[key];
      const to = link?.to && link.kind !== "teleport" ? map.canonicalId(link.to) : undefined;
      if (to && to !== id) offer(to, { cost: cell.cost, prev: id, moved: true });
      const padding = keys[i - 1] === key || keys[i + 1] === key;
      // An exit known to eat moves (`The small boy trips you!`) is what the padding is for.
      const tripped = !!link?.hindered && padding;
      const stay = to && to !== id ? (tripped ? 0 : IGNORE_LINK_COST) : canonicalDirection(key) && !padding ? MISSING_COST : 0;
      offer(id, { cost: cell.cost + stay, prev: id, moved: false });
    }
    layers.push(next);
  }
  const last = layers[keys.length]!;
  let end: string | undefined;
  if (goal) end = last.has(goal) ? goal : undefined;
  else for (const [id, c] of last) if (!end || c.cost < last.get(end)!.cost) end = id;
  if (!end) {
    // Never reaches the goal: report the plain walk (take every link) so the caller can see where it went.
    const greedy = walkAliasRoute(map, start, steps);
    return { ...greedy, closed: false };
  }
  const res: RouteCheck = { closed: true, suspects: [], unexplored: [], taken: [], end };
  let at = end;
  for (let i = keys.length; i > 0; i--) {
    const cell = layers[i]!.get(at)!;
    const from = cell.prev!;
    const key = keys[i - 1]!;
    if (cell.moved) res.taken.push({ i: i - 1, cmd: key, from, to: at });
    else {
      const room = map.room(from)!;
      const link = room.links[key];
      const padded = keys[i - 2] === key || keys[i] === key;
      if (link?.to && link.kind !== "teleport" && map.canonicalId(link.to) !== from) {
        if (!(link.hindered && padded)) res.suspects.push({ room: from, cmd: key, i: i - 1 });
      }
      else if (canonicalDirection(key) && keys[i - 2] !== key && keys[i] !== key) res.unexplored.push({ room: from, cmd: key, i: i - 1 });
    }
    at = from;
  }
  res.taken.reverse();
  res.suspects.reverse();
  res.unexplored.reverse();
  return res;
}

export type AliasPair = { place: string; out: string; back: string };

/** `<hub>to<place>` / `<place>to<hub>` alias pairs (`mstonal` + `naltoms`). */
export function aliasRoundTrips(aliases: ReadonlyMap<string, string>, hub = "ms"): AliasPair[] {
  const pairs: AliasPair[] = [];
  for (const name of aliases.keys()) {
    const m = name.toLowerCase().match(new RegExp(`^${hub}to(.+)$`));
    if (!m) continue;
    const back = [...aliases.keys()].find((k) => k.toLowerCase() === `${m[1]}to${hub}`);
    if (back) pairs.push({ place: m[1]!, out: name, back });
  }
  return pairs.sort((a, b) => a.place.localeCompare(b.place));
}

export type AliasTruthReport = {
  pairs: {
    place: string;
    out: string;
    back: string;
    /**
     * `verified`: the round trip closes following every link the map offers. `contradicted`: it
     * closes only by ignoring `suspects`. `open`: part of the route is not on the map.
     */
    status: "verified" | "contradicted" | "open" | "script";
    /** Where the outbound alias ends on the map (the place itself). */
    placeRoom?: string;
    suspects: { room: string; cmd: string }[];
    unexplored: { room: string; cmd: string }[];
    links: number;
  }[];
  /** Links newly stamped `verified: "alias"`. */
  stamped: number;
  /** Suspect self-learned secret exits removed (`apply` only). */
  removed: number;
};

/**
 * Check every round-trip alias pair anchored at `hubRoom` against the map. With `apply`, links
 * on a round trip that closes cleanly are stamped `verified: "alias"`, and a suspect link is
 * removed when it is a secret exit the mapper learned by itself (never a listed or scripted one)
 * — the route is then re-checked, so a pair can go from contradicted to verified in one run.
 */
export function checkAliasTruth(
  map: WorldMap,
  aliases: ReadonlyMap<string, string>,
  hubRoom: string,
  opts: { hub?: string; apply?: boolean } = {},
): AliasTruthReport {
  const report: AliasTruthReport = { pairs: [], stamped: 0, removed: 0 };
  for (const pair of aliasRoundTrips(aliases, opts.hub)) {
    const out = aliasTravelSteps(aliases.get(pair.out)!);
    const back = aliasTravelSteps(aliases.get(pair.back)!);
    const row: AliasTruthReport["pairs"][number] = { ...pair, status: "script", suspects: [], unexplored: [], links: 0 };
    report.pairs.push(row);
    if (!out || !back) continue;
    const steps = [...out, ...back];
    let check = walkAliasRoute(map, hubRoom, steps, hubRoom);
    for (let pass = 0; opts.apply && check.closed && check.suspects.length && !check.unexplored.length && pass < 4; pass++) {
      let dropped = 0;
      for (const s of check.suspects) {
        const room = map.room(s.room);
        const link = room?.links[s.cmd];
        if (!room || !link || canonicalDirection(s.cmd) || room.exits.includes(s.cmd)) continue;
        if (link.pre?.length || link.verified || link.kind === "teleport" || (link.confirmed && link.uses === 0)) continue;
        if (map.unlink(room.id, s.cmd)) dropped += 1;
      }
      report.removed += dropped;
      if (!dropped) break;
      check = walkAliasRoute(map, hubRoom, steps, hubRoom);
    }
    row.suspects = check.suspects.map(({ room, cmd }) => ({ room, cmd }));
    row.unexplored = check.unexplored.map(({ room, cmd }) => ({ room, cmd }));
    row.links = check.taken.length;
    row.status = !check.closed || check.unexplored.length || !check.taken.length ? "open" : check.suspects.length ? "contradicted" : "verified";
    if (check.closed) row.placeRoom = check.taken.filter((t) => t.i < out.length).at(-1)?.to;
    if (row.status !== "verified" || !opts.apply) continue;
    for (const t of check.taken) {
      const link = map.room(t.from)?.links[t.cmd];
      if (!link || link.verified) continue;
      link.verified = "alias";
      link.confirmed = true;
      delete link.contested;
      report.stamped += 1;
    }
    if (report.stamped) map.touch();
  }
  return report;
}
