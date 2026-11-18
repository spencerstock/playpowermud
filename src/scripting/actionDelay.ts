/** `@delay 2` waits 2 seconds, then the rest of the alias or `/when` action continues. */
const DELAY_TOKEN = /@delay\b/gi;
const DELAY_NUMBER = /^\s+(\d+(?:\.\d+)?)(?=\s|$)/i;
const DELAY_COMMAND = /^@delay\s+(\d+(?:\.\d+)?)$/i;

const MAX_DELAY_SECONDS = 3600;

export function parseDelayCommand(line: string): { ms: number } | null {
  const match = DELAY_COMMAND.exec(line.trim());
  if (!match) return null;
  return { ms: Math.round(Number(match[1]) * 1000) };
}

/**
 * Pull `@delay SECONDS` out of one command so surrounding text stays sendable.
 * `@delay 2` is kept as its own part. A bare `@delay` or a non-numeric wait is an error.
 */
export function splitDelayTokens(
  text: string,
): { ok: true; parts: string[] } | { ok: false; reason: string } {
  const parts: string[] = [];
  let cursor = 0;
  DELAY_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DELAY_TOKEN.exec(text)) !== null) {
    const before = text.slice(cursor, match.index).trim();
    const num = DELAY_NUMBER.exec(text.slice(DELAY_TOKEN.lastIndex));
    if (!num?.[1]) {
      return { ok: false, reason: "Bad @delay — use @delay SECONDS (for example @delay 2)" };
    }
    const seconds = Number(num[1]);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_DELAY_SECONDS) {
      return { ok: false, reason: "@delay must be between 0 and 3600 seconds" };
    }
    if (before) parts.push(before);
    parts.push(`@delay ${num[1]}`);
    cursor = DELAY_TOKEN.lastIndex + num[0].length;
    DELAY_TOKEN.lastIndex = cursor;
  }
  const tail = text.slice(cursor).trim();
  if (tail) parts.push(tail);
  return { ok: true, parts };
}

export type ActionDelayIo = {
  send: (lines: string[]) => void;
  sleep?: (ms: number) => Promise<void>;
  /** When this returns false after a wait, the rest of the action is dropped. */
  connected?: () => boolean;
  onError?: (err: unknown) => void;
  /**
   * Local command (`/to`, `/wp`, `/alias`, …). True consumes it: queued MUD lines flush first,
   * then `run` handles it, and the text is not written to the game.
   */
  takes?: (command: string) => boolean;
  run?: (command: string) => Promise<void> | void;
};

/**
 * Send `commands` in order. `@delay N` pauses N seconds and is not written to the MUD.
 * Commands with no delay between them still go out together.
 */
export async function runActionSteps(commands: string[], io: ActionDelayIo): Promise<void> {
  const flat: string[] = [];
  for (const command of commands) {
    const bits = splitDelayTokens(command);
    if (!bits.ok) {
      io.onError?.(new Error(bits.reason));
      return;
    }
    flat.push(...bits.parts);
  }

  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let batch: string[] = [];

  const flush = (): boolean => {
    if (!batch.length) return true;
    if (io.connected && !io.connected()) {
      batch = [];
      return false;
    }
    const lines = batch;
    batch = [];
    io.send(lines);
    return true;
  };

  try {
    for (const part of flat) {
      const delay = parseDelayCommand(part);
      if (delay) {
        if (!flush()) return;
        if (delay.ms > 0) await sleep(delay.ms);
        if (io.connected && !io.connected()) return;
        continue;
      }
      if (io.takes?.(part)) {
        if (!flush()) return;
        if (io.connected && !io.connected()) return;
        await io.run?.(part);
        continue;
      }
      batch.push(part);
    }
    flush();
  } catch (err) {
    io.onError?.(err);
  }
}
