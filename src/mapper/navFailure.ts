import { isGeometricDirection } from "../game/directions.js";
import { flakyBatchRepeatFromCatalog } from "./flakyTravelCatalog.js";
import { NAV_FAILURES_BEFORE_HEAL, type NavFailureResult, type WorldMap } from "./WorldMap.js";
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

const MOVE_FAILED_RE =
  /cannot go that direction|can't go that way|alas, you cannot|too busy fighting|can't move|you fail to climb|you are unable to climb|you fail to enter|you are unable to enter|you slip|lose your grip|you can't reach|you cannot reach|find nothing|search reveals nothing/i;

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
  const fromCanon = ctx.map.canonicalId(ctx.fromId);
  for (const back of Object.values(dest.links)) {
    if (!back.to) continue;
    if (ctx.map.canonicalId(back.to) === fromCanon) return false;
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
  link?: Pick<MapLink, "kind" | "failCount" | "blocked" | "to">,
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
  // A plain exit that refused us a few times in a row will not open on the 20th try: give up
  // and let the walk reroute around it (failCount still accumulates toward a heal).
  return Math.max(1, Math.min(COMPASS_MOVE_MAX_ATTEMPTS, NAV_FAILURES_BEFORE_HEAL - priorFailures));
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

function shouldRecordNavFailure(
  cmd: string,
  link: MapLink | undefined,
  output: string,
  ctx?: FlakyTravelContext,
): boolean {
  if (isFlakyTravelCommand(cmd, link, ctx)) return false;
  return !outputSaysMoveFailed(output);
}

const SILENT_MOVE_FAIL_MAX = 2;

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
}): Promise<RetryCompassMoveResult> {
  const link = opts.map.room(opts.fromId)?.links[opts.cmd];
  const flakyCtx: FlakyTravelContext = { map: opts.map, fromId: opts.fromId };
  const max = opts.maxAttempts ?? moveMaxAttempts(opts.cmd, link, 0, flakyCtx);
  let last: MoveSendResult = { output: "" };
  for (let attempt = 0; attempt < max; attempt++) {
    if (opts.shouldAbort?.()) {
      return { ok: false, result: last, detail: "aborted" };
    }
    last = await opts.send();
    if (opts.shouldAbort?.()) {
      return { ok: false, result: last, detail: "aborted" };
    }
    if (opts.moved()) return { ok: true, result: last };

    if (shouldAbortMoveRetry(last, attempt)) {
      return { ok: false, result: last, detail: last.error ?? "silent move failure" };
    }

    let rec: NavFailureResult | undefined;
    if (shouldRecordNavFailure(opts.cmd, link, last.output, flakyCtx)) {
      rec = opts.map.recordNavigationFailure(opts.fromId, opts.cmd, last.error ?? "did not move");
    } else if (outputSaysMoveFailed(last.output)) {
      const live = opts.map.room(opts.fromId)?.links[opts.cmd];
      const failures = live?.failCount ?? 0;
      if (!live?.to) {
        return { ok: false, result: last, healed: true, detail: `link ${opts.cmd} removed`, failures };
      }
      if (failures >= NAV_FAILURES_BEFORE_HEAL) {
        return { ok: false, result: last, healed: true, failures };
      }
    }
    if (rec?.healed) {
      return { ok: false, result: last, healed: true, detail: rec.detail, failures: rec.failures };
    }
    const live = opts.map.room(opts.fromId)?.links[opts.cmd];
    if (!live?.to) {
      return { ok: false, result: last, healed: true, detail: `link ${opts.cmd} removed`, failures: rec?.failures };
    }
  }
  return { ok: false, result: last, failures: opts.map.room(opts.fromId)?.links[opts.cmd]?.failCount };
}
