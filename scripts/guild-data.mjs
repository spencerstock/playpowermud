/** @typedef {{ slug: string; name: string; help: string; races: string; stats: string; where: string; description: string; experienced?: boolean; closed?: boolean }} Guild */

/** @type {{ title: string; guilds: Guild[] }[]} */
export const GUILD_SECTIONS = [
  {
    title: "Fighters",
    guilds: [
      {
        slug: "threshold-militia",
        name: "Threshold Militia",
        help: "militia",
        races: "Human, Half-Elf, Half-Orc, Half-Ogre",
        stats: "Str 14, Con 13",
        where: "Threshold",
        description:
          "Town defenders with charging, dual wield and offhand. Members pay less for most Threshold services.",
      },
      {
        slug: "knights-of-nereka",
        name: "Knights of Nereka",
        help: "knights",
        races: "Human",
        stats: "Str 16, Con 15",
        where: "Castle Brightsword, Plains of Nereka",
        description:
          "Mounted knights with riding, lancing, shield bash, triple attack and advanced defense. Three orders (Circle, Blade, Kingfisher); the top order gets clerical spells from Kertaine. The knighthood distrusts non-clerical magic.",
      },
      {
        slug: "elinost-elite",
        name: "Elinost Elite",
        help: "elite",
        races: "Elf",
        stats: "Str 15, Dex 15",
        where: "Elinost (the Merevia branch doesn't take joiners)",
        description:
          "Guards of the Speaker of the Moon. Advanced melee, dual and offhand, plus hide and sneak.",
      },
      {
        slug: "stronghold-honor-guard",
        name: "Stronghold Honor Guard",
        help: "honor",
        races: "Dwarf",
        stats: "Str 15, Con 14",
        where: "Kal-Thax Stronghold, or Kelton on Merevia",
        description: "Dwarven defenders with dual, triple, offhand and advanced melee.",
      },
      {
        slug: "dunkrist-homeguard",
        name: "Dunkrist Homeguard",
        help: "homeguard",
        races: "Duergar",
        stats: "Str 15, Con 13",
        where: "Dunkrist",
        description:
          "Ambush fighters: backstab, dual, unarmed dual and triple, and epic slash, blunt and unarmed.",
      },
      {
        slug: "melee-magthere",
        name: "Melee-Magthere",
        help: "melee",
        races: "Drow (males)",
        stats: "Dex 15, Str 14",
        where: "Nal Shaddar",
        description:
          "Drow warrior school: dual, advanced melee and unarmed, hide, sneak and backstab.",
      },
      {
        slug: "northmen",
        name: "Northmen",
        help: "northmen",
        races: "Human (males)",
        stats: "Str 17, Con 15, Dex 14",
        where: "Northwest of Cerene",
        description:
          "Barbarians of Bhalt with natural defense, unarmed up to quadruple and epic slash.",
        experienced: true,
      },
      {
        slug: "mariner",
        name: "Mariner",
        help: "mariner",
        races: "Minotaur",
        stats: "Str 16, Dex 15",
        where: "Minot",
        description:
          "Sailors and brawlers: sailing, fishing, unarmed up to quadruple, epic pierce. Bonus to sailing and resistance to water damage.",
        experienced: true,
      },
      {
        slug: "monks-of-aber",
        name: "Monks of Aber",
        help: "monks",
        races: "Human",
        stats: "Str 15, Wis 15, Dex 15, Con 11",
        where: "Absinthe Mountains, between Threshold and Kal-Thax",
        description:
          "Unarmed masters (up to quadruple), evasion, hide, sneak and natural defense. Very limited armour. Strongest when neutral; they regenerate without food or drink.",
      },
      {
        slug: "highlander-clan",
        name: "Highlander Clan",
        help: "highlander",
        races: "Human",
        stats: "Str 15, Con 15, Wis 12, Int 12",
        where: "Highlands, Plains of Nereka",
        description: "Immortal swordsmen. Help says the clan is closed to new members.",
        closed: true,
      },
    ],
  },
  {
    title: "Stealth",
    guilds: [
      {
        slug: "thieves-guild",
        name: "Thieves' Guild",
        help: "thief",
        races: "All 12 races",
        stats: "Dex 15",
        where: "Threshold; branches in Deepwater, Jaarmin Keep, Kalinport",
        description: "Pickpockets and backstabbers: larceny, extortion, spying, dirty fighting, backstab, hide, sneak.",
      },
      {
        slug: "assassins-guild",
        name: "Assassin's Guild",
        help: "assassin",
        races:
          "Human, Half-Elf, Half-Orc, Half-Ogre, Halfling, Drow, Duergar, Gnome, Minotaur, Svirfneblin",
        stats: "Dex 17, Str 15",
        where: "Kalinport (under the Dune Ave manhole); branch in Dunkrist",
        description:
          "The School of Stealth: hide, sneak, assassination, dodging, offhand. Dinien recruits and trains in Kalinport. Hide costs 750 and assassinate 2,000 drakaan to learn.",
        experienced: true,
      },
    ],
  },
  {
    title: "Hybrids",
    guilds: [
      {
        slug: "celtian-battlemages",
        name: "Celtian Battlemages",
        help: "battlemage",
        races: "Human, Half-Elf, Half-Orc, Minotaur",
        stats: "Int 15, Con 13, Str 11, Dex 11, Wis 10",
        where: "Gloriath Castle, north of Dunagin",
        description:
          "Fighter-wizards with slash, blunt, pierce and ranged plus Alteration, Conjuration, Divination and Evocation. Join by bringing the quill pen from the Receiving Clerk at the Dunagin docks. Spells include Burning Hands (10 SP), Shocking Grasp (15), Fireball (45) and Blade Circle (60).",
      },
      {
        slug: "rangers",
        name: "Rangers",
        help: "ranger",
        races: "Human, Half-Elf, Elf, Halfling",
        stats: "Dex 15, Wis 14, Con 13, Str 13",
        where: "Great Forest (west of Threshold, east of Elinost), southern Merevia",
        description:
          "Followers of Felli: ranged and two-weapon fighting without penalty, plus skinning, fishing, cooking, fire starting, riding and woodworking. No guild house; recruiters are Rexiate (woods west of Threshold), Lorn (forests east of Elinost) and Greeu (southern shore of Merevia).",
        experienced: true,
      },
    ],
  },
  {
    title: "Mages",
    guilds: [
      {
        slug: "bastion",
        name: "Bastion of High Sorcery",
        help: "bastion",
        races: "Human, Elf, Half-Elf",
        stats: "Int 15, Wis 13",
        where:
          "A moving tower; look for an Obsidian Mirror in the forests west of Threshold (a second is rumoured south of Elinost)",
        description:
          "General wizards, with seven schools including Enchantment and Illusion, plus scribing. Joining takes a small quest documented on this page.",
        page: "bastion.html",
      },
      {
        slug: "sorcere",
        name: "Sorcere",
        help: "sorcere",
        races: "Drow",
        stats: "Int 15, Wis 14, Dex 13",
        where: "Nal Shaddar",
        description: "Drow mage school with seven schools of magic.",
      },
      {
        slug: "illusionists",
        name: "Illusionists",
        help: "illusionist",
        races: "Gnome, Svirfneblin",
        stats: "Dex 15, Int 14",
        where: "Gnomish Citadel, Granei",
        description:
          "Tricksters: Illusion, Conjuration, Divination, Alteration and Enchantment, with dodging.",
      },
    ],
  },
  {
    title: "Clerics",
    guilds: [
      {
        slug: "church-of-kertaine",
        name: "Church of Kertaine",
        help: "kertaine",
        races: "Human, Half-Elf, Half-Orc, Halfling, Dwarf",
        stats: "Wis 14, Int 11",
        where: "Main church in Deepwater; also Threshold (Kalinport's doesn't take joiners)",
        description: "Clerics of Kertaine: faith, blunt, ranged; Necromancy, Abjuration, Conjuration, Divination.",
      },
      {
        slug: "cult-of-bejuak",
        name: "Cult of Be'juak",
        help: "bejuak",
        races: "Human, Half-Elf, Half-Orc, Half-Ogre",
        stats: "Wis 14, Dex 13, Int 12",
        where: "Kalinport Ruins, Threshold Catacombs",
        description: "Evil clerics whose patron grants spells of disease and destruction.",
      },
      {
        slug: "priests-of-eli",
        name: "Priests of Eli",
        help: "eli",
        races: "Elf",
        stats: "Wis 15, Dex 15, Int 13",
        where: "The Life Tree, south of Elinost",
        description: "Nature priests who fight evil in the forests; faith plus hide, slash and pierce.",
      },
      {
        slug: "arach-tillith",
        name: "Arach-Tillith",
        help: "arach",
        races: "Drow (females)",
        stats: "Wis 16, Int 13",
        where: "Nal Shaddar",
        description: "Priestesses of Loth, with dual wield and faith.",
      },
      {
        slug: "dark-trinity",
        name: "Dark Trinity",
        help: "trinity",
        races: "Duergar",
        stats: "Wis 14, Str 14",
        where: "Dunkrist",
        description: "Priests of Remoah with healing and cursing spells.",
      },
      {
        slug: "disciples-of-xenei",
        name: "Disciples of Xenei",
        help: "xenei",
        races: "Human, Half-Elf, Half-Orc, Half-Ogre",
        stats: "Wis 10, Int 10",
        where: "Jaarmin Keep",
        description: "A political order that governs Jaarmin Keep. Low stat bar.",
        experienced: true,
      },
    ],
  },
  {
    title: "Trade",
    guilds: [
      {
        slug: "merchants-guild",
        name: "Merchant's Guild",
        help: "merchant",
        races: "All",
        stats: "Cha 11, Int 10",
        where: "Kalinport, Deepwater, Kal-Thax, Nal Shaddar, Dunkrist, Granei",
        description:
          "Haggling, appraising, brewing potions, alchemy and concoctions; sells at much better rates. The only guild you can join before 500 exp.",
        experienced: true,
      },
    ],
  },
];

/** @type {{ race: string; guilds: string }[]} */
export const RACE_GUILD_ROWS = [
  {
    race: "Human",
    guilds:
      "Militia, Thief, Knights of Nereka, Church of Kertaine, Bastion, Merchant, Assassin, Cult of Be'juak, Northmen, Monks of Aber, Rangers, Disciples of Xenei, Battlemages",
  },
  {
    race: "Half-Elf",
    guilds: "Militia, Thief, Bastion, Assassin, Church of Kertaine, Cult of Be'juak, Merchant, Rangers, Disciples of Xenei, Battlemages",
  },
  {
    race: "Half-Orc",
    guilds: "Militia, Thief, Church of Kertaine, Cult of Be'juak, Assassin, Merchant, Disciples of Xenei, Battlemages",
  },
  {
    race: "Half-Ogre",
    guilds: "Militia, Thief, Cult of Be'juak, Assassin, Merchant, Disciples of Xenei",
  },
  {
    race: "Elf",
    guilds: "Priests of Eli, Merchant, Thief, Elinost Elite, Bastion, Rangers",
  },
  {
    race: "Drow",
    guilds: "Sorcere, Merchant, Melee-Magthere (males), Arach-Tillith (females), Thief, Assassin",
  },
  {
    race: "Duergar",
    guilds: "Dunkrist Homeguard, Merchant, Assassin, Dark Trinity, Thief",
  },
  { race: "Dwarf", guilds: "Stronghold Honor Guard, Merchant, Thief, Church of Kertaine" },
  { race: "Gnome", guilds: "Illusionist, Merchant, Thief, Assassin" },
  { race: "Svirfneblin", guilds: "Merchant, Illusionist, Thief, Assassin" },
  { race: "Halfling", guilds: "Thief, Merchant, Assassin, Church of Kertaine, Rangers" },
  { race: "Minotaur", guilds: "Merchant, Thief, Assassin, Mariner, Battlemages" },
];

/** @param {Guild & { page?: string }} guild */
export function guildPageHref(guild) {
  const slug = guild.page?.replace(/\.html$/i, "") ?? guild.slug;
  return `/wiki/guilds/${slug}`;
}
