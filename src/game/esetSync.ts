import { stripAnsi } from "../session/scrollback.js";

/**
 * Channel colors applied only when that variable is missing from `eset`.
 * Taken from a live listing: announce/auction/chat/emote/fields/groupchat/guild/race/say/shout/tell.
 */
export const CHANNEL_ESET_DEFAULTS: Readonly<Record<string, string>> = {
  announce: "bold yellow",
  auction: "bold yellow",
  chat: "bold green",
  emote: "cyan",
  fields: "green",
  groupchat: "bold magenta",
  guild: "green",
  race: "green",
  say: "green",
  shout: "bold cyan",
  tell: "bold green",
};

const HEADER = /^variable\s+setting$/i;
const SEPARATOR = /^[=\-]{8,}$/;
const ROW = /^([A-Za-z][A-Za-z0-9_]*)\s+(\S.*)$/;
const PROMPT = /^(?:\[HP:|> )/i;
const GAME_LINE =
  /^(?:\[[^\]]+\]\s+\S+\s*:|(?:\S+\s+)?(?:says|asks|exclaims|shouts|tells you)\b|ANNOUNCE\s*:|There (?:is|are)\b|The only obvious exits?\b|Obvious exits?\b|\S+\s+(?:arrives|leaves)\b)/i;

const MAX_HOLD = 48_000;

export type EsetSettings = Map<string, string>;

export function isPromptLine(line: string): boolean {
  return PROMPT.test(stripAnsi(line).trim());
}

/** Parse an `eset` listing. Null when the header block is not in `text`. */
export function parseEsetListing(text: string): EsetSettings | null {
  const lines = stripAnsi(text).split(/\r?\n/);
  const headerAt = lines.findIndex((l) => HEADER.test(l.trim()));
  if (headerAt < 0) return null;
  if (!SEPARATOR.test(lines[headerAt + 1]?.trim() ?? "")) return null;
  const settings: EsetSettings = new Map();
  for (let i = headerAt + 2; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    if (isPromptLine(trimmed)) break;
    const row = ROW.exec(trimmed);
    if (!row) break;
    settings.set(row[1]!.toLowerCase(), row[2]!.trim());
  }
  return settings;
}

/**
 * Commands to send after reading `eset`.
 * Missing channel colors are filled in. `ansi` is turned on when it is not already on.
 * `no_moon` is set on unless the character specifically has it off.
 * `more_length` and `follow` are set only when those variables are absent.
 */
export function esetFixCommands(settings: EsetSettings): string[] {
  const cmds: string[] = [];
  if (settings.get("ansi")?.toLowerCase() !== "on") cmds.push("eset ansi on");
  for (const [name, value] of Object.entries(CHANNEL_ESET_DEFAULTS)) {
    if (!settings.has(name)) cmds.push(`eset ${name} ${value}`);
  }
  const moon = settings.get("no_moon");
  if (moon?.toLowerCase() !== "off" && moon?.toLowerCase() !== "on") cmds.push("eset no_moon on");
  if (!settings.has("more_length")) cmds.push("eset more_length 50");
  if (!settings.has("follow")) cmds.push("eset follow on");
  return cmds;
}

export type EsetConsume = { visible: string; send: string[] };

/**
 * Hides the login `eset` listing (and the follow-up `eset` writes) from the terminal.
 * One query per time the session enters the game; leaving the game arms it again.
 */
export class EsetLoginSync {
  private mode: "idle" | "hold" | "acks" = "idle";
  private buf = "";
  private sawInGame = false;
  private acksLeft = 0;
  private ackNames: string[] = [];
  private gagPrompt = false;
  private hiddenPrompt = "";

  /** First entry to the game this visit. Returns the query to send. */
  onEnteredGame(): string | null {
    if (this.sawInGame) return null;
    this.sawInGame = true;
    this.mode = "hold";
    this.buf = "";
    this.acksLeft = 0;
    this.ackNames = [];
    this.gagPrompt = false;
    this.hiddenPrompt = "";
    return "eset";
  }

  /** Menu, disconnect, or a new login. The next character is queried again. */
  leaveGame(): void {
    this.sawInGame = false;
    this.mode = "idle";
    this.buf = "";
    this.acksLeft = 0;
    this.ackNames = [];
    this.gagPrompt = false;
    this.hiddenPrompt = "";
  }

  consume(chunk: string): EsetConsume {
    if (this.mode === "hold") return this.consumeHold(chunk);
    if (this.mode === "acks") return this.consumeAcks(chunk);
    return { visible: chunk, send: [] };
  }

  private consumeHold(chunk: string): EsetConsume {
    this.buf += chunk;
    if (this.buf.length > MAX_HOLD) return this.abortHold();
    const { lines, rest } = splitLines(this.buf);
    const plain = lines.map((l) => stripAnsi(l).trim());
    const headerAt = plain.findIndex((l) => HEADER.test(l));
    if (headerAt < 0) {
      if (plain.some((l) => isPromptLine(l)) || isPromptLine(rest)) return this.abortHold();
      return { visible: "", send: [] };
    }
    if (headerAt + 1 >= lines.length) return { visible: "", send: [] };
    if (!SEPARATOR.test(plain[headerAt + 1] ?? "")) return this.abortHold();

    const hide = new Set<number>([headerAt, headerAt + 1]);
    for (let i = 0; i < headerAt; i++) {
      if (/^eset$/i.test(plain[i] ?? "")) hide.add(i);
    }
    let scan = headerAt + 2;
    let closed = false;
    for (; scan < lines.length; scan++) {
      const t = plain[scan] ?? "";
      if (!t || isEsetRow(t)) {
        hide.add(scan);
        continue;
      }
      closed = true;
      break;
    }
    const restPlain = stripAnsi(rest).trim();
    const restIsPrompt = restPlain.length > 0 && isPromptLine(rest);
    if (!closed && !restIsPrompt) return { visible: "", send: [] };

    let visible = "";
    for (let i = 0; i < lines.length; i++) {
      if (!hide.has(i)) visible += `${lines[i]}\n`;
    }
    if (restIsPrompt || (closed && rest)) visible += rest;

    const settings = parseEsetListing(lines.filter((_, i) => hide.has(i)).join("\n"));
    this.buf = "";
    const send = settings ? esetFixCommands(settings) : [];
    if (send.length > 0) {
      this.mode = "acks";
      this.acksLeft = send.length;
      this.ackNames = send.map((c) => c.split(/\s+/)[1]!.toLowerCase());
      this.gagPrompt = false;
      this.hiddenPrompt = "";
    } else {
      this.mode = "idle";
    }
    return { visible, send };
  }

  private abortHold(): EsetConsume {
    const visible = this.buf;
    this.buf = "";
    this.mode = "idle";
    return { visible, send: [] };
  }

  private consumeAcks(chunk: string): EsetConsume {
    this.buf += chunk;
    const { lines, rest } = splitLines(this.buf);
    let visible = "";
    let consumed = 0;
    const stop = (fromLine: number, includeRest: boolean): EsetConsume => {
      if (this.hiddenPrompt) {
        visible += this.hiddenPrompt;
        this.hiddenPrompt = "";
      }
      for (let i = fromLine; i < lines.length; i++) visible += `${lines[i]}\n`;
      if (includeRest) visible += rest;
      this.buf = "";
      this.mode = "idle";
      this.acksLeft = 0;
      this.gagPrompt = false;
      return { visible, send: [] };
    };

    for (; consumed < lines.length; consumed++) {
      const line = lines[consumed]!;
      const t = stripAnsi(line).trim();
      if (isPromptLine(t)) {
        if (this.gagPrompt && this.acksLeft > 0) {
          this.acksLeft -= 1;
          this.gagPrompt = false;
          this.hiddenPrompt = line;
          if (this.acksLeft === 0) {
            visible += line;
            this.hiddenPrompt = "";
            consumed += 1;
            return stop(consumed, true);
          }
          continue;
        }
        return stop(consumed, true);
      }
      if (GAME_LINE.test(t)) return stop(consumed, true);
      if (isAckLine(t, this.ackNames)) {
        this.gagPrompt = true;
        continue;
      }
      return stop(consumed, true);
    }

    if (rest && isPromptLine(rest)) {
      this.buf = "";
      if (this.gagPrompt && this.acksLeft > 0) {
        this.acksLeft -= 1;
        this.gagPrompt = false;
        if (this.acksLeft === 0) {
          this.mode = "idle";
          return { visible: visible + rest, send: [] };
        }
        this.hiddenPrompt = rest;
        return { visible, send: [] };
      }
      return stop(lines.length, true);
    }
    this.buf = rest;
    return { visible, send: [] };
  }
}

function isEsetRow(trimmed: string): boolean {
  return ROW.test(trimmed);
}

function isAckLine(trimmed: string, names: string[]): boolean {
  if (!trimmed) return true;
  if (HEADER.test(trimmed) || SEPARATOR.test(trimmed)) return true;
  if (/^eset\b/i.test(trimmed)) return true;
  if (/\bset to\b/i.test(trimmed)) return true;
  if (/^ok\.?$/i.test(trimmed)) return true;
  if (isEsetRow(trimmed)) return true;
  const low = trimmed.toLowerCase();
  return names.some((n) => low === n || low.startsWith(`${n} `));
}

function splitLines(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split(/\r?\n/);
  if (/\r?\n$/.test(buf)) {
    parts.pop();
    return { lines: parts, rest: "" };
  }
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}
