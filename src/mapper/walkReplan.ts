import type { PathOptions, PathStep } from "./types.js";
import type { WorldMap } from "./WorldMap.js";

/** Fresh routes a single walk may try after steps fail before it gives up. */
export const MAX_WALK_REPLANS = 4;

export type StepFailure = {
  /** Room the failed step started from. */
  fromId: string;
  cmd: string;
  /** Room the step was meant to reach. */
  expectedId: string | undefined;
  /** Where the mapper puts us now (null when lost). */
  hereId: string | null;
  targetId: string;
  /** Why the step failed, for the final report. */
  why: string;
  /** Exits already ruled out on this walk (`roomId:cmd`); extended in place. */
  avoidLinks: string[];
  /** Replans already used on this walk. */
  replans: number;
  pathOpts: PathOptions;
};

export type StepRecovery =
  | { kind: "arrived" }
  | { kind: "replan"; path: PathStep[]; note: string }
  | { kind: "relook" }
  | { kind: "fail"; reason: string };

/**
 * A walk step did not land where the map said. Rule out that exit for the rest of this walk
 * — unless the mapper has already learned where it really goes — and route again from
 * wherever we actually are, instead of giving up or looping on the same broken exit. Lost
 * (no position) asks the caller to `look` first; too many replans or no other route fails.
 */
export function recoverFromStepFailure(map: WorldMap, f: StepFailure): StepRecovery {
  const here = map.canonicalId(f.hereId);
  if (!here) return { kind: "relook" };
  if (here === map.canonicalId(f.targetId)) return { kind: "arrived" };
  const learned = map.canonicalId(map.room(f.fromId)?.links[f.cmd]?.to) === here && here !== map.canonicalId(f.fromId);
  const key = `${map.canonicalId(f.fromId) ?? f.fromId}:${f.cmd}`;
  if (!learned && !f.avoidLinks.includes(key)) f.avoidLinks.push(key);
  if (f.replans >= MAX_WALK_REPLANS) return { kind: "fail", reason: `${f.why} (gave up after ${f.replans} reroutes)` };
  const target = map.canonicalId(f.targetId);
  const path = map.findPath(here, (r) => r.id === target, { ...f.pathOpts, avoidLinks: f.avoidLinks });
  if (!path) return { kind: "fail", reason: `${f.why}; no other known route from ${here}` };
  const note = learned
    ? `${f.cmd} from ${f.fromId} really leads to ${here}; rerouting`
    : `${f.cmd} from ${f.fromId} failed (${f.why}); rerouting from ${here} around it`;
  return { kind: "replan", path, note };
}
