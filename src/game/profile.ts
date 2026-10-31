/**
 * MUD-specific text patterns. Everything game-dependent that the stream parsers,
 * mapper and login automaton need lives here so another MUD only needs a new profile.
 */

export type GameProfile = {
  id: string;
  /** Prompt at start of a line, e.g. `[HP:90 SP:50]` — may be followed by more text on the same line. */
  promptPrefix: RegExp;
  /** Bare account-menu / pre-prompt-setup prompt, e.g. `> `. */
  barePromptPrefix: RegExp;
  /** Combat round status line with current(max) vitals — not a command-completion prompt. */
  combatStatus: RegExp;
  /** Brief-mode room line: `Title (n, s, out).` */
  briefRoom: RegExp;
  /** Verbose exits line; group 1 = exit list text. */
  verboseExits: RegExp[];
  /** Verbose room with no exits. */
  noExits: RegExp;
  /** Room contents line after a room display. */
  contentsLine: RegExp;
  /** Movement attempt that did not move the character. */
  moveFailed: RegExp[];
  /** Moved but could not see the room (`It is too dark`, or dizzy from looking around). */
  darkRoom: RegExp;
  /** `You flee like the wind, east!` — group 1 = direction actually taken. */
  fleeMoved: RegExp;
  fleeFailed: RegExp[];
  /** Commands that relocate without an exit (no map edge is recorded). */
  teleportCommands: RegExp;
  /** Commands that never move the character or redisplay the room. */
  nonMovementCommands: RegExp;
  /** Commands that redisplay the current room. */
  lookCommands: RegExp;
  login: {
    userPrompt: RegExp;
    passwordPrompt: RegExp;
    accountMenu: RegExp;
    throwOut: RegExp;
    newUserWarning: RegExp;
    badPassword: RegExp;
    /** Character name not linked to this user or unknown. */
    badCharacter: RegExp;
  };
  inGameMarkers: RegExp[];
  deathMarkers: RegExp[];
  /** System lines that precede an arrival display but are never part of a room description. */
  loginNoise: RegExp[];
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
  barePromptPrefix: /^> /,
  combatStatus: /^\[\s*HP\s*:\s*(\d+)\((\d+)\)\s*SP\s*:\s*(\d+)\((\d+)\)(?:\s*PP\s*:\s*(\d+)\((\d+)\))?(?:\s*Attacker\s*:\s*(.+?))?\s*\]\s*$/,
  briefRoom: /^([A-Z0-9"'][^()\[\]]{0,120}?) \(((?:[a-z]{1,12})(?:,\s?[a-z]{1,12})*|none|)\)\.?\s*$/,
  verboseExits: [
    /^The only obvious exits? (?:is|are)\s*:\s*(.+?)\s*$/i,
    /^Obvious exits? (?:is|are)\s*:\s*(.+?)\s*$/i,
  ],
  noExits: /^There are no obvious exits\.?\s*$/i,
  contentsLine: /^There (?:is|are) (.+)$/,
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
  darkRoom: /^(?:It is too dark\.?|You may get dizzy if you look around like that!?)\s*$/i,
  fleeMoved: /^You flee like the wind, (\w+)!/i,
  fleeFailed: [/^You fail to flee/i, /^You attempt to flee,? but (?:go nowhere|fail)/i],
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
};

export function defaultGameProfile(): GameProfile {
  return POWERMUD_PROFILE;
}
