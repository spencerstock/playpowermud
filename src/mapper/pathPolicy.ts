import type { PathOptions } from "./types.js";

/** Dijkstra step cost added when entering a `preferAvoid` room or tag match. */
export const PREFER_AVOID_ROOM_COST = 40;

const globalPreferAvoid: string[] = [];

/**
 * Link commands no path takes unless the request opts in with `allowLinks` (Spencer 2026-10-31).
 * - `touch red stone`: the Assassin's Guild meeting room teleporter (Kalinport) drops you in
 *   Dunagin with no mapped way back; Zurker's sneak-training walk took it twice.
 * - `homeland`: a teleport to Kalinport that only works under 5k exp; the mapper records it as a
 *   link from wherever it was typed, so it is never a real exit.
 */
export const NEVER_PATH_LINKS: readonly RegExp[] = [/^touch\s+(?:the\s+)?(?:red\s+)?stone$/i, /^homeland$/i];

/** True when `cmd` (from `roomId`) is a never-path link that `allowLinks` does not opt in to. */
export function linkNeverPathed(roomId: string, cmd: string, allowLinks?: readonly string[]): boolean {
  const c = cmd.trim().toLowerCase().replace(/\s+/g, " ");
  if (!NEVER_PATH_LINKS.some((re) => re.test(c))) return false;
  if (!allowLinks?.length) return true;
  return !allowLinks.some((a) => {
    const x = a.trim().toLowerCase().replace(/\s+/g, " ");
    return x === "*" || x === c || x === `${roomId.toLowerCase()}:${c}`;
  });
}

/** Optional hub-wide soft avoids (empty by default). */
export function setGlobalPreferAvoid(ids: readonly string[]): void {
  globalPreferAvoid.length = 0;
  globalPreferAvoid.push(...ids);
}

export function globalPreferAvoidIds(): readonly string[] {
  return globalPreferAvoid;
}

function mergeUnique(...lists: (readonly string[] | undefined)[]): string[] | undefined {
  const out = new Set<string>();
  for (const list of lists) {
    if (!list?.length) continue;
    for (const id of list) out.add(id);
  }
  return out.size ? [...out] : undefined;
}

function pickPathFields(opts: PathOptions): PathOptions {
  const out: PathOptions = {};
  if (opts.maxDanger !== undefined) out.maxDanger = opts.maxDanger;
  if (opts.avoid?.length) out.avoid = opts.avoid;
  if (opts.avoidLinks?.length) out.avoidLinks = opts.avoidLinks;
  if (opts.allowLinks?.length) out.allowLinks = opts.allowLinks;
  const preferAvoid = mergeUnique(globalPreferAvoid, opts.preferAvoid);
  if (preferAvoid?.length) out.preferAvoid = preferAvoid;
  if (opts.allowInferred === false) out.allowInferred = false;
  if (opts.allowSpecial === false) out.allowSpecial = false;
  if (opts.maxSteps !== undefined) out.maxSteps = opts.maxSteps;
  return out;
}

/**
 * Single path policy for bots, agents, CLI, and API: the world graph only, unless the caller
 * passes explicit `avoid` / `preferAvoid` on this request.
 */
export function resolvePathOptions(extra: PathOptions = {}): PathOptions {
  return pickPathFields(extra);
}

/** Default bot/automation pathing (topology + optional danger cap). */
export function botPathOptions(maxDanger?: number, extra: PathOptions = {}): PathOptions {
  return resolvePathOptions({ maxDanger, ...extra });
}
