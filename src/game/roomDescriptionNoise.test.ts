import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream } from "./stream.js";
import {
  cleanseRoomDescription,
  isLeadingDescriptionFragment,
  isRoomDescriptionNoiseLine,
  stripLeadingGameNoise,
} from "./roomDescriptionNoise.js";
import type { GameEvent, RoomObservation } from "./types.js";

function rooms(events: GameEvent[]): RoomObservation[] {
  return events.flatMap((e) => (e.type === "room" ? [e.room] : []));
}

test("noise line patterns", () => {
  assert.ok(isRoomDescriptionNoiseLine("Autosave."));
  assert.ok(isRoomDescriptionNoiseLine("You sneak stealthily from the area."));
  assert.ok(isRoomDescriptionNoiseLine("Rothe arrives from the east."));
  assert.ok(isRoomDescriptionNoiseLine("Goblin slave leaves north."));
  assert.ok(isRoomDescriptionNoiseLine("Channels : Setting channel 'race' to on."));
  assert.ok(!isRoomDescriptionNoiseLine("You are in a small tavern in Nal Shaddar."));
});

test("cleanseRoomDescription drops prefixes and replay fragments", () => {
  const noisy =
    "Autosave.\nRothe leaves north.\nYou sneak stealthily from the area.\nYou are in one of the grazing fields on Rothe Island.";
  assert.equal(cleanseRoomDescription(noisy), "You are in one of the grazing fields on Rothe Island.");

  const fragment = "a, as there are\nseveral shops and things here.  You see several vendors.";
  assert.equal(cleanseRoomDescription(fragment), "several shops and things here.  You see several vendors.");

  assert.ok(isLeadingDescriptionFragment("a, as there are"));
  assert.ok(!isLeadingDescriptionFragment("You are in the market."));
});

test("combat round lines are noise", () => {
  assert.ok(isRoomDescriptionNoiseLine("Myconid punches you with zeal, but doing no damage."));
  assert.ok(isRoomDescriptionNoiseLine("You slash Myconid solidly, causing some damage."));
  assert.ok(isRoomDescriptionNoiseLine("The Myconid stoops down and sniffs a mushroom."));
  assert.ok(isRoomDescriptionNoiseLine("Your broadsword takes some damage."));
  assert.ok(isRoomDescriptionNoiseLine("Sentry's protection from evil deflects very little of the damage."));
  assert.ok(isRoomDescriptionNoiseLine("A large ball of energy slams into you, sent from Sentry!"));

  const grove =
    "Myconid punches you with zeal, but doing no damage.\nYou slash Myconid solidly, causing some damage.\nThe mushroom grove is continuing here along the western side of the cavern.";
  assert.equal(cleanseRoomDescription(grove), "The mushroom grove is continuing here along the western side of the cavern.");
});

test("stream never stores autosave or mob lines in verbose descriptions", () => {
  const s = new GameStream();
  const full = "This is the market center of Nal Shaddar.  A few shops have been erected here.";
  const ev = s.feed(`Autosave.\nRothe arrives from the east.\nYou sneak stealthily from the area.\n${full}\nThe only obvious exits are : north.\n[HP:10 SP:10]`);
  const room = rooms([...ev, ...s.settle()])[0]!;
  assert.equal(room.description, full);
});

test("hunger ticks, mob flavor and NPC speech are stripped from stored descriptions", () => {
  const R1 = "This part of Nal Shaddar has been set aside for the merchant trade.  Various\nbooths and vendors are around, hawking their wares.";
  for (const lead of [
    "The spider slams into you!",
    "Your stomach rumbles.",
    "Bartender asks in drow : What can I get you?",
    "Loreman exclaims in drow : The evil surface faeries are our enemies!",
    "The fire golem breathes fire at you!",
    "The cave fisher is having a hard time reeling you in!",
    "Jade spider attempts to sneak northeast, but you notice.",
    "The rothe looks at you with it's huge saucer-shaped eyes.",
  ]) {
    assert.ok(isRoomDescriptionNoiseLine(lead), lead);
    assert.equal(cleanseRoomDescription(`${lead}\n${R1}`), R1);
  }
  // Blank lines between leaked noise lines don't stop the scrub.
  assert.equal(cleanseRoomDescription(`The fire golem breathes fire at you!\n\nGolem punches you with zeal, but doing no damage.\n${R1}`), R1);
  // Real prose lines that mention "you" stay.
  assert.ok(!isRoomDescriptionNoiseLine("The paved road you are travelling on is totally devoid of any surface marks"));
  assert.ok(!isRoomDescriptionNoiseLine("To the north of you is a large and well-lit pub, teeming with drunken guests."));
});

test("ambient NPC emotes and decay/regen ticks never lead a stored description", () => {
  const grove =
    "You are standing in a small mushroom grove.  The mushrooms here are small ones,\nonly standing about eight feet in height on average.";
  for (const lead of [
    "The Myconid stares at you with semi-intelligent eyes.",
    "The Myconid grabs a chunk off of a nearby mushroom and starts eating it.",
    "The Myconid stoops down and sniffs a mushroom.",
    "The Bartender wipes up a spill.",
    "The Drow flits in and out of the shadows.",
    "The Fisherman lets out his line, biding his time.",
    "The Loreman gestures broadly in the air.",
    "The High Priestess directs the students in a chant.",
    "The slave looks for any rothe dung irregularities.",
    "The rothe stamps it's hoof and paws the ground.",
    "The cave faerny flies around lightfully in the air.",
    "A bat walks up and down the walls and ceiling.",
    "Faerny casts a spell on himself.",
    "Jade spider emerges from hiding as combat begins.",
    "You emerge from hiding as combat begins.",
    "The corpse of Sentry is starting to smell.",
    "The skeletal remains of Rothe stop smelling so bad.",
    "The skeletal remains of Human slave crumble into dust.",
    "The Mushroom stops smelling so bad.",
    "Your strength returns.",
    "You slowly regain some Skill Points, resting nicely....",
    "You gain some more Skill Points back.",
    "You sober up a little bit!",
    "You are completely sober now.",
  ]) {
    assert.ok(isRoomDescriptionNoiseLine(lead), lead);
    assert.equal(cleanseRoomDescription(`${lead}\n${grove}`), grove, lead);
  }
  // Repeated emotes (r449) are all dropped.
  const twice = "The Myconid stares at you with semi-intelligent eyes.\nThe Myconid stares at you with semi-intelligent eyes.\n";
  assert.equal(cleanseRoomDescription(`${twice}${grove}`), grove);
  // Real prose that opens like an emote stays.
  for (const prose of [
    "The Route continues north and west, heading towards the base of some large",
    "The Pit looks like it dead-ends to the south.  Perhaps it does, but you",
    "The end of this tunnel is just north of here, just within your sight.",
    "The mushroom grove is continuing here along the western side of the cavern.",
    "The pass is so full of snow, it is hard to see where ground actually is.",
  ]) {
    assert.ok(!isRoomDescriptionNoiseLine(prose), prose);
  }
});

test("stream drops a myconid emote that arrives right before a verbose room view", () => {
  const s = new GameStream();
  const full =
    "This area of the grove looks like it has been tampered with.  Something must make this mushroom grove their home.";
  const ev = s.feed(
    `Myconid punches you with zeal, but doing no damage.\nThe Myconid grabs a chunk off of a nearby mushroom and starts eating it.\n${full}\nThe only obvious exits are : north, northwest and southwest.\n[HP:10 SP:10]`,
  );
  const room = rooms([...ev, ...s.settle()])[0]!;
  assert.equal(room.description, full);
});

test("trailing sky lines (moon phase, Darkening) are not part of a room's prose", () => {
  const prose =
    "This is the middle- and upper-class section of Kalinport.  Most of the many\nbuildings and homes have been well-constructed using the finest of materials.";
  assert.equal(cleanseRoomDescription(`${prose}\n\nThe moon is at Arrival.`), prose);
  assert.equal(cleanseRoomDescription(`${prose}\nThe Darkening closes in as night falls.`), prose);
  assert.equal(cleanseRoomDescription("The moon is at Arrival."), undefined);
  assert.equal(isRoomDescriptionNoiseLine("The moon rises over the dunes to the east of town."), false);
});

test("Kalinport ambient lines (Dinien's curses, the merchant's shouting) are noise", () => {
  const desc = [
    "Dinien growls out a few curse words.",
    "Dinien growls out a few curse words.",
    "This is the recruiter's office for the Guild.  This young but skilled member",
    "and cunning.  A desk is in the middle of the room, with a couple of chairs",
    "set in front of it.",
  ].join("\n");
  assert.ok(cleanseRoomDescription(desc)!.startsWith("This is the recruiter's office"));
  assert.ok(isRoomDescriptionNoiseLine("The merchant is shouting at the top of his lungs, trying to sell his products."));
});

test("status prompt and Powermud chatter/combat/movement first lines are noise", () => {
  const prompt = "[HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 20617(29297)]";
  assert.ok(isRoomDescriptionNoiseLine(prompt));
  assert.ok(isRoomDescriptionNoiseLine("Sassman shouts : noice.  I did add it back to mud connector"));
  assert.ok(isRoomDescriptionNoiseLine("Fiz tells you : only one is, right?"));
  assert.ok(isRoomDescriptionNoiseLine("The guard slams the hilt of his scimitar into your face!"));
  assert.ok(isRoomDescriptionNoiseLine("Lorax - I speak for the trees is standing here."));
  assert.ok(isRoomDescriptionNoiseLine("Pete takes all your money, counts it, and hands you a new set of coins."));
  assert.ok(isRoomDescriptionNoiseLine("You sneak into the area, apparently not observed by anyone."));
  assert.ok(!isRoomDescriptionNoiseLine("You are in a small tavern in Nal Shaddar."));
  assert.ok(!isRoomDescriptionNoiseLine("You are standing inside of a walled arena.  The ground is comprised of sand."));
  assert.equal(stripLeadingGameNoise(`${prompt}You are in a small tavern.`), "You are in a small tavern.");
  assert.equal(stripLeadingGameNoise("\x1b[0m[0mYou sneak stealthily from the area."), "You sneak stealthily from the area.");
});

test("cleanseRoomDescription strips leading prompt, chat, travel messages but keeps the prose", () => {
  const prompt = "[HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 20617(29297)]";
  const prose = [
    "You are still in the mushroom field, but a large gate is to the west, probably",
    "leading to a Drow House.  The gate leads directly in the rock.",
  ].join("\n");
  assert.equal(cleanseRoomDescription(`${prompt}\n${prose}`), prose);
  assert.equal(cleanseRoomDescription(`${prompt}${prose}`), prose);
  assert.equal(cleanseRoomDescription(`You sneak into the area, apparently not observed by anyone.\n${prompt}\n${prose}`), prose);
  assert.equal(cleanseRoomDescription(`[0mYou sneak stealthily from the area.\n${prose}`), prose);
  assert.equal(cleanseRoomDescription(`Sassman shouts : noice.  I did add it back to mud connector\n${prose}`), prose);

  const guild = [
    "You are standing in the infamous and deadly Assassin's Guild.  Only members",
    "of the Guild are allowed in here, all others are instantly killed.",
  ].join("\n");
  const handle = "You grab the handle and tug it a bit.  A section of the wall moves to the side,\nand you slip right through.";
  assert.equal(cleanseRoomDescription(`${handle}\n${guild}`), guild);

  const cavern = "This dark cavern is unstable at best.  Looking around, you see that there is a\nlot of dust swirling around.";
  const crawl = "You crawl through the opening, ending up in a tiny tunnel.  You go ahead for\nabout thirty yards and emerge in a small cavern.";
  assert.equal(cleanseRoomDescription(`${crawl}\n${cavern}`), cavern);

  // Real prose that merely starts with "You" is untouched.
  const tavern = "You are in a small tavern in Nal Shaddar.  A fire crackles in the hearth.";
  assert.equal(cleanseRoomDescription(tavern), tavern);
});

test("an all-junk description cleanses to undefined", () => {
  const prompt = "[HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 20617(29297)]";
  assert.equal(cleanseRoomDescription(`${prompt}\nFiz tells you : only one is, right?`), undefined);
});

test("a status prompt inside a stored description ends everything before it", () => {
  const AVE =
    "This is the middle- and upper-class section of Kalinport.  Most of the many\nbuildings and homes have been well-constructed using the finest of materials.\nYou are travelling along Oasis Avenue, one of the more well-used roads in the\nnorthwest section of Kalinport.";
  // A cut-off desert display, the blinding message and the prompt glued onto the next room (r2076).
  const glued =
    "You are standing somewhere in the Kalamshite Desert.  Huge sand dunes are\nall around you, blocking your view somewhat.  Looking around, you do not\nsee a speck of vegetation, only the rolling\n\nYour eyes sting from the bright light, and you are blinded for a moment!\n[HP: 598(620(96%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 20000(29914)]\n" +
    AVE;
  assert.equal(cleanseRoomDescription(glued), AVE);
  const spam = "Enter what?\n[HP: 598(620(96%)) SP: 50(50(100%))]\nEnter what?\n[HP: 598(620(96%)) SP: 50(50(100%))]\n" + AVE;
  assert.equal(cleanseRoomDescription(spam), AVE);
  assert.equal(cleanseRoomDescription(`Your eyes sting from the blinding light, leaving you not able to see for a brief moment.\n${AVE}`), AVE);
});

test("wrapped NPC speech tails never lead a description; indented maps stay", () => {
  const VEDNY =
    "This is the middle- and upper-class section of Kalinport.  Most of the many\nbuildings and homes have been well-constructed using the finest of materials.\nYou are at an intersection between Vedny Road and Oasis Avenue.";
  assert.equal(cleanseRoomDescription(`here!\n     here!\n     here!\n${VEDNY}`.replace(/^here!/, "     here!")), VEDNY);
  const map = "A map is painted on the wall here:\n     #-#-#\n     |    \\\n     #     #";
  assert.equal(cleanseRoomDescription(map), map);

  const s = new GameStream();
  const ev = s.feed(
    `[HP:97 SP:50]Kalinport citizen exclaims in common : Out of my way, I am trying to walk \n     here!  \n${VEDNY}\nThe only obvious exits are : north, south, west.\n[HP:97 SP:50]`,
  );
  assert.equal(rooms([...ev, ...s.settle()])[0]!.description, VEDNY);
});
