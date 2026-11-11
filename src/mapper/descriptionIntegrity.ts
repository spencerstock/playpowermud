/**
 * Structural detection of game output glued onto stored room descriptions.
 *
 * `roomDescriptionNoise.ts` is a denylist: it only drops lines it already knows. Anything new
 * (`You are no longer blessed.`, `The lizard man licks his lips.`, a pager screen) slips through,
 * and `preferDescription` used to let such a longer view replace a clean one. This module looks
 * at the *shape* of a description instead:
 *
 * - Powermud room prose is one paragraph wrapped near 80 columns. A line that ends a sentence
 *   while the next word would still have fit is a hard break, and a blank line is a paragraph
 *   break: both split the description into blocks.
 * - Edge blocks (before or after the main prose) are then judged with evidence from the map:
 *   the line names a mob seen somewhere on the map, it is a second-person event (`You stop
 *   hiding.`), it starts mid-sentence, it repeats, it shows up at the edge of rooms in unrelated
 *   areas, or removing it leaves exactly another room's description.
 *
 * Every removal carries its reasons and a confidence so a report can be reviewed before a fix.
 */
import { isRoomDescriptionNoiseLine } from "../game/roomDescriptionNoise.js";
import type { MapRoom, WorldGraphDocument } from "./types.js";

/** Powermud wraps at 80 columns; a line ending this many columns short could have taken another word. */
const WRAP_WIDTH = 80;
const WRAP_SLACK = 3;
/** Edge blocks longer than this are prose, whatever they look like. */
const MAX_NOISE_BLOCK = 120;
/** Recurring edge blocks this short that span unrelated areas are game messages. */
const MAX_RECURRING_BLOCK = 90;
/** Never strip a description below this much prose. */
const MIN_REMAINING_PROSE = 40;

export type DescBlock = {
  /** Lines joined with single spaces. */
  text: string;
  /** Raw lines (right-trimmed). */
  lines: string[];
  /** Index of the first raw line in the description. */
  start: number;
  /** Index after the last raw line. */
  end: number;
  /** A blank line follows this block. */
  blankAfter: boolean;
};

export type NoiseConfidence = "certain" | "likely";

export type NoiseReason =
  | "known-noise"
  | "fragment"
  | "repeated"
  | "mob-action"
  | "player-action"
  | "second-person"
  | "combat"
  | "recurring"
  | "twin"
  | "blank-separated";

export type RemovedBlock = {
  edge: "head" | "tail";
  text: string;
  reasons: NoiseReason[];
  confidence: NoiseConfidence;
};

export type ScrubResult = { text: string; removed: RemovedBlock[] };

/** Map-wide evidence for {@link scrubDescription}. Build once with {@link buildNoiseContext}. */
export type NoiseContext = {
  /** Lowercase mob names seen in any room (`lizard man`, `drow slavemaster`). */
  actors: Set<string>;
  /** Lowercase player names (our characters and others) whose actions leak into displays. */
  players: Set<string>;
  /** Edge block text → distinct areas (area or plane) it was seen at the edge of. */
  edgeSpread: Map<string, Set<string>>;
  /** Normalized whole descriptions on the map → room ids (twin proof). */
  wholeDescriptions: Map<string, string[]>;
};

const SENTENCE_END = /[.!?'")\]]$/;
const DOOR_LINE = /\(\s*(?:OPENED|CLOSED|LOCKED)\s*\)\.?\s*$/i;
/** `You are standing in…`, `You have arrived at…`: a second-person *place* opener is prose. */
const PLACE_OPENER =
  /^You (?:are|stand|now stand|find yourself|have (?:arrived|come|entered|reached|stumbled|run|wandered|walked|uncovered|stepped)|enter(?:ed)? (?:a|an|the|into)\b|look (?:out|around|up|down))\b.*\b(?:in|on|at|before|inside|outside|near|under|beneath|above|upon|along|beside|between|within|among|amongst|standing|somewhere|directly|into|onto|atop|across|over|through|room|area|place|chamber|hall|cave|tunnel|road|path|trail|street|forest|desert)\b/i;

const COMBAT_WORD =
  /\b(?:damage|hits|strikes|slashes|slices|bashes|beams|smashes|kicks|punches|bites|claws|skewers|impales|stabs|burns|blasts|attacks|misses|dodges|parries)\b/i;

function norm(s: string): string {
  return s.toLowerCase().replace(/\(\s*(?:opened|closed|locked)\s*\)/g, " ").replace(/\s+/g, " ").trim();
}

/** Sentences in a block: terminators followed by whitespace and a capital (or end). */
function sentenceCount(text: string): number {
  const m = text.match(/[.!?]+['")]?(?=\s+[A-Z"']|\s*$)/g);
  return Math.max(1, m?.length ?? 0);
}

/** Split a description into blocks at blank lines and at hard line breaks (see module doc). */
export function descriptionBlocks(desc: string): DescBlock[] {
  const lines = desc.split("\n").map((l) => l.trimEnd());
  const out: DescBlock[] = [];
  let cur: string[] = [];
  let start = 0;
  const flush = (end: number, blankAfter: boolean) => {
    if (cur.length) out.push({ text: cur.map((l) => l.trim()).join(" "), lines: cur, start, end, blankAfter });
    cur = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      if (cur.length) flush(i, true);
      else if (out.length) out[out.length - 1]!.blankAfter = true;
      continue;
    }
    if (!cur.length) start = i;
    cur.push(line);
    const next = lines[i + 1];
    if (next?.trim()) {
      const firstWord = next.trim().split(/\s+/)[0]!;
      // Indented lines (maps, signs) and lines that are clearly not wrapped prose also break.
      const hard = line.length + 1 + firstWord.length <= WRAP_WIDTH - WRAP_SLACK && SENTENCE_END.test(line);
      if (hard) flush(i + 1, false);
    }
  }
  flush(lines.length, false);
  return out;
}

function edgeKey(text: string): string {
  return norm(text);
}

/** Words that start mob names (`Small boy`) but also start prose (`The small path continues…`). */
const GENERIC_NAME_WORDS = new Set(["small", "large", "big", "huge", "giant", "old", "young", "little", "tall", "dark", "great"]);
const VERB_LIKE = /^(?:is|are|was|were|has|have|does|can|will|just|suddenly|slowly|quickly|\w+(?:s|ed))[,.!?]*$/;

/** The subject of a sentence names a known actor and a verb follows: `The lizard man licks…`. */
function namesActor(text: string, names: Set<string>): boolean {
  const lower = text.toLowerCase().replace(/^(?:the|a|an)\s+/, "");
  const words = lower.split(/\s+/);
  // Longest prefix first (`drow slavemaster` before `drow`).
  for (let n = Math.min(5, words.length - 1); n >= 1; n--) {
    const raw = words.slice(0, n).join(" ");
    const possessive = /'s$/.test(raw);
    const cand = raw.replace(/'s$/, "").replace(/[^a-z' -]+$/, "");
    if (cand.length < 3 || !names.has(cand)) continue;
    if (n === 1 && GENERIC_NAME_WORDS.has(cand)) continue;
    if (possessive || VERB_LIKE.test(words[n] ?? "")) return true;
  }
  return false;
}

/** Areas a room counts toward for recurrence (named area, else its plane). */
function roomSpreadKey(room: MapRoom): string {
  return room.area ?? room.pos?.plane ?? "?";
}

export function buildNoiseContext(doc: WorldGraphDocument, opts: { players?: Iterable<string> } = {}): NoiseContext {
  const actors = new Set<string>();
  const edgeSpread = new Map<string, Set<string>>();
  const wholeDescriptions = new Map<string, string[]>();
  for (const room of Object.values(doc.rooms)) {
    for (const c of Object.values(room.contents ?? {})) {
      if (c.kind !== "npc" && c.kind !== "unknown") continue;
      const name = c.name.toLowerCase().trim();
      if (name.length >= 3) actors.add(name);
      // `Kalinport guard` is also announced as `The guard …`.
      const last = name.split(/\s+/).pop()!;
      if (last.length >= 4 && last !== name) actors.add(last);
    }
    for (const n of room.npcs ?? []) actors.add(n.toLowerCase());
    if (!room.description) continue;
    const n = norm(room.description);
    wholeDescriptions.set(n, [...(wholeDescriptions.get(n) ?? []), room.id]);
    const blocks = descriptionBlocks(room.description);
    if (blocks.length < 2) continue;
    for (const b of [blocks[0]!, blocks[blocks.length - 1]!]) {
      const k = edgeKey(b.text);
      let s = edgeSpread.get(k);
      if (!s) edgeSpread.set(k, (s = new Set()));
      s.add(roomSpreadKey(room));
    }
  }
  const players = new Set([...(opts.players ?? [])].map((p) => p.toLowerCase()));
  return { actors, players, edgeSpread, wholeDescriptions };
}

/** Evidence that an edge block is not room prose. Empty when it should stay. */
export function judgeEdgeBlock(
  block: DescBlock,
  edge: "head" | "tail",
  ctx: NoiseContext,
  opts: { rest: string; roomId?: string; previous?: DescBlock },
): { reasons: NoiseReason[]; confidence: NoiseConfidence } | null {
  const text = block.text;
  const reasons: NoiseReason[] = [];
  let certain = false;
  // Door state lines are real room output (normalized out of keys); never strip them.
  if (DOOR_LINE.test(text)) return null;

  if (block.lines.every((l) => isRoomDescriptionNoiseLine(l.trim()))) {
    reasons.push("known-noise");
    certain = true;
  }
  if (edge === "head" && opts.rest) {
    const twins = ctx.wholeDescriptions.get(norm(opts.rest)) ?? [];
    if (twins.some((id) => id !== opts.roomId)) {
      reasons.push("twin");
      certain = true;
    }
  }
  const short = text.length <= MAX_NOISE_BLOCK && sentenceCount(text) <= 1;
  if (edge === "head") {
    // Mid-sentence leftovers (`sell?`, `bartender for information.`): wrapped NPC speech.
    if (/^[a-z0-9<>'"(]/.test(text) && text.length <= MAX_NOISE_BLOCK) {
      reasons.push("fragment");
      certain = true;
    }
    if (block.lines.length >= 2 && new Set(block.lines.map((l) => l.trim())).size === 1) {
      reasons.push("repeated");
      certain = true;
    }
    if (short) {
      if (namesActor(text, ctx.actors)) reasons.push("mob-action");
      if (ctx.players.size && namesActor(text, ctx.players)) reasons.push("player-action");
      const youEvent =
        (/^You\b/.test(text) && !PLACE_OPENER.test(text)) || (/\byour?\b/i.test(text) && /!\s*$/.test(text));
      if (youEvent) reasons.push("second-person");
      // `Gianteye beams energy at you solidly, causing moderate damage.`
      if (!youEvent && /\byou\b/i.test(text) && COMBAT_WORD.test(text)) reasons.push("combat");
      if (block.blankAfter && reasons.length) reasons.push("blank-separated");
    }
  }
  if (short && text.length <= MAX_RECURRING_BLOCK && (ctx.edgeSpread.get(edgeKey(text))?.size ?? 0) >= 2) {
    // Shared prose (`You are standing in the Kalinport Sewers…`) stays inside one area; a game
    // message turns up at the edge of rooms all over the map.
    if (edge === "head" || /^(?:The moon|The sun|A new day|Night)\b/.test(text)) reasons.push("recurring");
  }
  if (!reasons.length) return null;
  const confidence: NoiseConfidence = certain || reasons.filter((r) => r !== "blank-separated").length >= 2 ? "certain" : "likely";
  return { reasons, confidence };
}

/**
 * Remove edge blocks that are game output. `minConfidence: "certain"` only strips blocks with
 * proof or two independent signals. The main prose (and at least {@link MIN_REMAINING_PROSE}
 * characters) is always kept.
 */
export function scrubDescription(
  desc: string,
  ctx: NoiseContext,
  opts: { roomId?: string; minConfidence?: NoiseConfidence } = {},
): ScrubResult {
  const accept = (c: NoiseConfidence) => opts.minConfidence !== "certain" || c === "certain";
  let blocks = descriptionBlocks(desc);
  const removed: RemovedBlock[] = [];
  const restText = (bs: DescBlock[]) => bs.map((b) => b.lines.join("\n")).join("\n");
  for (;;) {
    if (blocks.length < 2) break;
    const head = blocks[0]!;
    const rest = blocks.slice(1);
    const restJoined = restText(rest);
    if (norm(restJoined).length < MIN_REMAINING_PROSE) break;
    const verdict = judgeEdgeBlock(head, "head", ctx, { rest: restJoined, roomId: opts.roomId });
    if (!verdict || !accept(verdict.confidence)) break;
    removed.push({ edge: "head", text: head.text, ...verdict });
    blocks = rest;
  }
  for (;;) {
    if (blocks.length < 2) break;
    const tail = blocks[blocks.length - 1]!;
    const rest = blocks.slice(0, -1);
    const restJoined = restText(rest);
    if (norm(restJoined).length < MIN_REMAINING_PROSE) break;
    const verdict = judgeEdgeBlock(tail, "tail", ctx, { rest: restJoined, roomId: opts.roomId });
    if (!verdict || !accept(verdict.confidence)) break;
    removed.push({ edge: "tail", text: tail.text, ...verdict });
    blocks = rest;
  }
  if (!removed.length) return { text: desc, removed };
  // Rebuild from the original lines so wrapping and inner blank lines survive.
  const lines = desc.split("\n");
  const first = blocks[0]!.start;
  const last = blocks[blocks.length - 1]!.end;
  return { text: lines.slice(first, last).join("\n").trim(), removed };
}

/** Descriptions that are not a room at all: character creation, pager screens, menus. */
const NON_ROOM_MARKERS: RegExp[] = [
  /\(y or n\)\s*:/i,
  /Please enter your (?:real name|email|gender)/i,
  /Use 'stop' at any time to stop the process/i,
  /Enter '\?' for command list/i,
  /More \(Line \d+ of \d+\)/i,
];

export function nonRoomMarkers(desc: string): string[] {
  return NON_ROOM_MARKERS.filter((re) => re.test(desc)).map((re) => re.source);
}
