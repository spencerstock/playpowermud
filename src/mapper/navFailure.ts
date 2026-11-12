import { isGeometricDirection } from "../game/directions.js";
import { variableTime } from "../scripting/variableTime.js";
import { flakyBatchRepeatFromCatalog } from "./flakyTravelCatalog.js";
import { BLOCK_AFTER_CONSECUTIVE_FAILS, type NavFailureResult, type WorldMap } from "./WorldMap.js";
import type { MapLink, MapRoom } from "./types.js";

export type FlakyTravelContext = {
  fromId: string;
  map: {
    room(id: string): MapRoom | undefined;
    canonicalId(id: string): string | undefined;
  };
};

export type MoveSendResult = { error?: string; output: string };

/** Max tries per step for skill/RNG travel verbs (see Powermud `*toms` speedwalk aliases). */
export const FLAKY_MOVE_MAX_ATTEMPTS = 16;
/** Tries per walk step for an ordinary exit before the walk reroutes. */
export const COMPASS_MOVE_MAX_ATTEMPTS = 3;
/** Tries for an exit where moves get eaten (`MapLink.hindered`, the Kulajo small boy's trips). */
export const HINDERED_MOVE_MAX_ATTEMPTS = 8;

const MOVE_FAILED_RE =
  /cannot go that direction|can't go that way|alas, you cannot|too busy fighting|in your way|trips you|tripping you|can't move|you fail to climb|you are unable to climb|you fail to enter|you are unable to enter|you slip|lose your grip|you can't reach|you cannot reach|find nothing|search reveals nothing/i;

export function outputSaysMoveFailed(output: string): boolean {
  return MOVE_FAILED_RE.test(output);
}

function hasAsideFailureEvidence(cmd: string, link?: Pick<MapLink, "failCount" | "blocked">): boolean {
  if ((link?.failCount ?? 0) > 0) return true;
  if (link?.blocked) return true;
  const t = cmd.trim();
  if (flakyBatchRepeatFromCatalog(t) !== undefined) return true;
  return FLAKY_TRAVEL_RE.some((re) => re.test(t));
}

/** True when no link from the destination room leads back to `fromId`. */
export function isOneWayAsideExit(ctx: FlakyTravelContext, link: Pick<MapLink, "to">): boolean {
  const toId = link.to;
  if (!toId) return false;
  const dest = ctx.map.room(toId);
  if (!dest) return true;
  const fromCanon = ctx.map.canonicalId(ctx.fromId) ?? ctx.fromId;
  for (const back of Object.values(dest.links)) {
    if (!back.to) continue;
    if ((ctx.map.canonicalId(back.to) ?? back.to) === fromCanon) return false;
  }
  return true;
}

/**
 * Non-compass exits that often need repeated sends (Powermud nav alias streaks — see flakyTravelCatalog).
 * Listed **special** / **named** map links only retry when the hop is one-way and we have failure evidence
 * (prior fail/blocked, catalog, or skill/RNG verb patterns). Unknown commands still use catalog/heuristics.
 */
export function isFlakyTravelCommand(
  cmd: string,
  link?: Pick<MapLink, "kind" | "failCount" | "blocked" | "to"> & Partial<MapLink>,
  ctx?: FlakyTravelContext,
): boolean {
  const t = cmd.trim();
  if (!t || isGeometricDirection(t)) return false;
  if (link?.kind === "special" || link?.kind === "named") {
    if (!ctx || !link.to || !hasAsideFailureEvidence(t, link)) return false;
    return isOneWayAsideExit(ctx, link);
  }
  if (flakyBatchRepeatFromCatalog(t) !== undefined) return true;
  return FLAKY_TRAVEL_RE.some((re) => re.test(t));
}

/** Verb patterns for travel hops that appear in nav aliases (including non-streaked steps like `enter hole`). */
const FLAKY_TRAVEL_RE = [
  /^(?:enter|climb|leap|search|dive|crawl|slide|descend|swim|gate|grab|go into|stand on|pry|pull|force|gangplank)\b/i,
  /^push .+ wall$/i,
  /^move (?:north|south|east|west|northeast|northwest|southeast|southwest)$/i,
  /^lrclimb/i,
];

export function moveMaxAttempts(cmd: string, link?: MapLink, priorFailures = 0, ctx?: FlakyTravelContext): number {
  if (isFlakyTravelCommand(cmd, link, ctx)) return FLAKY_MOVE_MAX_ATTEMPTS;
  // Trips are not refusals: the exit works, it just takes a few tries.
  if ((link?.hindered ?? 0) > 0) return HINDERED_MOVE_MAX_ATTEMPTS;
  // A few tries, then let this walk reroute. The streak stays on the link, so a later walk
  // retries it until BLOCK_AFTER_CONSECUTIVE_FAILS blocks it.
  return Math.max(1, Math.min(COMPASS_MOVE_MAX_ATTEMPTS, BLOCK_AFTER_CONSECUTIVE_FAILS - priorFailures));
}

/** Extra sends in speedwalk (`batch`) mode — mirrors nav alias streak lengths when known. */
export function flakyBatchRepeatCount(cmd: string, link?: MapLink, ctx?: FlakyTravelContext): number {
  if (!isFlakyTravelCommand(cmd, link, ctx)) return 1;
  const fromCatalog = flakyBatchRepeatFromCatalog(cmd);
  if (fromCatalog !== undefined) return fromCatalog;
  const t = cmd.trim();
  if (/^climb\b|^descend\b/i.test(t)) return 8;
  if (/^move /i.test(t)) return 10;
  if (/^push .+ wall$/i.test(t)) return 6;
  if (/^search /i.test(t)) return 3;
  if (/^(?:enter|leap|dive|swim)\b/i.test(t)) return 4;
  return 4;
}

export type RetryCompassMoveResult = {
  ok: boolean;
  result: MoveSendResult;
  healed?: boolean;
  detail?: string;
  failures?: number;
};

const SILENT_MOVE_FAIL_MAX = 2;

/** Wait between retries of a link that just failed, so a stuck exit is not spammed. */
export const LINK_RETRY_PAUSE_MS = 1000;

export async function pauseBetweenLinkRetries(pause?: (ms: number) => Promise<void>): Promise<void> {
  if (pause) {
    await pause(LINK_RETRY_PAUSE_MS);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, variableTime(LINK_RETRY_PAUSE_MS)));
}

function firstFailureLine(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line ? line.slice(0, 160) : "did not move";
}

/**
 * Count a failed move the mapper did not already record during `send` (it increments
 * `failCount` itself for profile `moveFailed` lines). `did not move` and other
 * {@link outputSaysMoveFailed} lines (`in your way`, trips, …) share that counter.
 * Does not remove the link — a real exit stays until it is blocked at the streak threshold.
 */
export function recordUncountedMoveFailure(
  map: WorldMap,
  fromId: string,
  cmd: string,
  last: MoveSendResult,
  failCountBefore: number,
): NavFailureResult | undefined {
  const live = map.room(fromId)?.links[cmd];
  const after = live?.failCount ?? 0;
  if (!live && failCountBefore > 0) return { failures: failCountBefore, healed: true, detail: `link ${cmd} removed` };
  if (after > failCountBefore) return undefined;
  if (last.error?.trim()) return undefined;
  const recognized = outputSaysMoveFailed(last.output);
  if (!recognized && !last.output.trim()) return undefined;
  const reason = recognized ? firstFailureLine(last.output) : "did not move";
  const noted = map.noteConsecutiveFailure(fromId, cmd, reason);
  return { failures: noted.failures, healed: false };
}

function shouldAbortMoveRetry(last: MoveSendResult, attempt: number): boolean {
  if (last.error?.trim()) return true;
  const out = last.output.trim();
  if (outputSaysMoveFailed(out)) return false;
  if (!out && attempt + 1 >= SILENT_MOVE_FAIL_MAX) return true;
  return false;
}

/** Send a move repeatedly until the room changes or attempts are exhausted; heal phantom compass links when appropriate. */
export async function retryCompassMove(opts: {
  fromId: string;
  cmd: string;
  map: WorldMap;
  maxAttempts?: number;
  send: () => Promise<MoveSendResult>;
  moved: () => boolean;
  shouldAbort?: () => boolean;
  /** Test hook. Production waits {@link LINK_RETRY_PAUSE_MS} between failed tries. */
  pause?: (ms: number) => Promise<void>;
  /** The caller already sent this command once and it failed. */
  pauseBeforeFirst?: boolean;
}): Promise<RetryCompassMoveResult> {
  const link = opts.map.room(opts.fromId)?.links[opts.cmd];
  const flakyCtx: FlakyTravelContext = { map: opts.map, fromId: opts.fromId };
  const max = opts.maxAttempts ?? moveMaxAttempts(opts.cmd, link, 0, flakyCtx);
  let last: MoveSendResult = { output: "" };
  for (let attempt = 0; attempt < max; attempt++) {
    if (opts.shouldAbort?.()) {
      return { ok: false, result: last, detail: "aborted" };
    }
    if (attempt > 0 || opts.pauseBeforeFirst) await pauseBetweenLinkRetries(opts.pause);
    if (opts.shouldAbort?.()) {
      return { ok: false, result: last, detail: "aborted" };
    }
    const failCountBefore = opts.map.room(opts.fromId)?.links[opts.cmd]?.failCount ?? 0;
    last = await opts.send();
    if (opts.shouldAbort?.()) {
      return { ok: false, result: last, detail: "aborted" };
    }
    if (opts.moved()) {
      opts.map.clearConsecutiveFailures(opts.fromId, opts.cmd);
      return { ok: true, result: last };
    }

    if (shouldAbortMoveRetry(last, attempt)) {
      return { ok: false, result: last, detail: last.error ?? "silent move failure" };
    }

    const rec = recordUncountedMoveFailure(opts.map, opts.fromId, opts.cmd, last, failCountBefore);
    if (rec?.healed) {
      return { ok: false, result: last, healed: true, detail: rec.detail, failures: rec.failures };
    }
    const live = opts.map.room(opts.fromId)?.links[opts.cmd];
    if (!live?.to) {
      return { ok: false, result: last, healed: true, detail: rec?.detail ?? `link ${opts.cmd} removed`, failures: rec?.failures };
    }
  }
  return { ok: false, result: last, failures: opts.map.room(opts.fromId)?.links[opts.cmd]?.failCount };
}
