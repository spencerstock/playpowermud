import type { PromptStatus } from "./promptStatus.js";
import { stripAnsi } from "../session/scrollback.js";
import { parseBriefRoomLine } from "./briefRoom.js";
import { canonicalDirection, parseExitList } from "./directions.js";
import { noteDoor, noteDoorsInText, parseDoorLine } from "./doors.js";
import { contentPathLooksLikePlayer, lookupKnownPlayer, knownPlayerRegistry } from "./players.js";
import { classifyNpcKind } from "../mapper/npcs.js";
import { cleanseRoomDescription, isRoomDescriptionNoiseLine, isWrappedContinuationLine } from "./roomDescriptionNoise.js";
import { defaultGameProfile, type GameProfile, type TransitPhase } from "./profile.js";
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
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  "a couple": 2,
  "a couple of": 2,
  couple: 2,
  "a few": 3,
  few: 3,
  some: 3,
  several: 4,
  "lots of": 6,
  many: 6,
  "tons of": 10,
};

const NOT_CONTENTS = /^(?:currently|nothing|no |no$)/i;
const MAX_DESC_LINES = 40;

export type GameStreamOptions = {
  profile?: GameProfile;
  /** Parse `>>> [who] cmd` hub echo lines (log replay). */
  parseCommandEcho?: boolean;
  /** Load Powermud known-player registry (admins) for room contents classification. */
  repoRoot?: string;
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

/**
 * Kind from the MUD's own color when it gives one. `living` true: the name was drawn in the
 * profile's living-thing color, so it is an NPC/mob whatever words it has (`Gem Dealer`).
 * `living` false: a colored session drew it without that color, so it is an object (`Egg`,
 * `Torch`, shop stock). Undefined: no color evidence, keep the name heuristics.
 */
function applyLivingColor(kind: RoomContentKind, name: string, path: string | undefined, living: boolean | undefined): RoomContentKind {
  if (living === undefined || kind === "player" || kind === "corpse") return kind;
  if (living) return kind === "mob" || kind === "npc" ? kind : classifyNpcKind(name, path, "npc");
  return kind === "npc" || kind === "mob" || kind === "unknown" ? "item" : kind;
}

export function parseContentsText(
  body: string,
  registry?: ReturnType<typeof knownPlayerRegistry>,
  living?: boolean,
): RoomContent | null {
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
  return { name: t, count, path, kind: applyLivingColor(classifyContent(t, path, registry), t, path, living) };
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
  /** A contents line carried the profile's living color, so this session has ANSI color on. */
  private sawLivingColor = false;
  private out: GameEvent[] = [];

  constructor(opts?: GameStreamOptions) {
    this.profile = opts?.profile ?? defaultGameProfile();
    this.parseEcho = opts?.parseCommandEcho === true;
    this.playerRegistry = knownPlayerRegistry();
  }

  /** Feed raw MUD text (ANSI allowed). Returns events in order. */
  feed(chunk: string): GameEvent[] {
    this.out = [];
    const text = this.partial + chunk;
    const parts = text.split("\n");
    this.partial = parts.pop() ?? "";
    for (const raw of parts) this.processLine(cleanLine(raw), raw);
    this.processPartialPrompts();
    return this.out;
  }

  /** Treat any buffered partial line as complete and close open blocks (idle / end of replay). */
  flush(): GameEvent[] {
    this.out = [];
    if (this.partial) {
      const p = this.partial;
      this.partial = "";
      this.processLine(cleanLine(p), p);
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

  /**
   * Telnet GA/EOR: the partial line is complete. A recognised prompt is handled as usual;
   * anything else (pager, menu, question) still ends the command, as a bare prompt.
   */
  promptMark(): GameEvent[] {
    this.out = [];
    // MUDs that don't promise GA after prompts keep waiting for the newline, as before.
    if (!this.profile.promptMarks) return this.out;
    this.processPartialPrompts();
    const rest = cleanLine(this.partial);
    this.partial = "";
    if (rest.trim()) {
      this.emit({ type: "line", text: rest });
      if (!this.detectLoginAndMarkers(rest.trim())) this.onPrompt(undefined, true);
    }
    return this.out;
  }

  /** One GMCP message: the profile's translation, then the raw message for listeners. */
  gmcp(pkg: string, data: unknown): GameEvent[] {
    this.out = [];
    for (const ev of this.profile.gmcp?.(pkg, data) ?? []) {
      if (ev.type === "room") {
        // A GMCP room replaces whatever text room was still open.
        this.pendingRoom = null;
        this.exitListOpen = false;
        this.descBuf = [];
      }
      this.emit(ev);
    }
    this.emit({ type: "gmcp", package: pkg, data });
    return this.out;
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
        const read = this.profile.readPrompt(pm);
        this.onPrompt(read.vitals ? { ...read.vitals, at: Date.now() } : undefined, false, read.status);
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

  /** Color evidence for a contents line (see {@link applyLivingColor}); `raw` still has ANSI. */
  private contentLiving(raw: string | undefined): boolean | undefined {
    const color = this.profile.livingContentColor;
    if (!color || raw === undefined) return undefined;
    const at = raw.indexOf("There ");
    if (color.test(at >= 0 ? raw.slice(at) : raw)) {
      this.sawLivingColor = true;
      return true;
    }
    return this.sawLivingColor ? false : undefined;
  }

  private processLine(input: string, raw?: string): void {
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
        const content = parseContentsText(cm[1]!, this.playerRegistry, this.contentLiving(raw));
        if (content) {
          this.pendingRoom.contents.push(content);
          return;
        }
      }
      // Hidden mobs and players are part of the listing; ending the room here dropped every
      // `There is …` line after them, and the hidden mob itself was never recorded.
      const hidden = p.hiddenContentsLine && t.match(p.hiddenContentsLine);
      if (hidden) {
        const name = hidden[1]!.trim();
        const kind = classifyContent(name, undefined, this.playerRegistry);
        this.pendingRoom.contents.push({
          name,
          count: 1,
          kind: kind === "player" ? kind : applyLivingColor(kind, name, undefined, true),
          hidden: true,
        });
        return;
      }
      const occupant = p.occupantLine && t.match(p.occupantLine);
      if (occupant) {
        this.pendingRoom.contents.push({ name: occupant[1]!, count: 1, kind: "player" });
        return;
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
        for (const ex of (p.parseExits ?? parseExitList)(t)) {
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
    if (p.moveHindered?.some((re) => re.test(t))) {
      this.descBuf = [];
      this.emit({ type: "move-hindered", text: t });
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
    const killed = t.match(p.killLine);
    if (killed) {
      this.descBuf = [];
      this.emit({ type: "kill", victim: killed[1]!.trim(), text: t });
      return;
    }

    if (this.detectTransit(t)) {
      this.descBuf = [];
      this.lastNoise = true;
      this.lastLine = t;
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

    const textRooms = p.roomSource === "text";
    const brief = textRooms ? parseBriefRoomLine(t, p) : null;
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

    for (const re of textRooms ? p.verboseExits : []) {
      const m = t.match(re);
      if (m) {
        this.pendingRoom = {
          mode: "verbose",
          description: this.takeDescription(),
          exits: (p.parseExits ?? parseExitList)(m[1]!),
          contents: [],
        };
        noteDoorsInText(this.pendingRoom, this.pendingRoom.description ?? "");
        this.exitListOpen = /,\s*$/.test(m[1]!);
        return;
      }
    }
    if (textRooms && p.noExits.test(t)) {
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

  /**
   * A ride's ticket / board / depart / arrive line (see `TransitRule`): emit it and treat it as a
   * description boundary, so the arrival display is clean and is never read as a compass step.
   */
  private detectTransit(t: string): boolean {
    for (const rule of this.profile.transits ?? []) {
      const phases: [TransitPhase, RegExp[] | undefined][] = [
        ["ticket", rule.ticket],
        ["board", rule.board],
        ["depart", rule.depart],
        ["arrive", rule.arrive],
      ];
      for (const [phase, list] of phases) {
        for (const re of list ?? []) {
          const m = t.match(re);
          if (!m) continue;
          const place = phase === "ticket" ? m[1]?.trim() : undefined;
          this.emit({ type: "transit", rule: rule.id, phase, text: t, ...(place ? { place } : {}) });
          return true;
        }
      }
    }
    return false;
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
    const status = this.profile.score?.start(t, this.lastLine);
    if (!status) return false;
    this.score = { status };
    return true;
  }

  /** Returns true when the line belongs to the score block. */
  private feedScore(t: string): boolean {
    return this.profile.score?.feed(t, this.score!.status) ?? false;
  }
}

/** `alias mstoblack => s ; s ; sw` → wire commands; plain `look` → [look]. */
export function splitEchoCommands(rest: string): string[] {
  // Also `alias n bs lich s => …` (alias called with arguments), `/to ms => w` and smart-alias
  // echoes like `god chief => e`: the text left of ` => ` is what was typed, never a wire command
  // (replays used to record `/to ms => w` as a secret exit).
  const alias = rest.match(/^(?:alias )?[^;]*? => (.*?)(?: \(skipped Mudlet zScript.*\))?$/);
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
