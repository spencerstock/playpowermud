import { promptStatusFromMatch, type PromptStatus } from "./promptStatus.js";
import { stripAnsi } from "../session/scrollback.js";
import { parseBriefRoomLine } from "./briefRoom.js";
import { canonicalDirection, parseExitList } from "./directions.js";
import { noteDoor, noteDoorsInText, parseDoorLine } from "./doors.js";
import { contentPathLooksLikePlayer, lookupKnownPlayer, knownPlayerRegistry } from "./players.js";
import { classifyNpcKind } from "../mapper/npcs.js";
import { cleanseRoomDescription, isRoomDescriptionNoiseLine, isWrappedContinuationLine } from "./roomDescriptionNoise.js";
import { defaultGameProfile, type GameProfile } from "./profile.js";
import type {
  CharacterStatus,
  GameEvent,
  RoomContent,
  RoomContentKind,
  RoomObservation,
  Vitals,
} from "./types.js";

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  "a couple": 2,
  "a few": 3,
  several: 4,
  "lots of": 6,
  many: 6,
};

const NOT_CONTENTS = /^(?:currently|nothing|no |no$)/i;
const MAX_DESC_LINES = 40;

export type GameStreamOptions = {
  profile?: GameProfile;
  /** Parse `>>> [who] cmd` hub echo lines (log replay). */
  parseCommandEcho?: boolean;
  /** Classify Powermud admins in room contents as players (default true). */
  knownPlayers?: boolean;
};

/** A wrapped "obvious exits" remainder: `northeast.` / `and mainland.`, not a sentence. */
function isExitContinuation(t: string): boolean {
  const body = t.trim().replace(/[.\s]+$/, "");
  if (!body || body.length > 80) return false;
  const parts = body
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 6) return false;
  return parts.every((p) => /^[a-z][a-z0-9']*(?:[ -][a-z][a-z0-9']*){0,2}$/i.test(p));
}

function cleanLine(raw: string): string {
  // Telnet IAC bytes decode as U+FFFD; drop them with other control characters.
  return stripAnsi(raw)
    .replace(/\r/g, "")
    .replace(/[�\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function classifyContent(name: string, path: string | undefined, registry?: ReturnType<typeof knownPlayerRegistry>): RoomContentKind {
  if (/^corpses? of\b|\bcorpse\b|\bremains\b/i.test(name)) return "corpse";
  const first = name.trim().split(/\s+/)[0] ?? name;
  if (registry && lookupKnownPlayer(first, registry)) return "player";
  if (path) {
    if (contentPathLooksLikePlayer(path)) {
      if (registry && lookupKnownPlayer(first, registry)) return "player";
      return "npc";
    }
    if (/\/mon\//.test(path)) return classifyNpcKind(name, path, "mob");
    if (/\/(?:obj|eq|items?|weapons?|armou?r)\//.test(path)) return "item";
    if (/castle|area|entrance/i.test(path)) return "entrance";
  }
  if (/\b(?:path|passage|trail|pass|castle|cave|entrance|road) (?:leading|to the)\b/i.test(name)) {
    return "entrance";
  }
  if (/\b(?:coins|sign|scale|chest|sword|shield|armor|gem|key|potion|scroll)\b/i.test(name)) {
    return "item";
  }
  return classifyNpcKind(name, path, "unknown");
}

export function parseContentsText(body: string, registry?: ReturnType<typeof knownPlayerRegistry>): RoomContent | null {
  let t = body.trim().replace(/\.\s*$/, "");
  let path: string | undefined;
  const pathMatch = t.match(/\s*\(([^()\s]*\/[^()\s]*)\)\s*$/);
  if (pathMatch) {
    path = pathMatch[1];
    t = t.slice(0, pathMatch.index).trim().replace(/\.\s*$/, "");
  }
  if (!t || NOT_CONTENTS.test(t) || parseDoorLine(t) || parseDoorLine(`There is ${t}`)) return null;
  let count = 1;
  const words = Object.entries(COUNT_WORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [word, n] of words) {
    if (t.toLowerCase().startsWith(`${word} `)) {
      count = n;
      t = t.slice(word.length + 1).trim();
      break;
    }
  }
  const num = t.match(/^(\d+) (.+)$/);
  if (num) {
    count = Number(num[1]);
    t = num[2]!;
  }
  if (!t) return null;
  return { name: t, count, path, kind: classifyContent(t, path, registry) };
}

type ScoreState = { status: CharacterStatus } | null;

/**
 * Incremental MUD output parser: turns raw chunks into prompts, room observations,
 * movement failures, score snapshots and login stages. Pure (no I/O); used live by the
 * hub and offline for log replay.
 */
export class GameStream {
  private readonly profile: GameProfile;
  private readonly parseEcho: boolean;
  private readonly playerRegistry: ReturnType<typeof knownPlayerRegistry> | undefined;
  private partial = "";
  private descBuf: string[] = [];
  private pendingRoom: RoomObservation | null = null;
  /** The exits line ended with a comma, so the next line may be the wrapped remainder. */
  private exitListOpen = false;
  private score: ScoreState = null;
  private lastLine = "";
  /** The last text line was chatter, so an indented line after it is its wrapped tail. */
  private lastNoise = false;
  private out: GameEvent[] = [];

  constructor(opts?: GameStreamOptions) {
    this.profile = opts?.profile ?? defaultGameProfile();
    this.parseEcho = opts?.parseCommandEcho === true;
    this.playerRegistry = opts?.knownPlayers === false ? undefined : knownPlayerRegistry();
  }

  /** Feed raw MUD text (ANSI allowed). Returns events in order. */
  feed(chunk: string): GameEvent[] {
    this.out = [];
    const text = this.partial + chunk;
    const parts = text.split("\n");
    this.partial = parts.pop() ?? "";
    for (const raw of parts) this.processLine(cleanLine(raw));
    this.processPartialPrompts();
    return this.out;
  }

  /** Treat any buffered partial line as complete and close open blocks (idle / end of replay). */
  flush(): GameEvent[] {
    this.out = [];
    if (this.partial) {
      const p = this.partial;
      this.partial = "";
      this.processLine(cleanLine(p));
    }
    this.finishRoom();
    this.finishScore();
    return this.out;
  }

  /** Close an open room/score block without touching a partial line (live idle timer). */
  settle(): GameEvent[] {
    this.out = [];
    this.finishRoom();
    this.finishScore();
    return this.out;
  }

  private emit(ev: GameEvent): void {
    this.out.push(ev);
  }

  /** Prompts and login questions arrive without a trailing newline; emit them immediately. */
  private processPartialPrompts(): void {
    for (;;) {
      const p = cleanLine(this.partial);
      if (!p) return;
      const consumed = this.consumeLeadingPrompts(p, true);
      if (consumed === null) return;
      if (consumed.trim() === "") {
        this.partial = "";
        return;
      }
      // Prompt followed by more text on the same (incomplete) line: keep the remainder buffered.
      this.partial = consumed;
      if (consumed === p) return;
    }
  }

  /**
   * Strip prompt-like prefixes from a line, emitting events. Returns the remainder, or null
   * when nothing was consumed (partial mode only).
   */
  private consumeLeadingPrompts(line: string, partialMode: boolean): string | null {
    let rest = line;
    let consumedAny = false;
    for (;;) {
      const pm = rest.match(this.profile.promptPrefix);
      if (pm) {
        const vitals: Vitals = {
          hp: Number(pm[1]),
          hpMax: pm[2] !== undefined ? Number(pm[2]) : undefined,
          sp: Number(pm[3]),
          spMax: pm[4] !== undefined ? Number(pm[4]) : undefined,
          pp: pm[5] !== undefined ? Number(pm[5]) : undefined,
          ppMax: pm[6] !== undefined ? Number(pm[6]) : undefined,
          at: Date.now(),
        };
        this.onPrompt(vitals, false, promptStatusFromMatch(pm));
        rest = rest.slice(pm[0].length);
        consumedAny = true;
        continue;
      }
      if (this.profile.barePromptPrefix.test(rest) || (partialMode && rest.trim() === ">")) {
        this.onPrompt(undefined, true);
        rest = rest.replace(/^>\s?/, "");
        consumedAny = true;
        continue;
      }
      const login = this.profile.login;
      const throwOut = rest.match(login.throwOut);
      if (throwOut && throwOut.index === 0) {
        this.finishRoom();
        this.descBuf = [];
        this.emit({ type: "login", stage: "throw-out" });
        rest = rest.slice(throwOut[0].length);
        consumedAny = true;
        continue;
      }
      if (partialMode) {
        if (login.passwordPrompt.test(rest)) {
          this.descBuf = [];
          this.emit({ type: "login", stage: "password-prompt" });
          return "";
        }
        if (login.userPrompt.test(rest)) {
          this.descBuf = [];
          this.emit({ type: "login", stage: "user-prompt" });
          return "";
        }
      }
      break;
    }
    if (partialMode && !consumedAny) return null;
    return rest;
  }

  private onPrompt(vitals: Vitals | undefined, bare: boolean, status?: PromptStatus): void {
    this.finishRoom();
    this.finishScore();
    this.descBuf = [];
    this.lastNoise = false;
    this.emit(status ? { type: "prompt", vitals, bare, status } : { type: "prompt", vitals, bare });
  }

  private finishRoom(): void {
    this.exitListOpen = false;
    if (!this.pendingRoom) return;
    this.emit({ type: "room", room: this.pendingRoom });
    this.pendingRoom = null;
  }

  private finishScore(): void {
    if (!this.score) return;
    this.score.status.updatedAt = Date.now();
    this.emit({ type: "score", status: this.score.status });
    this.score = null;
  }

  private takeDescription(): string {
    const lines = [...this.descBuf];
    while (lines.length && !lines[0]!.trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    this.descBuf = [];
    const raw = lines.map((l) => l.trimEnd()).join("\n");
    return cleanseRoomDescription(raw, this.profile) ?? "";
  }

  private processLine(input: string): void {
    const line = this.consumeLeadingPrompts(input, false) ?? input;
    const t = line.trim();
    const p = this.profile;

    if (this.parseEcho) {
      const echo = t.match(/^>>> \[([^\]]+)\] (.*)$/);
      if (echo) {
        this.finishRoom();
        this.finishScore();
        this.descBuf = [];
        this.emit({ type: "command-echo", who: echo[1]!, commands: splitEchoCommands(echo[2]!) });
        return;
      }
    }
    if (t.startsWith("[mudwithme]")) {
      this.descBuf = [];
      return;
    }

    if (!t) {
      // Powermud often prints a blank line between the exits line and
      // "There is one …". Closing the room here drops those contents, and the
      // next room can inherit the mob name.
      if (this.pendingRoom) return;
      this.finishRoom();
      if (this.descBuf.length) this.descBuf.push("");
      return;
    }

    this.emit({ type: "line", text: line });

    if (this.pendingRoom) {
      const door = parseDoorLine(t);
      if (door) {
        noteDoor(this.pendingRoom, door);
        return;
      }
      const cm = t.match(p.contentsLine);
      if (cm && !p.noExits.test(t)) {
        const content = parseContentsText(cm[1]!, this.playerRegistry);
        if (content) {
          this.pendingRoom.contents.push(content);
          return;
        }
      }
      // Players get their own line, no `There is`: `Hogi is a prisoner (std/body/player#11028).`
      if (/\([^()\s]*\/(?:ply|player|users?)[/#][^()\s]*\)\.?\s*$/i.test(t)) {
        const content = parseContentsText(t, this.playerRegistry);
        if (content) {
          this.pendingRoom.contents.push(content);
          return;
        }
      }
      if (this.exitListOpen && isExitContinuation(t)) {
        for (const ex of parseExitList(t)) {
          if (!this.pendingRoom.exits.includes(ex)) this.pendingRoom.exits.push(ex);
        }
        this.exitListOpen = /,\s*$/.test(t);
        return;
      }
      this.finishRoom();
    }

    if (this.score) {
      if (this.feedScore(t)) {
        this.lastLine = t;
        return;
      }
      this.finishScore();
    }

    if (p.moveFailed.some((re) => re.test(t))) {
      this.descBuf = [];
      this.emit({ type: "move-failed", text: t });
      return;
    }
    if (p.darkRoom.test(t)) {
      this.descBuf = [];
      this.pendingRoom = { mode: "dark", exits: [], contents: [] };
      this.finishRoom();
      return;
    }
    const flee = t.match(p.fleeMoved);
    if (flee) {
      this.descBuf = [];
      this.emit({ type: "flee", dir: canonicalDirection(flee[1]!) ?? flee[1]!.toLowerCase() });
      return;
    }
    if (p.fleeFailed.some((re) => re.test(t))) {
      this.emit({ type: "flee-failed", text: t });
      return;
    }
    const killed = t.match(/^You killed (.+?)\.\s*$/i);
    if (killed) {
      this.descBuf = [];
      this.emit({ type: "kill", victim: killed[1]!.trim(), text: t });
      return;
    }

    const combat = t.match(p.combatStatus);
    if (combat) {
      this.descBuf = [];
      this.emit({
        type: "vitals",
        vitals: {
          hp: Number(combat[1]),
          hpMax: Number(combat[2]),
          sp: Number(combat[3]),
          spMax: Number(combat[4]),
          pp: combat[5] !== undefined ? Number(combat[5]) : undefined,
          ppMax: combat[6] !== undefined ? Number(combat[6]) : undefined,
          attacker: combat[7]?.trim(),
          at: Date.now(),
        },
      });
      return;
    }

    const brief = parseBriefRoomLine(t, p);
    if (brief) {
      this.descBuf = [];
      this.pendingRoom = {
        mode: "brief",
        title: brief.title,
        exits: brief.exits,
        contents: [],
      };
      return;
    }

    for (const re of p.verboseExits) {
      const m = t.match(re);
      if (m) {
        this.pendingRoom = {
          mode: "verbose",
          description: this.takeDescription(),
          exits: parseExitList(m[1]!),
          contents: [],
        };
        noteDoorsInText(this.pendingRoom, this.pendingRoom.description ?? "");
        this.exitListOpen = /,\s*$/.test(m[1]!);
        return;
      }
    }
    if (p.noExits.test(t)) {
      this.pendingRoom = {
        mode: "verbose",
        description: this.takeDescription(),
        exits: [],
        contents: [],
      };
      noteDoorsInText(this.pendingRoom, this.pendingRoom.description ?? "");
      return;
    }

    if (this.startScore(t)) {
      this.descBuf = [];
      this.lastLine = t;
      return;
    }

    if (this.detectLoginAndMarkers(t) || this.profile.loginNoise.some((re) => re.test(t))) {
      this.descBuf = [];
      this.lastLine = t;
      return;
    }

    if (isRoomDescriptionNoiseLine(t, this.profile) || (this.lastNoise && isWrappedContinuationLine(line))) {
      this.lastLine = t;
      this.lastNoise = true;
      return;
    }

    this.lastNoise = false;
    this.descBuf.push(line);
    if (this.descBuf.length > MAX_DESC_LINES) this.descBuf.shift();
    this.lastLine = t;
  }

  /** Returns true when the line was a login/system marker (a description boundary). */
  private detectLoginAndMarkers(t: string): boolean {
    const p = this.profile;
    const before = this.out.length;
    if (p.login.newUserWarning.test(t)) this.emit({ type: "login", stage: "new-user-warning" });
    else if (p.login.badPassword.test(t)) this.emit({ type: "login", stage: "bad-password" });
    else if (p.login.badCharacter.test(t)) this.emit({ type: "login", stage: "bad-character" });
    else if (p.login.accountMenu.test(t)) this.emit({ type: "login", stage: "account-menu" });
    else if (p.login.userPrompt.test(t)) this.emit({ type: "login", stage: "user-prompt" });
    else if (p.login.passwordPrompt.test(t)) this.emit({ type: "login", stage: "password-prompt" });
    if (p.inGameMarkers.some((re) => re.test(t))) this.emit({ type: "login", stage: "in-game" });
    for (const re of p.deathMarkers) {
      const m = t.match(re);
      if (m) {
        this.emit({ type: "death", who: m[1], killer: m[2], text: t });
        break;
      }
    }
    return this.out.length > before;
  }

  private startScore(t: string): boolean {
    const m = t.match(/^You are an? (\S+) (.+?) known as being (.+?)\.?$/);
    if (!m) return false;
    const status: CharacterStatus = { sex: m[1], race: m[2], alignment: m[3] };
    const nameLine = this.lastLine.match(/^You are (\S+?)(?:\s+(.+?))?\.?$/);
    if (nameLine) {
      status.name = nameLine[1];
      status.title = this.lastLine.replace(/^You are /, "").replace(/\.$/, "");
    }
    this.score = { status };
    return true;
  }

  /** Returns true when the line belongs to the score block. */
  private feedScore(t: string): boolean {
    const s = this.score!.status;
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^You are a member of (?:the )?(.+?)\.?$/))) s.guild = m[1];
    else if ((m = t.match(/^You call (.+?) your home\.?$/))) s.home = m[1];
    else if ((m = t.match(/^You are (.+? old)\.?$/))) s.age = m[1];
    else if ((m = t.match(/^You have (\d+) out of (\d+) hit points/i))) {
      s.hp = Number(m[1]);
      s.hpMax = Number(m[2]);
    } else if ((m = t.match(/^You have (\d+) out of (\d+) spell/i))) {
      s.sp = Number(m[1]);
      s.spMax = Number(m[2]);
    } else if ((m = t.match(/^You have (\d+) out of (\d+) Psi/i))) {
      s.pp = Number(m[1]);
      s.ppMax = Number(m[2]);
    } else if (/^STR\s*:/.test(t)) {
      s.stats = {};
      for (const sm of t.matchAll(/([A-Z]{3})\s*:\s*(\d+)/g)) s.stats[sm[1]!] = Number(sm[2]);
    } else if ((m = t.match(/^You have (\d+) experience points/i))) s.exp = Number(m[1]);
    else if ((m = t.match(/^You need (\d+) more experience points to (.+?)\.?$/i))) {
      s.expToNext = Number(m[1]);
      s.nextGain = m[2];
    } else if ((m = t.match(/^You are carrying (\d+) coins?, worth (\d+)/i))) {
      s.coins = Number(m[1]);
      s.coinValue = Number(m[2]);
    } else if ((m = t.match(/^You have (\d+) \w+ in the bank/i))) s.bank = Number(m[1]);
    else if ((m = t.match(/^You have amassed (\d+) Quest Points/i))) s.questPoints = Number(m[1]);
    else if (/^(?:Cmds:|You are in \w+ mode|You are currently carrying|Please use 'help|You feel your)/i.test(t)) {
      // Known trailing score lines with nothing to extract.
    } else return false;
    return true;
  }
}

/** `alias mstoblack => s ; s ; sw` → wire commands; plain `look` → [look]. */
export function splitEchoCommands(rest: string): string[] {
  const alias = rest.match(/^alias \S+ => (.*?)(?: \(skipped Mudlet zScript.*\))?$/);
  if (alias) {
    return alias[1]!
      .split(" ; ")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return rest
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
