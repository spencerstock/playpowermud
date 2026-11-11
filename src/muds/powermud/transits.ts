import type { TransitRule } from "../../game/profile.js";

/**
 * PowerMUD rides and forced relocations (see `TransitRule`). Lines are from live play:
 * Zurker/Wybie Deepwater ⇄ Dunagin (2026-10-30) and Wybie Deepwater → Merevia (2026-11-03).
 */
export const POWERMUD_TRANSITS: TransitRule[] = [
  {
    // Kendrite Passages shipping company: buy a pass at a branch office (`routes`, `purchase N`),
    // walk to the matching berth, `board ship`, `ready`. The deck has no exits line; a few minutes
    // later the ship docks at the destination's berth. Ports seen: Deepwater, Dunagin (Celtia),
    // Kalinport, Merevia (island).
    id: "kendrite-ship",
    label: "Kendrite Passages ship",
    ticket: [/^You purchase a boarding pass on a ship bound for ([A-Z][\w' -]*?)\.?\s*$/],
    command: "board ship",
    board: [/^You give your pass to the Dock Worker and walk up the gangplank\.?\s*$/i],
    depart: [/^The ship clears the dock and raises the sails\.?\s*$/i],
    arrive: [/^You disembark from the ship\.?\s*$/i],
    ambient: [
      // Leaving port.
      /^You tell the Captain that you are ready to depart\.?\s*$/i,
      /^The Captain calls out orders to his crew\.?\s*$/i,
      /^The ship clears the dock area and picks up speed\.?\s*$/i,
      // At sea.
      /^The ship shakes a bit when a particularly large wave hits the side\.?\s*$/i,
      /^The waves lap roughly up against the sides of the ship\.?\s*$/i,
      /^You think you can see land off in the distance\.?\s*$/i,
      /^A lone seagull flies overhead\.?\s*$/i,
      /^The rolling of the waves is disconcerting\.?\s*$/i,
      /^The Captain (?:yells out an order to one of his crewmen|adjusts the steering wheel a bit)\.?\s*$/i,
      /^A crew member is climbing on one of the riggings\.?\s*$/i,
      // Docking (normal, and with the Captain dead).
      /^You are nearing your destination\.?\s*$/i,
      /^The Captain calls for his crew to initiate the docking procedure\.?\s*$/i,
      /^The ship pulls up to the docks smoothly\.?\s*$/i,
      /^The ship docks and you make your way down the gangplank\.?\s*$/i,
      /^You are careening towards the docks at an alarmingly high speed!.*$/i,
      /^going to ram into the docks!?\s*$/i,
      /^You slam into the docks with an incredible force!?\s*$/i,
      /^You fall to the deck in pain!?\s*$/i,
      /^You steady yourself and prepare to disembark\.?\s*$/i,
      // Berth chatter after the ship leaves / while a ship waits.
      /^The Ship raises anchor and prepares to set sail\.?\s*$/i,
      /^You see some activity on the ship\.\s+It looks like it is preparing to depart\.?\s*$/i,
      /^The ship clears the dock and raises its sails\.?\s*$/i,
      /^The ship is now clear of the dock area and is getting underway\.?\s*$/i,
      /^The (?:W|w)orker complains (?:about the pathetic pay|noisily about unruly passengers)\.?\s*$/,
    ],
    vessel: { description: "You are standing on the deck of a large seafaring vessel." },
    howTo: "buy a pass at the company office (`routes`, `purchase N`), then at this berth `board ship`, `ready`",
  },
  {
    // Newbie arena (Elinost): the first move after passing 500 exp lands on Spruce Avenue instead.
    id: "arena-boot",
    label: "Arena boot",
    arrive: [/^Since you are above 500 experience points, you are transported out of the arena!?\s*$/i],
    link: false,
  },
  {
    // Serpico (cannibal shaman) banish: fight ends with this line, then Abyss room prose. Never a walk
    // from the statue room (Wybie 2026-11-05 ~12:49 AM MST — mapper briefly linked e → Abyss).
    id: "serpico-banish-abyss",
    label: "Banished to the Abyss",
    arrive: [/^You have been banished to the Abyss!?\s*$/i],
    link: false,
  },
];
