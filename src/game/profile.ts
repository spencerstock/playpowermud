/**
 * MUD-specific text patterns and parse hooks. Everything game-dependent that the stream
 * parser, mapper and login automaton need lives here, so another MUD only needs a new
 * profile (see `src/muds/` and docs/adding-a-mud.md).
 */
import type { PromptStatus } from "./promptStatus.js";
import type { CharacterStatus, GameEvent, Vitals } from "./types.js";

/** What a prompt match carries. `vitals` present = an in-game prompt (even with no numbers). */
export type PromptRead = { vitals?: Omit<Vitals, "at">; status?: PromptStatus };

/** Multi-line `score`-style block → {@link CharacterStatus}. */
export type ScoreParser = {
  /** Opening line of the block (with the line before it, for name/title). */
  start(line: string, previousLine: string): CharacterStatus | null;
  /** True when `line` belongs to the open block (fields are written into `status`). */
  feed(line: string, status: CharacterStatus): boolean;
};

/** Where a ride is in its life: ticket bought, stepped aboard, under way, put ashore. */
export type TransitPhase = "ticket" | "board" | "depart" | "arrive";

/**
 * A ride or forced relocation the MUD narrates instead of an exit: a ship or ferry, a boot out
 * of an arena. The mapper must never read one as a compass step (that is how Merevia was drawn
 * over Deepwater's docks, and Elinost over the newbie arena), so the profile names its lines.
 * Every pattern matches one whole trimmed line.
 */
export type TransitRule = {
  id: string;
  /** Human label, used for the vessel room, its plane and the transit link note. */
  label: string;
  /** Destination announced before boarding (`… a ship bound for Merevia.`); group 1 = place. */
  ticket?: RegExp[];
  /** We stepped aboard: from here on we ride the vessel, not the dock. */
  board?: RegExp[];
  /** The command that boards (`board ship`), when the typed one was not seen. */
  command?: string;
  /** The vessel left the dock (the voyage clock starts). */
  depart?: RegExp[];
  /** The next room display is where the ride put us, not the exit of any queued command. */
  arrive: RegExp[];
  /** Ride chatter that is never part of a room description (waves, gulls, the dock worker). */
  ambient?: RegExp[];
  /**
   * Vessel interior prose (start of its description). While aboard, the mapper keeps us in a
   * vessel room on a plane of its own, never placed on land.
   */
  vessel?: { description: string };
  /**
   * Record `<board command>` from the boarding room to the arrival as a transit link (default:
   * true when the rule has `board` lines). Forced relocations (arena boot) are not a way to go.
   */
  link?: boolean;
  /** Extra steps to show before the board command on the link (`purchase` at the office…). */
  howTo?: string;
};

export type GameProfile = {
  id: string;
  /** Prompt at start of a line, e.g. `[HP:90 SP:50]` — may be followed by more text on the same line. */
  promptPrefix: RegExp;
  /** Turn a {@link promptPrefix} match into vitals/status. */
  readPrompt: (m: RegExpMatchArray) => PromptRead;
  /**
   * The MUD ends every prompt with telnet GA/EOR: at a prompt mark the pending partial line
   * is a prompt even when {@link promptPrefix} does not match it (menus, pagers, questions).
   */
  promptMarks?: boolean;
  /** Bare account-menu / pre-prompt-setup prompt, e.g. `> `. */
  barePromptPrefix: RegExp;
  /** Combat round status line with current(max) vitals — not a command-completion prompt. */
  combatStatus: RegExp;
  /**
   * `text`: rooms are parsed from the display (brief line / verbose exits).
   * `gmcp`: rooms come from GMCP via {@link gmcp}; text room parsing is off.
   */
  roomSource: "text" | "gmcp";
  /** Brief-mode room line: `Title (n, s, out).` */
  briefRoom: RegExp;
  /** Verbose exits line; group 1 = exit list text. */
  verboseExits: RegExp[];
  /** Exit list text → canonical exit tokens (default `parseExitList`: `north, east and out`). */
  parseExits?: (raw: string) => string[];
  /** Verbose room with no exits. */
  noExits: RegExp;
  /** Room contents line after a room display. */
  contentsLine: RegExp;
  /**
   * ANSI sequence the MUD wraps around a living thing's name on a contents line (Powermud:
   * bold magenta). When set, a colored session classifies contents by this color: names with
   * it are NPCs/mobs, names without it are objects. Plain (color-off) text keeps the name
   * heuristics.
   */
  livingContentColor?: RegExp;
  /** Hidden mob noticed in the room listing; group 1 = name (`You notice Drow skulking around…`). */
  hiddenContentsLine?: RegExp;
  /**
   * A character standing in the room on its own line (`Lorax - I speak for the trees is standing
   * here.`); group 1 = name. Part of the room listing, so contents after it are kept.
   */
  occupantLine?: RegExp;
  /** Movement attempt that did not move the character. */
  moveFailed: RegExp[];
  /**
   * Something stopped a move that would have gone through (Powermud's small boy at the foot of
   * Mt. Kulajo: `The small boy trips you!`). The exit is fine — it is not charged as a failure —
   * but the step was eaten, so a speedwalk sent in one batch falls one step behind its plan.
   */
  moveHindered?: RegExp[];
  /** Moved but could not see the room (`It is too dark`, or dizzy from looking around). */
  darkRoom: RegExp;
  /** `You flee like the wind, east!` — group 1 = direction actually taken. */
  fleeMoved: RegExp;
  fleeFailed: RegExp[];
  /** We killed something; group 1 = victim. */
  killLine: RegExp;
  /** Commands that relocate without an exit (no map edge is recorded). */
  teleportCommands: RegExp;
  /** Commands that never move the character or redisplay the room. */
  nonMovementCommands: RegExp;
  /** Commands that redisplay the current room. */
  lookCommands: RegExp;
  /** Command that opens the closed door on `dir` (default PowerMUD `open door`). */
  openDoor?: (dir: string, doorName?: string) => string;
  login: {
    userPrompt: RegExp;
    passwordPrompt: RegExp;
    accountMenu: RegExp;
    throwOut: RegExp;
    newUserWarning: RegExp;
    badPassword: RegExp;
    /** Character name not linked to this user or unknown. */
    badCharacter: RegExp;
  };
  inGameMarkers: RegExp[];
  deathMarkers: RegExp[];
  /** System lines that precede an arrival display but are never part of a room description. */
  loginNoise: RegExp[];
  /** Rides and forced relocations narrated in text (see {@link TransitRule}). */
  transits?: TransitRule[];
  /** `score` block parser (optional — GMCP MUDs report status out of band). */
  score?: ScoreParser;
  /** Translate one GMCP message into game events (vitals, rooms, identity). */
  gmcp?: (pkg: string, data: unknown) => GameEvent[];
};

/** Command that opens the door on `dir` for this profile. */
export function openDoorCommand(profile: GameProfile, dir: string, doorName?: string): string {
  return profile.openDoor?.(dir, doorName) ?? "open door";
}

/** Never matches: for profile fields a MUD does not have. */
export const NEVER = /(?!)/;

export { POWERMUD_PROFILE } from "../muds/powermud/profile.js";
import { POWERMUD_PROFILE } from "../muds/powermud/profile.js";

/** Fallback for offline tools and tests that do not pick a MUD (PowerMUD, the first MUD). */
export function defaultGameProfile(): GameProfile {
  return POWERMUD_PROFILE;
}
