import { isGeometricDirection } from "../game/directions.js";
import { OPEN_DOOR_COMMAND } from "../game/doors.js";
import { flakyBatchRepeatCount } from "./navFailure.js";
import type { MapRoom, PathStep } from "./types.js";

export type DoorOpener = (dir: string, doorName?: string) => string;

/** Powermud compass doors use `open door`; named exits use `open <exit>`. */
export const defaultDoorOpener: DoorOpener = (dir) =>
  isGeometricDirection(dir) ? OPEN_DOOR_COMMAND : `open ${dir}`;

export function hasOpenAttempt(pres: readonly string[]): boolean {
  return pres.some((p) => /^open\b/i.test(p.trim()));
}

/**
 * Commands to send before a path step or charted exit: step/link `pre`, plus open the door when
 * the room lists one on this exit (unless locked). Doors often close after someone passes through.
 */
export function mergeStepPre(
  room: Pick<MapRoom, "links" | "doors"> | undefined | null,
  cmd: string,
  stepPre?: readonly string[],
  openDoor: DoorOpener = defaultDoorOpener,
): string[] {
  const out: string[] = [];
  const push = (p: string) => {
    const t = p.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  for (const p of stepPre ?? []) push(p);
  for (const p of room?.links[cmd]?.pre ?? []) push(p);
  const door = room?.doors?.find((d) => d.direction === cmd);
  if (door && door.state !== "locked" && !hasOpenAttempt(out)) push(openDoor(cmd, door.name));
  return out;
}

type WalkMap = { room(id: string): MapRoom | undefined };

type WalkMapWithCanon = WalkMap & { canonicalId(id: string): string | undefined };

/** True when moves along this step's exit have been eaten without moving (`MapLink.hindered`). */
export function isHinderedStep(step: PathStep, map: WalkMapWithCanon): boolean {
  const fromId = map.canonicalId(step.from) ?? step.from;
  return (map.room(fromId)?.links[step.cmd]?.hindered ?? 0) > 0;
}

/**
 * Cut a speedwalk into batches around hindered steps. Every command of a batch is on the wire
 * before the first answer, so one eaten move (`The small boy trips you!`) shifts the rest of the
 * plan by a step — up a mountain pass instead of down the trail. A hindered step goes alone so
 * the walk can repeat it until it really moves, then the next batch starts from a known room.
 */
export function splitBatchPath(path: PathStep[], map: WalkMapWithCanon): PathStep[][] {
  const out: PathStep[][] = [];
  let cur: PathStep[] = [];
  for (const step of path) {
    if (isHinderedStep(step, map)) {
      if (cur.length) out.push(cur);
      out.push([step]);
      cur = [];
    } else {
      cur.push(step);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Wire commands for a map path (batch speedwalk: includes flaky-travel repeats). */
export function pathWireCommands(
  path: PathStep[],
  map: WalkMapWithCanon,
  beforeEach: string[] = [],
  openDoor: DoorOpener = defaultDoorOpener,
): string[] {
  return path.flatMap((s) => {
    const fromId = map.canonicalId(s.from) ?? s.from;
    const room = map.room(fromId);
    const link = room?.links[s.cmd];
    const reps = flakyBatchRepeatCount(s.cmd, link, { map, fromId });
    const move = reps > 1 ? Array.from({ length: reps }, () => s.cmd) : [s.cmd];
    return [...beforeEach, ...mergeStepPre(room, s.cmd, s.pre, openDoor), ...move];
  });
}
