import { canonicalDirection, longDirection } from "./directions.js";
import type { RoomDoor, RoomObservation } from "./types.js";

/** Powermud opens a compass door with this, then the direction is a normal exit. */
export const OPEN_DOOR_COMMAND = "open door";

const DOOR_LINE =
  /^(?:there is an?\s+)?(.+?)\s+door leading\s+([a-z]+)\s+\(\s*(opened|closed|locked)\s*\)\.?$/i;

/**
 * `There is a stone door leading northeast ( OPENED ).`
 * Also accepts the clause after `There is` (`a stone door leading northeast ( OPENED )`).
 */
export function parseDoorLine(line: string): RoomDoor | null {
  const m = line.trim().match(DOOR_LINE);
  if (!m) return null;
  const direction = canonicalDirection(m[2]!);
  if (!direction) return null;
  const word = m[3]!.toLowerCase();
  const state = word === "opened" ? "open" : word === "locked" ? "locked" : "closed";
  const name = `${m[1]!.replace(/\s+/g, " ").trim()} door`;
  return { name, direction, state };
}

export function parseDoors(text: string): RoomDoor[] {
  const doors: RoomDoor[] = [];
  for (const line of text.split(/\n/)) {
    const door = parseDoorLine(line);
    if (!door) continue;
    const i = doors.findIndex((d) => d.direction === door.direction);
    if (i >= 0) doors[i] = door;
    else doors.push(door);
  }
  return doors;
}

/** Record a door on a room observation and expose an unlocked door as an exit. */
export function noteDoor(room: RoomObservation, door: RoomDoor): void {
  room.doors ??= [];
  const i = room.doors.findIndex((d) => d.direction === door.direction);
  if (i >= 0) room.doors[i] = door;
  else room.doors.push(door);
  if (door.state === "locked") room.exits = room.exits.filter((e) => e !== door.direction);
  else if (!room.exits.includes(door.direction)) room.exits.push(door.direction);
}

export function noteDoorsInText(room: RoomObservation, text: string): void {
  for (const door of parseDoors(text)) noteDoor(room, door);
}

export function withDoorState(doors: readonly RoomDoor[] | undefined, door: RoomDoor): RoomDoor[] {
  const next = (doors ?? []).map((d) => ({ ...d }));
  const i = next.findIndex((d) => d.direction === door.direction);
  if (i >= 0) next[i] = door;
  else next.push(door);
  return next;
}

/** Keep the stored description's door parentheticals in step with the parsed state. */
export function descriptionWithDoorStates(description: string, doors: readonly RoomDoor[]): string {
  let out = description;
  for (const door of doors) {
    const word = door.state === "open" ? "OPENED" : door.state === "locked" ? "LOCKED" : "CLOSED";
    const dir = longDirection(door.direction);
    const re = new RegExp(`(door leading ${dir} \\(\\s*)(?:OPENED|CLOSED|LOCKED)(\\s*\\))`, "ig");
    out = out.replace(re, `$1${word}$2`);
  }
  return out;
}

function commandLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !parseDoorLine(line));
}

/** A failed move: the door is shut and `open door` will open it. Look-lines are not failures. */
export function outputSaysClosedDoor(text: string): boolean {
  return commandLines(text).some((line) => /\bdoor\b/i.test(line) && /\bclosed\b/i.test(line) && !/\blocked\b/i.test(line));
}

/** A failed open or move: the door will not open. */
export function outputSaysLockedDoor(text: string): boolean {
  return commandLines(text).some((line) => /\bdoor\b/i.test(line) && /\blocked\b/i.test(line));
}

export function outputSaysOpenedDoor(text: string): boolean {
  return commandLines(text).some((line) => /^you open\b/i.test(line) && /\bdoors?\b/i.test(line));
}

export function outputSaysAlreadyOpen(text: string): boolean {
  return commandLines(text).some((line) => /\balready open\b/i.test(line) && /\bdoor\b/i.test(line));
}
