import type { PathOptions } from "./types.js";

/** Dijkstra step cost added when entering a `preferAvoid` room or tag match. */
export const PREFER_AVOID_ROOM_COST = 40;

const globalPreferAvoid: string[] = [];

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
