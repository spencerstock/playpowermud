export type SocialLineKind = "say" | "tell" | "shout" | "channel" | "arrive" | "leave" | "emote";

export type ParsedSocialLine = {
  kind: SocialLineKind;
  name: string;
  channel?: string;
  /** Full plain line (for agent hints). */
  text: string;
  /** Spoken text for say/tell/shout (absent when the language is unknown to you). */
  message?: string;
  /** Emote verb as shown, e.g. `pokes`, `smiles`, `looks`. */
  verb?: string;
  /** Aimed at you: a tell, or an emote/say naming `you`/your character. */
  targetsYou?: boolean;
};

export type ParsedChatLine = {
  kind: "say" | "tell" | "shout";
  /** Speaker label (`You` for outgoing). */
  speaker: string;
  /** Tell target when outgoing (`You tell Bob`). */
  target?: string;
  message: string;
  raw: string;
};

const CHANNEL_LINE = /^\[([^\]]+)\]\s+(\S+)\s*:\s*(.*)$/s;
const ARRIVES = /^(\S+)\s+arrives from\b/i;
const LEAVES = /^(\S+)\s+leaves\b/i;
const SAYS = /^(\S+)\s+(?:says|asks|exclaims)\b/i;
const SAYS_UNKNOWN = /^\S+\s+says something in an unknown language/i;
/** Player soul/emote: `Lorax pokes you in the ribs.`, `Lorax smiles happily.` (actor must be checked). */
const EMOTE = /^([A-Z][A-Za-z'-]*)\s+([a-z]+s)\b(.*)$/;
/** Combat round text shares the emote shape (`Duergar punches you with zeal`). */
const NON_EMOTE_VERBS = new Set(["has", "is", "was", "does", "seems", "appears", "looks like"]);
const COMBAT_EMOTE =
  /\b(?:damage|with zeal|misses you|massacres|obliterates|annihilates|hits you|attacks you|lashes out|breathes?|spits)\b/i;
const SHOUTS = /^(\S+)\s+shouts\b/i;
const TELLS_YOU = /^(\S+)\s+tells you\b/i;
const YOU_SAY = /^You say\b/i;
const YOU_SHOUT = /^You shout\b/i;
const YOU_TELL = /^You tell (\S+)\b/i;

const MOVEMENT_STOP = new Set([
  "you",
  "your",
  "the",
  "a",
  "an",
  "it",
  "announce",
  "channels",
  "prompt",
  "reconnecting",
]);

function normName(name: string): string {
  return name.trim().toLowerCase();
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[.!?]+$/, "").trim();
}

/** Pull spoken text after common Powermud say/tell/shout trailers. */
export function extractChatMessage(kind: ParsedChatLine["kind"], line: string): string {
  const t = line.trim();
  if (kind === "say") {
    const youSay = t.match(/^You say(?:\s+in\s+\S+)?\s*:\s*(.*)$/is);
    if (youSay) return stripTrailingPunct(youSay[1]!);
    const inCommon = t.match(/\b(?:says|asks|exclaims) in common\s*:\s*(.*)$/is);
    if (inCommon) return stripTrailingPunct(inCommon[1]!);
    const says = t.match(/\b(?:says|asks|exclaims)\s+(?:in\s+\S+\s*)?[:\s]+['"]?(.*?)['"]?$/is);
    if (says) return stripTrailingPunct(says[1]!);
  }
  if (kind === "tell") {
    const incoming = t.match(/\btells you\s*[:\s]+['"]?(.*?)['"]?$/is);
    if (incoming) return stripTrailingPunct(incoming[1]!);
    const outgoing = t.match(/^You tell \S+\s*[:\s]+['"]?(.*?)['"]?$/is);
    if (outgoing) return stripTrailingPunct(outgoing[1]!);
  }
  if (kind === "shout") {
    const incoming = t.match(/\bshouts\s*[:\s]+['"]?(.*?)['"]?$/is);
    if (incoming) return stripTrailingPunct(incoming[1]!);
    const outgoing = t.match(/^You shout\s*[:\s]+['"]?(.*?)['"]?$/is);
    if (outgoing) return stripTrailingPunct(outgoing[1]!);
  }
  return t;
}

function mentions(text: string, self?: string | null): boolean {
  if (/\byou(?:rs?|rself)?\b/i.test(text)) return true;
  if (!self) return false;
  return new RegExp(`\\b${self.replace(/[^A-Za-z]/g, "")}\\b`, "i").test(text);
}

/**
 * Social/movement line → actor + kind. The actor is NOT verified as a player here: NPCs say,
 * arrive and emote in the same shapes, so callers (PlayerTracker) must filter by roster.
 * `self` (your character) lets says/emotes that name you count as `targetsYou`.
 */
export function parsePowermudSocialLine(line: string, self?: string | null): ParsedSocialLine | null {
  // `eset tell beep` puts a BEL in front of the speaker.
  const t = line.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  const ch = t.match(CHANNEL_LINE);
  if (ch) {
    if (/^mudwithme$/i.test(ch[1]!.trim())) return null; // hub's own notes
    const out: ParsedSocialLine = {
      kind: "channel",
      name: ch[2]!,
      channel: ch[1]!.trim(),
      text: ch[3]!.trim(),
    };
    if (self && mentions(ch[3]!.replace(/\byou\b/gi, ""), self)) out.targetsYou = true;
    return out;
  }
  let m: RegExpMatchArray | null;
  if ((m = t.match(TELLS_YOU))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    return { kind: "tell", name, text: t, message: extractChatMessage("tell", t), targetsYou: true };
  }
  if ((m = t.match(SAYS))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    if (SAYS_UNKNOWN.test(t)) return { kind: "say", name, text: t };
    const message = extractChatMessage("say", t);
    const out: ParsedSocialLine = { kind: "say", name, text: t, message };
    if (self && mentions(message.replace(/\byou\b/gi, ""), self)) out.targetsYou = true;
    return out;
  }
  if ((m = t.match(SHOUTS))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    return { kind: "shout", name, text: t, message: extractChatMessage("shout", t) };
  }
  if ((m = t.match(ARRIVES))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    return { kind: "arrive", name, text: t };
  }
  if ((m = t.match(LEAVES))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    return { kind: "leave", name, text: t };
  }
  if ((m = t.match(EMOTE))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name)) || NON_EMOTE_VERBS.has(m[2]!) || COMBAT_EMOTE.test(t)) return null;
    return { kind: "emote", name, verb: m[2]!, text: t, targetsYou: mentions(m[3]!, self) };
  }
  return null;
}

const ANNOUNCE_PREFIX = /^ANNOUNCE\s*:\s*(.+)$/i;
const ANNOUNCE_BODY =
  /^(\S+)\s+(?:has entered PowerMud(?: for the first time)?|has left PowerMud|has reconnected to PowerMud|just went linkdead|was killed by)\b/i;

/** Powermud announce channel / login announce replay (not room say). */
export function isPowermudAnnounceLine(line: string): boolean {
  let t = line.trim();
  if (!t || /^PowerMud is rebooting/i.test(t)) return false;
  const prefixed = t.match(ANNOUNCE_PREFIX);
  if (prefixed) t = prefixed[1]!.trim();
  return ANNOUNCE_BODY.test(t);
}

/** Login replay sections (`Tell log`, `Shout log`, `Announce log`, …). */
export function sideChatLogBlockHeader(line: string): boolean {
  const t = line.trim();
  return /^(?:=+\s*)?(?:tell|shout|announce)\s+log\b/i.test(t);
}

export function sideChatLogBlockEnd(line: string): boolean {
  const t = line.trim();
  return /^=+$/.test(t) && t.length >= 20;
}

/** Room `say` only — side chat ignores tell, shout, and announce channels/logs. */
export function parsePowermudSideChatLine(line: string): ParsedChatLine | null {
  const parsed = parsePowermudChatLine(line);
  return parsed?.kind === "say" ? parsed : null;
}

/** Room say / tell / shout lines for the Web UI chat panel (includes your outgoing lines). */
export function parsePowermudChatLine(line: string): ParsedChatLine | null {
  const t = line.trim();
  if (!t) return null;

  let m: RegExpMatchArray | null;
  if ((m = t.match(TELLS_YOU))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    return {
      kind: "tell",
      speaker: name,
      message: extractChatMessage("tell", t),
      raw: t,
    };
  }
  if (YOU_TELL.test(t)) {
    const target = t.match(YOU_TELL)?.[1];
    return {
      kind: "tell",
      speaker: "You",
      target,
      message: extractChatMessage("tell", t),
      raw: t,
    };
  }
  if ((m = t.match(SAYS))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    return {
      kind: "say",
      speaker: name,
      message: extractChatMessage("say", t),
      raw: t,
    };
  }
  if (YOU_SAY.test(t)) {
    return {
      kind: "say",
      speaker: "You",
      message: extractChatMessage("say", t),
      raw: t,
    };
  }
  if ((m = t.match(SHOUTS))) {
    const name = m[1]!;
    if (MOVEMENT_STOP.has(normName(name))) return null;
    return {
      kind: "shout",
      speaker: name,
      message: extractChatMessage("shout", t),
      raw: t,
    };
  }
  if (YOU_SHOUT.test(t)) {
    return {
      kind: "shout",
      speaker: "You",
      message: extractChatMessage("shout", t),
      raw: t,
    };
  }
  return null;
}
