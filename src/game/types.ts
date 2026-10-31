import type { PromptStatus } from "./promptStatus.js";
export type Vitals = {
  hp?: number;
  hpMax?: number;
  sp?: number;
  spMax?: number;
  pp?: number;
  ppMax?: number;
  /** Combat status `Attacker : extremely poor` (opponent condition). */
  attacker?: string;
  at: number;
};

export type DoorState = "open" | "closed" | "locked";

/** A Powermud door line: `There is a stone door leading northeast ( OPENED ).` */
export type RoomDoor = {
  /** Material plus "door", e.g. `stone door`. */
  name: string;
  /** Canonical direction the door leads (`ne`, `n`, `u`). */
  direction: string;
  /**
   * `open` — the direction is a normal exit.
   * `closed` — `open door` opens it, then the direction is an exit.
   * `locked` — `open door` does not open it.
   */
  state: DoorState;
};

export type RoomContentKind = "mob" | "npc" | "item" | "entrance" | "corpse" | "player" | "unknown";

export type RoomContent = {
  name: string;
  count: number;
  /** LPC object path when the MUD shows it, e.g. `d/std/mon/tguard#1836`. */
  path?: string;
  kind: RoomContentKind;
};

export type RoomObservation = {
  mode: "brief" | "verbose" | "dark";
  title?: string;
  description?: string;
  exits: string[];
  contents: RoomContent[];
  /** Doors named in the room text. Unlocked doors are also listed in `exits`. */
  doors?: RoomDoor[];
};

export type CharacterStatus = {
  name?: string;
  title?: string;
  sex?: string;
  race?: string;
  alignment?: string;
  guild?: string;
  home?: string;
  age?: string;
  hp?: number;
  hpMax?: number;
  sp?: number;
  spMax?: number;
  pp?: number;
  ppMax?: number;
  stats?: Record<string, number>;
  exp?: number;
  expToNext?: number;
  nextGain?: string;
  coins?: number;
  coinValue?: number;
  bank?: number;
  questPoints?: number;
  updatedAt?: number;
  /** When exp/expToNext/coinValue/bank were last read from the status prompt (`prompt doh`). */
  promptStatusAt?: number;
};

export type LoginStage =
  | "user-prompt"
  | "password-prompt"
  | "account-menu"
  | "throw-out"
  | "new-user-warning"
  | "bad-password"
  | "bad-character"
  | "in-game";

export type GameEvent =
  | { type: "prompt"; vitals?: Vitals; bare: boolean; status?: PromptStatus }
  | { type: "line"; text: string }
  | { type: "vitals"; vitals: Vitals }
  | { type: "room"; room: RoomObservation }
  | { type: "move-failed"; text: string }
  | { type: "flee"; dir: string }
  | { type: "flee-failed"; text: string }
  | { type: "score"; status: CharacterStatus }
  | { type: "login"; stage: LoginStage }
  | { type: "death"; who?: string; killer?: string; text: string }
  | { type: "kill"; victim: string; text: string }
  /** Replay only: `>>> [who] cmd` lines from the hub log. */
  | { type: "command-echo"; who: string; commands: string[] };
