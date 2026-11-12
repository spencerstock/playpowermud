import type { GameProfile, ScoreParser } from "../../game/profile.js";
import { promptStatusFromMatch } from "../../game/promptStatus.js";
import { POWERMUD_TRANSITS } from "./transits.js";
import type { CharacterStatus } from "../../game/types.js";

/** PowerMUD `score` block: `You are Zim the …` then `You are a male gnome known as being …`. */
export const POWERMUD_SCORE: ScoreParser = {
  start(t, previousLine) {
    const m = t.match(/^You are an? (\S+) (.+?) known as being (.+?)\.?$/);
    if (!m) return null;
    const status: CharacterStatus = { sex: m[1], race: m[2], alignment: m[3] };
    const nameLine = previousLine.match(/^You are (\S+?)(?:\s+(.+?))?\.?$/);
    if (nameLine) {
      status.name = nameLine[1];
      status.title = previousLine.replace(/^You are /, "").replace(/\.$/, "");
    }
    return status;
  },
  feed(t, s) {
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
    // "You belong to House Bey-Sandrax." sits between home and age (live 2026-11-02); unknown lines end
    // the block, so without it the score lost its HP/SP/exp lines.
    else if (/^(?:Cmds:|You are in \w+ mode|You are currently carrying|Please use 'help|You feel your|You belong to |You are set to wimpy|You find it hard to walk)/i.test(t)) {
      // Known trailing score lines with nothing to extract.
    } else return false;
    return true;
  },
};

export const POWERMUD_PROFILE: GameProfile = {
  id: "powermud",
  /** Powermud `prompt hpsp` → `[HP:99 SP:50]`; optional `(max)` and `PP` when enabled. */
  /**
   * Groups 1-6: hp, hpMax, sp, spMax, pp, ppMax. Status prompt (`prompt doh`) adds
   * 7 exp, 8 expToNext, 9 drakaan carried, 10 bank — see src/game/promptStatus.ts.
   */
  promptPrefix:
    /^\[HP:\s*(\d+)(?:\((\d+)(?:\(\d+%\))?\))?\s+SP:\s*(\d+)(?:\((\d+)(?:\(\d+%\))?\))?(?:\s+PP:\s*(\d+)(?:\((\d+)(?:\(\d+%\))?\))?)?(?:\s+XP:\s*(\d+)(?:\((\d+)(?:\(\d+%\))?\))?)?(?:\s+Cash:\s*(\d+)(?:\((\d+)\))?)?\]/i,
  readPrompt: (pm) => ({
    vitals: {
      hp: Number(pm[1]),
      hpMax: pm[2] !== undefined ? Number(pm[2]) : undefined,
      sp: Number(pm[3]),
      spMax: pm[4] !== undefined ? Number(pm[4]) : undefined,
      pp: pm[5] !== undefined ? Number(pm[5]) : undefined,
      ppMax: pm[6] !== undefined ? Number(pm[6]) : undefined,
    },
    status: promptStatusFromMatch(pm),
  }),
  barePromptPrefix: /^> /,
  combatStatus: /^\[\s*HP\s*:\s*(\d+)\((\d+)\)\s*SP\s*:\s*(\d+)\((\d+)\)(?:\s*PP\s*:\s*(\d+)\((\d+)\))?(?:\s*Attacker\s*:\s*(.+?))?\s*\]\s*$/,
  roomSource: "text",
  briefRoom: /^([A-Z0-9"'][^()\[\]]{0,120}?) \(((?:[a-z]{1,12})(?:,\s?[a-z]{1,12})*|none|)\)\.?\s*$/,
  verboseExits: [
    /^The only obvious exits? (?:is|are)\s*:\s*(.+?)\s*$/i,
    /^Obvious exits? (?:is|are)\s*:\s*(.+?)\s*$/i,
  ],
  noExits: /^There are no obvious exits\.?\s*$/i,
  contentsLine: /^There (?:is|are) (.+)$/,
  // Live 2026-11: `There is one \x1b[1m\x1b[35mBandit\x1b[0m.`; objects are plain or yellow.
  livingContentColor: /\x1b\[1m\x1b\[35m/,
  hiddenContentsLine: /^You notice (.+?) skulking around, trying to blend in\.?\s*$/,
  // Players show on their own line, name in green: `Fiz celebrating for Vipey is standing here.`
  occupantLine:
    /^([A-Z][A-Za-z'-]*)\b.*? is (?:standing|resting|sitting|sleeping|kneeling|lying|meditating|floating|hovering|flying)(?: [a-z ]+?)? here\.?\s*$/,
  moveFailed: [
    /^You cannot go that direction\.?/i,
    /^You can'?t go that way\.?/i,
    /^Alas, you cannot go that way/i,
    /^What ?\?\s*$/,
    /^You are too busy fighting/i,
    /^You can'?t move/i,
    /^You are unable to climb/i,
    /^You fail to climb/i,
    /^You should not go .* until/i,
  ],
  // The small boy at the Caravan Route's north end (below Mt. Kulajo) trips you as you leave,
  // usually twice: each trip eats one queued move (live 2026-11-04).
  moveHindered: [/^The small boy trips you!/i],
  // Deepwater docks / Waterside Road: `Your eyes sting from the blinding light, leaving you not
  // able to see for a` / `brief moment.` (live 2026-11-04). Threshold goat pen / outdoor cave:
  // `Your eyes sting from the bright light, and you are blinded for a moment!` (live 2026-11-05
  // Wybie r2768→r2767 / r2767→r2764). Both mean the move went through into a room we cannot see;
  // treating them as a lost display left the mapper put and falsely blocked the exit ("did not
  // move"), breaking the goat lap (No known path from r2768 to r2767).
  darkRoom:
    /^(?:It is too dark\.?\s*|You may get dizzy if you look around like that!?\s*|Your eyes sting from the (?:bright|blinding) light\b.*)$/i,
  fleeMoved: /^You flee like the wind, (\w+)!/i,
  fleeFailed: [/^You fail to flee/i, /^You attempt to flee,? but (?:go nowhere|fail)/i],
  killLine: /^You killed (.+?)\.\s*$/i,
  teleportCommands: /^(?:pray|regenerate|recall|home|goto\s.*|cast\s+(?:teleport|word of recall|recall|gate)\b.*)$/i,
  nonMovementCommands:
    /^(?:cast|psi|say|'|"|tell|reply|shout|chat|gossip|emote|:|who|score|sc|i|inv|inventory|eq|equipment|help|skills|spells|psionics|disciplines|schools|effects|list|buy|sell|value|get|take|drop|put|give|wear|wield|remove|rem|kill|k|attack|consider|con|train|practice|prac|learn|time|date|uptime|save|quit|brief|verbose|prompt|alias|unalias|consolidate|deposit|withdraw|balance|bank|eat|drink|light|extinguish|open|close|unlock|lock|search|examine|exam|read|wimpy|rest|sit|stand|sleep|wake|succor|first|follow|group|lastname|title|description|mail|news|finger|mudlist|releases|hide|sneak|backstab|bs|dt|gauge|bury|loot|cost|trance|who\s.*|look\s+(?:at|in)\s.*|l\s+(?:at|in)\s.*)(?:\s|$)/i,
  lookCommands: /^(?:l|look|glance)$/i,
  login: {
    userPrompt: /What is your user name\?/i,
    passwordPrompt: /^\W*Password\s*:/i,
    accountMenu: /Available Commands/i,
    throwOut: /Throw out other copy\?\s*\(Y\/N\)/i,
    newUserWarning: /You are attempting to create a new USER/i,
    badPassword: /(?:Wrong|Incorrect|Invalid) password/i,
    badCharacter: /(?:not linked to|No such character|is not one of your characters)/i,
  },
  inGameMarkers: [
    /^Prompt now set/i,
    /has reconnected to PowerMud/i,
    /^Reconnecting\.\./i,
  ],
  deathMarkers: [
    /^ANNOUNCE : (\w+) was killed by (.+)\./i,
    // Combat kill line, e.g. `Jade spider killed Wybie.` → who=Wybie, killer=Jade spider.
    // GameState only records it when `who` is our character.
    /^(?=(?!You\b)(?:.+?) killed (\w+)\.\s*$)(.+?) killed \w+\.\s*$/,
    // Ghost (already dead): a command refused as a ghost.
    /^You are a ghost\b/i,
    /^You die\.?/i,
    /^You have died(?! a total of| only )/i, // not the `character` sheet lines "You have died a total of N times." / "You have died only One time."
  ],
  loginNoise: [
    /^That character is already playing!/i,
    /^Channels? : /i,
    /^ANNOUNCE : /i,
    /^Reconnecting\b/i,
    /^\[\s*\w[\w ]*\]\s*\w+\s*:/,
  ],
  transits: POWERMUD_TRANSITS,
  score: POWERMUD_SCORE,
};
