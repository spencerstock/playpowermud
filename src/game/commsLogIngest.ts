import {
  isPowermudAnnounceLine,
  parsePowermudChatLine,
  sideChatLogBlockEnd,
  sideChatLogBlockHeader,
  type ParsedChatLine,
} from "./socialLines.js";

const HUB_ECHO_LINE = /^>>>\s*\[([^\]]+)\]\s*(.*)$/;
const BOT_SOCIAL_VERBS = new Set(["say", "tell", "shout", "gt", "reply", "whisper"]);
const BOT_META_LINE = /^\[mudwithme\]\s*\[bot\]\s*(.+)$/i;

/** Hub input attribution for progression bots (`bot`, `bot:…`). */
export function isBotWho(who: string): boolean {
  const w = who.trim().toLowerCase();
  return w === "bot" || w.startsWith("bot:");
}

/** How many room comm lines (`You say…`) a bot echo will produce. */
export function botSocialLinesFromEchoCommand(cmd: string): number {
  let n = 0;
  const body = cmd.replace(/^alias\s+\S+\s*=>\s*/i, "").trim();
  for (const part of body.split(";")) {
    const c = part.trim();
    if (!c) continue;
    const verb = c.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (BOT_SOCIAL_VERBS.has(verb)) n++;
  }
  return n;
}

export type CommsEntry = {
  at: number;
  kind: ParsedChatLine["kind"];
  speaker: string;
  target?: string;
  message: string;
};

function normChatName(name: string): string {
  return name.trim().toLowerCase();
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

function parseBotMetaLine(plain: string): string | null {
  const m = BOT_META_LINE.exec(plain.trim());
  const text = m?.[1]?.trim();
  return text || null;
}

export type CommsLogIngest = {
  ingestLogText: (text: string, at?: number) => CommsEntry[];
  reset: () => void;
};

export function createCommsLogIngest(getKnownPlayers: () => ReadonlySet<string>): CommsLogIngest {
  let skippingReplayLog = false;
  let suppressYouSocialFromBot = 0;

  function feedEchoLine(plain: string): void {
    const m = HUB_ECHO_LINE.exec(plain);
    if (!m || !isBotWho(m[1]!)) return;
    suppressYouSocialFromBot += botSocialLinesFromEchoCommand(m[2]!);
  }

  function consumeBotYouSocial(entry: CommsEntry): boolean {
    if (entry.speaker !== "You") return false;
    if (suppressYouSocialFromBot <= 0) return false;
    suppressYouSocialFromBot--;
    return true;
  }

  function chatEntryAllowed(entry: CommsEntry): boolean {
    if (entry.kind === "tell" || entry.kind === "shout") return true;
    if (entry.speaker === "You") return true;
    return getKnownPlayers().has(normChatName(entry.speaker));
  }

  function tryPushEntry(entry: CommsEntry, out: CommsEntry[]): void {
    if (consumeBotYouSocial(entry)) return;
    if (!chatEntryAllowed(entry)) return;
    out.push(entry);
  }

  function feedGameLine(plain: string, at: number, out: CommsEntry[]): void {
    if (sideChatLogBlockHeader(plain)) {
      skippingReplayLog = true;
      return;
    }
    if (skippingReplayLog) {
      if (sideChatLogBlockEnd(plain)) skippingReplayLog = false;
      return;
    }
    if (isPowermudAnnounceLine(plain)) return;
    if (parseBotMetaLine(plain) || /^\[mudwithme\]/i.test(plain)) return;

    const parsed = parsePowermudChatLine(plain);
    if (!parsed) return;
    tryPushEntry(
      {
        at,
        kind: parsed.kind,
        speaker: parsed.speaker,
        target: parsed.target,
        message: parsed.message || parsed.raw,
      },
      out,
    );
  }

  function ingestLogText(text: string, at = Date.now()): CommsEntry[] {
    const out: CommsEntry[] = [];
    if (!text) return out;
    const searchable = text.includes("\x1b") ? stripAnsi(text) : text;
    const endsWithNl = searchable.endsWith("\n");
    const lines = searchable.split("\n");
    if (endsWithNl && lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      const plain = line.replace(/\r/g, "").trim();
      if (!plain) continue;
      if (plain.startsWith(">>> [")) {
        feedEchoLine(plain);
        continue;
      }
      feedGameLine(plain, at, out);
    }
    return out;
  }

  function reset(): void {
    skippingReplayLog = false;
    suppressYouSocialFromBot = 0;
  }

  return { ingestLogText, reset };
}
