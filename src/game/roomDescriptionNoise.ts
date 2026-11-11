import type { GameProfile } from "./profile.js";
import { defaultGameProfile } from "./profile.js";

/**
 * Status prompts glued to the start of a line: the bare `[HP:90 SP:50]` / `[HP:50(58) SP:50(50)]`
 * forms and the `prompt doh` form `[HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 0(49914)]`.
 */
export const LEADING_STATUS_PROMPT_RE = /^(?:\[HP:[^\]\n]*\]\s*)+/i;
/** Stray SGR codes, with or without the ESC byte (`[0mYou sneak …` after a lost escape). */
const LEADING_SGR_RE = /^(?:\x1b?\[[0-9;]*m)+/;

/**
 * Travel/action messages printed right before the arrival room display. They can wrap over two
 * lines (`You grab the handle and tug it a bit.  A section of the wall moves to the side,` /
 * `and you slip right through.`), so the whole sentence is dropped up to the line it ends on.
 */
const TRAVEL_MESSAGE_OPEN: RegExp[] = [
  /^You grab the handle and tug\b/i,
  /^You crawl through (?:the|a|an)\b/i,
  /^You squeeze (?:through|into)\b/i,
  /^You lift up the manhole\b/i,
];

/** Strip leading prompt and stray color codes from one line. */
export function stripLeadingGameNoise(line: string): string {
  return line.replace(LEADING_SGR_RE, "").replace(LEADING_STATUS_PROMPT_RE, "");
}

/** Whole-line patterns that are never part of a verbose room description. */
const NOISE_LINE: RegExp[] = [
  // A line that is only a status prompt (any of the forms above).
  /^\[HP:[^\]]*\]\s*$/i,
  // Player chat in Powermud's `Name shouts : text` / `Name tells you : text` form.
  /^[A-Z][\w'-]*(?: [\w'-]+){0,3} (?:shouts|says|asks|exclaims|whispers|yells|replies|tells you|chats|gossips)(?: to you)? : .*$/,
  // Mobs listed in the room (`Lorax - I speak for the trees is standing here.`).
  /^.+ (?:is|are) (?:standing|sitting|resting|sleeping|lying|floating|hovering|kneeling) here\.?\s*$/i,
  /^[A-Z][\w'-]*(?: [\w'-]+){0,3} arrives\.?\s*$/,
  /^.+ attempts to skulk around in the shadows\.?\s*$/i,
  // Mob → you hits that name a body part, traps and missiles.
  /^.+ (?:slams|whips|smashes|crashes|rams|swings|thrusts) .+ into your\b.*[.!]?\s*$/i,
  /^.+ hits you in the \w+\b.*[.!]?\s*$/i,
  /^.+ fires an? \w+ at you\b.*[.!]?\s*$/i,
  /^The \w+ lifts its head, staring directly into your eyes\.?\s*$/i,
  /^The \w+ peers at you\.?\s*$/i,
  // One-line travel / action messages.
  /^You sneak into the area\b.*[.!]\s*$/i,
  /^You head towards .+[.!]\s*$/i,
  /^You move your way around .+[.!]\s*$/i,
  /^Pete takes all your money, counts it, and hands you a new set of coins\.?\s*$/i,
  /^Autosave\.?\s*$/i,
  // Teleport arrival lines (Zurker 2026-10-31): `homeland` and the Assassin's Guild red stone.
  /^You vanish and then instantly appear in your homeland\.?\s*$/i,
  /^You touch the red stone and are transported instantly to .+[.!]\s*$/i,
  /^You sneak stealthily from the area\.?\s*$/i,
  /^You seemingly blend into your surroundings\.?\s*$/i,
  /^You (?:have )?arrived\.?\s*$/i,
  /^You (?:feel )?tired from all that walking\.?\s*$/i,
  /^You (?:are )?(?:now )?(?:in )?(?:brief|verbose) mode\.?\s*$/i,
  /^Saving\.?\s*$/i,
  /^Saved\.?\s*$/i,
  /^Ok\.?\s*$/i,
  /^Alright\.?\s*$/i,
  /^You (?:tell|say|shout|chat|gossip|emote|reply)\b.*[.!?]\s*$/i,
  // Our own speech in a language (`You exclaim in common : Wow that was a fun trip!`).
  /^You (?:say|ask|exclaim|shout|whisper|yell|reply) in [a-z]+ : .*$/i,
  /^You (?:kill|attack|hit|miss|flee|cast|psi|slash|pierce|stab|kick|punch|dodge|parry|block|backstab|shoot|fire|enter|leave)\b.*[.!?]?\s*$/i,
  /^You (?:killed|slay|slain|defeat|defeated)\b.*[.!?]\s*$/i,
  /^You dodge the .+ attack\b.*[.!?]\s*$/i,
  /^Your .+ takes some damage\.?\s*$/i,
  // Mob → you combat (round messages between room displays)
  /^.+ (?:punches|kicks|bites|claws|slashes|stabs|tramples|scratches|crushes|smashes|touches|burns|blasts|rams) (?:you|at you)\b.*[.!?]?\s*$/i,
  /^The .+ (?:launches at you|rams into you|spits .+ at you|growls|snarls|attacks you)\b.*!?\s*$/i,
  /^The .+ stoops down and sniffs .+\.?\s*$/i,
  // Spell / special combat feedback
  /^.+ protection from .+ deflects\b.*[.!?]\s*$/i,
  /^.+ deflects (?:very little|little|some|much) of the damage\b.*[.!?]\s*$/i,
  /^(?:A )?(?:large )?ball of energy slams into you\b.*[.!?]?\s*$/i,
  /^.+ sent from .+!?\s*$/i,
  /^You (?:open|close|unlock|lock|pick) (?:the )?\w+.*[.!?]\s*$/i,
  /^You (?:get|take|drop|put|give|wear|wield|remove|eat|drink|light|extinguish)\b.*[.!?]\s*$/i,
  /^You (?:cannot|can't|fail to|attempt to)\b.*[.!?]\s*$/i,
  /^You (?:nod|bow|smile|grin|wave|thank)\b.*[.!?]\s*$/i,
  /^You (?:feel|sense|notice|hear|see) (?:that )?(?:your|a|an|the|something)\b.*[.!?]\s*$/i,
  /^The Drow nods his head to you as you leave\.?\s*$/i,
  /^.+ says something in an unknown language\.?\s*$/i,
  /^.+ does a pretty good imitation of .+\.?\s*$/i,
  /^The rothe eats some moss and looks quite happy\.?\s*$/i,
  /^A rothe moos contentedly\.?\s*$/i,
  /^.+ moos contentedly\.?\s*$/i,
  // Hunger tick, more mob → you combat / flavor seen leaking into stored descriptions
  /^Your stomach (?:rumbles|growls)\.?\s*$/i,
  /^.+ (?:slams|crashes|smashes) into you\b.*[.!]?\s*$/i,
  /^.+ breathes \w+ at you\b.*[.!]?\s*$/i,
  /^.+ is having a hard time reeling you in!?\s*$/i,
  /^.+ attempts to sneak [a-z]+, but you notice\.?\s*$/i,
  /^The rothe looks at you with it's huge saucer-shaped eyes\.?\s*$/i,
  // Ambient NPC emotes (timed flavor, not room prose). They often land just before a room
  // display and used to stick to the top of the stored description / display title
  // (r441 "The Myconid stares at you…", r10 "The Bartender wipes up a spill."). Exact lines only:
  // a generic "The <Name> <verb>s …" rule would eat real prose ("The Route continues north…").
  /^The Myconid (?:stares at you with semi-intelligent eyes|grabs a chunk off of a nearby mushroom and starts eating it)\.?\s*$/i,
  /^The Bartender wipes up a spill\.?\s*$/i,
  /^The Drow flits in and out of the shadows\.?\s*$/i,
  /^The Fisherman lets out his line, biding his time\.?\s*$/i,
  /^The Loreman gestures broadly in the air\.?\s*$/i,
  /^The High Priestess directs the students in a chant\.?\s*$/i,
  /^The slave looks for any rothe dung irregularities\.?\s*$/i,
  /^The rothe stamps it'?s hoof and paws the ground\.?\s*$/i,
  /^The cave faerny flies around lightfully in the air\.?\s*$/i,
  /^A bat walks up and down the walls and ceiling\.?\s*$/i,
  // Kalinport: Dinien (guild recruiter, r1543) and the Diamond's merchants.
  /^[A-Z][\w'-]*(?: [\w'-]+){0,2} growls out a few curse words\.?\s*$/,
  /^The merchant is shouting at the top of his lungs, trying to sell his products\.?\s*$/i,
  /^[A-Z][\w'-]*(?: [\w'-]+){0,2} casts a spell on (?:himself|herself|itself)\.?\s*$/,
  /^.+ emerges? from hiding as combat begins\.?\s*$/i,
  // Corpse / item decay ticks.
  /^The (?:corpse|skeletal remains) of .+ (?:is starting to smell|stops? smelling so bad|crumbles? into dust)\.?\s*$/i,
  /^The [A-Z][\w'-]*(?: [\w'-]+){0,2} stops smelling so bad\.?\s*$/,
  // Regen / status ticks.
  /^Your strength returns\.?\s*$/i,
  /^You slowly regain some Skill Points\b.*$/i,
  /^You gain some more Skill Points back\.?\s*$/i,
  /^You sober up a little bit!?\s*$/i,
  /^You are completely sober now\.?\s*$/i,
  // NPC speech: `Bartender asks in drow : What can I get you?`
  /^[A-Z][\w'-]*(?: [\w'-]+){0,3} (?:says|asks|exclaims|shouts|whispers|yells|replies) in [a-z]+ : .*$/,
  // Sky and time-of-day lines (Kalinport / desert rooms print the moon phase under the prose).
  /^The moon is (?:at|in) [A-Z][\w' -]*\.?\s*$/,
  /^The (?:day grows darker|Darkening closes in|Sun is now|sun beats down on you|sun rises|sun sets|night (?:falls|ends))\b.*[.!]?\s*$/i,
  // NPC / mob movement between room displays
  /^.+ arrives from (?:the )?[a-z]+(?: and [a-z]+)?\.?\s*$/i,
  /^.+ leaves (?:to the )?(?:the )?[a-z]+(?: and [a-z]+)?\.?\s*$/i,
  // Walking from the desert into Kalinport's glare (printed instead of, or before, the display).
  /^Your eyes sting from the (?:bright|blinding) light\b.*[.!]\s*$/i,
  // Spell / skill state changes that tick out between moves (found by scripts/map-integrity.ts
  // glued to the top of hundreds of stored rooms, 2026-11-07).
  /^You are no longer (?:blessed|protected|hasted|invisible|flying|shielded|hidden|stoneskinned)\.?\s*$/i,
  /^You (?:feel less protected|lose your blessed feeling)\.?\s*$/i,
  /^You stop hiding\.?\s*$/i,
  /^You float back down to the ground\.?\s*$/i,
  /^You come out of your trance, as you are full\.?\s*$/i,
  /^The veil of Darkness lifts\.?\s*$/i,
  /^You (?:burp|fart) rudely\.?\s*$/i,
  /^You go '[^']*'\s*$/i,
  /^[A-Z][\w'-]*(?: [\w'-]+){0,2} emerges from hiding\.?\s*$/,
  /^You garner some energy from the Weave, feeling refreshed\.?\s*$/i,
  /^The Weave grants you a bit of power!?\s*$/i,
  /^The intense cold bites into you, making your teeth chatter!?\s*$/i,
  /^A new day dawns as the sun rises\.?\s*$/i,
  /^The moon is somewhere between [A-Z][\w' -]* and [A-Z][\w' -]*\.?\s*$/,
];

/** A whole line that is a status prompt (`[HP: 551(620(88%)) SP: …]`), possibly followed by text. */
const STATUS_PROMPT_LINE_RE = /^\s*(?:\x1b?\[[0-9;]*m)*\[HP:\s*\d+[^\]\n]*\]/i;
/**
 * A prompt that ends a line of other output: the LPC pager footer
 * (`=-=-= More (Line 20 of 53) Enter '?' for command list =-=-=[HP: 116(116(100%)) …]`) glued a
 * whole help-file map onto r2686. Whatever the prompt follows belongs to the previous command.
 */
const TRAILING_STATUS_PROMPT_RE = /\[HP:\s*\d+[^\]\n]*\]\s*$/i;
const PAGER_FOOTER_RE = /More \(Line \d+ of \d+\)/i;

/**
 * Powermud wraps long speech and emotes onto lines indented by five spaces
 * (`Kalinport citizen exclaims in common : Out of my way, I am trying to walk` / `     here!`).
 * Short indented lines like that are never the start of room prose; ASCII maps (`#-#`, `|`) are.
 */
export function isWrappedContinuationLine(line: string): boolean {
  if (!/^ {3,}\S/.test(line)) return false;
  const t = line.trim();
  return t.length <= 40 && !/[#|\\/<>=+*_~-]/.test(t) && /[a-z]/i.test(t);
}

/** Verbose room prose usually opens with one of these (capitalized). */
const ROOM_PROSE_OPEN =
  /^(?:You |This |The |Upon |Looking |Standing |Here |Several |Many |Inside |Outside |Directly |Just |Near |Before |After |As |Within |From |All |Some |One |Two |Three |Four |Five |Far |Continuing |Further |North |South |East |West |In |At |A [A-Z]|An [A-Z])/;

const LOWERCASE_ROOM_START =
  /^(?:several|many|one|two|three|four|five|all|some|directly|just|near|far|inside|outside|before|after|within|continuing|further|here|standing|looking|upon|you|this|the|in|at)\b/i;

/**
 * True when `line` is a replayed-buffer fragment (mid-sentence), not a room opener.
 */
export function isLeadingDescriptionFragment(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (ROOM_PROSE_OPEN.test(t)) return false;
  if (LOWERCASE_ROOM_START.test(t)) return false;
  if (/^A (?:small|large|huge|fair|long|short|narrow|wide|dark|dusty|wooden|stone|set|few|couple|bit|trail|path|door|counter|shop|tunnel|hallway|well|very|faint|foul|strange|beautiful|enormous|rot|rotten)\b/i.test(t)) {
    return false;
  }
  if (/^An? (?:old|empty|open|iron|adamantite|enormous|enchanted|ancient|ornate)\b/i.test(t)) return false;
  if (!/^[a-z]/.test(t)) return false;
  const firstWord = t.match(/^([a-z]+)/i)?.[1]?.toLowerCase() ?? "";
  const fragmentStarters = new Set([
    "a",
    "an",
    "as",
    "at",
    "am",
    "me",
    "so",
    "e",
    "or",
    "if",
    "in",
    "on",
    "of",
    "to",
    "and",
    "from",
  ]);
  if (fragmentStarters.has(firstWord)) return true;
  if (firstWord.length <= 2) return true;
  if (/^a,/.test(t)) return true;
  return false;
}

export function isRoomDescriptionNoiseLine(line: string, profile: GameProfile = defaultGameProfile()): boolean {
  const t = line.trim();
  if (!t) return false;
  if (profile.loginNoise.some((re) => re.test(t))) return true;
  if (NOISE_LINE.some((re) => re.test(t))) return true;
  if (isTransitLine(t, profile)) return true;
  return false;
}

/** A ride's own narration (board, depart, arrive, ambient — see `TransitRule`): never room prose. */
export function isTransitLine(line: string, profile: GameProfile = defaultGameProfile()): boolean {
  const t = line.trim();
  if (!t || !profile.transits?.length) return false;
  for (const rule of profile.transits) {
    for (const list of [rule.ticket, rule.board, rule.depart, rule.arrive, rule.ambient]) {
      if (list?.some((re) => re.test(t))) return true;
    }
  }
  return false;
}

/** Drop system / travel / mob lines and replayed leading fragments from a verbose description. */
export function cleanseRoomDescription(description: string, profile: GameProfile = defaultGameProfile()): string | undefined {
  // A status prompt ends whatever came before it: the room display starts after the last one.
  // Older captures glued a cut-off display, `Enter what?` spam or a blinding message onto the
  // next room this way.
  const raw = description.split("\n");
  let start = 0;
  let skipLine = false;
  for (let i = 0; i < raw.length; i++) {
    if (STATUS_PROMPT_LINE_RE.test(raw[i]!)) {
      start = i;
      skipLine = false;
    } else if (TRAILING_STATUS_PROMPT_RE.test(raw[i]!) || PAGER_FOOTER_RE.test(raw[i]!)) {
      // Prompt (or pager footer) at the end of other output: the display starts on the next line.
      start = i;
      skipLine = true;
    }
  }
  if (skipLine) description = raw.slice(start + 1).join("\n");
  else if (start > 0) description = raw.slice(start).join("\n");
  let lines = description
    .split("\n")
    .map((l, i) => (i === 0 ? stripLeadingGameNoise(l) : l).trimEnd())
    .filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1));

  for (;;) {
    while (lines.length && lines[0] !== stripLeadingGameNoise(lines[0]!)) lines[0] = stripLeadingGameNoise(lines[0]!).trimEnd();
    if (!lines.length) break;
    const first = lines[0]!.trim();
    if (!first || isRoomDescriptionNoiseLine(first, profile) || isWrappedContinuationLine(lines[0]!)) {
      lines.shift();
      continue;
    }
    if (TRAVEL_MESSAGE_OPEN.some((re) => re.test(first))) {
      // Drop through the line that ends the sentence (at most 3 lines).
      let end = 0;
      while (end < Math.min(lines.length, 3) - 1 && !/[.!?]\s*$/.test(lines[end]!)) end += 1;
      lines = lines.slice(end + 1);
      continue;
    }
    break;
  }
  while (lines.length && isLeadingDescriptionFragment(lines[0]!.trim())) {
    lines.shift();
  }
  while (lines.length && !lines[0]!.trim()) lines.shift();
  // Trailing ambient lines (`The moon is at Arrival.` under Kalinport prose) change with the
  // hour: kept, they make one room look like a different one at every moon phase.
  while (lines.length && (!lines[lines.length - 1]!.trim() || isRoomDescriptionNoiseLine(lines[lines.length - 1]!.trim(), profile))) {
    lines.pop();
  }

  const out = lines.join("\n").trim();
  return out || undefined;
}
