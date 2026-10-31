import assert from "node:assert/strict";
import { test } from "node:test";
import { GameStream, parseContentsText, splitEchoCommands } from "./stream.js";
import type { GameEvent, RoomObservation } from "./types.js";

function rooms(events: GameEvent[]): RoomObservation[] {
  return events.flatMap((e) => (e.type === "room" ? [e.room] : []));
}

test("brief rooms after inline prompts, with contents and LPC paths", () => {
  const s = new GameStream();
  const ev = [
    ...s.feed("Gateway Road (n, s, e).\nThere is one Town guard (d/std/mon/tguard#1836).\n"),
    ...s.feed("[HP:10 SP:302 PP:965]Gateway Road (n, s, e, sw).\n[HP:10 SP:302 PP:965]"),
  ];
  const r = rooms(ev);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], {
    mode: "brief",
    title: "Gateway Road",
    exits: ["n", "s", "e"],
    contents: [{ name: "Town guard", count: 1, path: "d/std/mon/tguard#1836", kind: "mob" }],
  });
  assert.deepEqual(r[1]!.exits, ["n", "s", "e", "sw"]);
  const prompts = ev.filter((e) => e.type === "prompt");
  assert.equal(prompts.length, 2, "trailing partial prompt is emitted without a newline");
});

test("verbose room keeps paragraph description and full-word exits", () => {
  const s = new GameStream();
  const ev = s.feed(
    [
      "You are standing inside of a walled arena.  The ground is comprised of sand.",
      "Above the walls lie many spectator stands.",
      "",
      "To leave the Arena, type 'exit'.",
      "",
      "The only obvious exits are : north, east, south, west, down.  ",
      "There is one Small Sign.",
      "There is one PowerMud Pete.",
      "[Adventurer] You : I am here now, greetings!  ",
      "",
    ].join("\n"),
  );
  const [room] = rooms(ev);
  assert.equal(room!.mode, "verbose");
  assert.deepEqual(room!.exits, ["n", "e", "s", "w", "d"]);
  assert.match(room!.description!, /^You are standing inside of a walled arena\./);
  assert.match(room!.description!, /\n\nTo leave the Arena, type 'exit'\.$/);
  assert.deepEqual(
    room!.contents.map((c) => c.name),
    ["Small Sign", "PowerMud Pete"],
  );
});

test("blank line between exits and contents still belongs to that room", () => {
  const s = new GameStream();
  const ev = s.feed(
    [
      "This area of Nal Shaddar is commonly known as the Market Area.",
      "The only obvious exits are : south and east.",
      "  ",
      "There is one Drow merchant.",
      "[HP:131 SP:42]",
    ].join("\n"),
  );
  const [room] = rooms(ev);
  assert.equal(room?.mode, "verbose");
  assert.deepEqual(
    room?.contents.map((c) => c.name),
    ["Drow merchant"],
  );
});

test("a wrapped exits line keeps the exits on the next line", () => {
  const s = new GameStream();
  const ev = s.feed(
    [
      "You are standing on the shore of Rothe Island.",
      "The only obvious exits are : west, east, south, southeast, ",
      "                             northeast.",
      "There are a few Rothes.",
      "[HP:162 SP:50]",
    ].join("\n"),
  );
  const [room] = rooms(ev);
  assert.equal(room?.mode, "verbose");
  assert.deepEqual(room?.exits, ["w", "e", "s", "se", "ne"]);
  assert.deepEqual(
    room?.contents.map((c) => c.name),
    ["Rothes"],
  );
});

test("brief room titles may include zone colons", () => {
  const s = new GameStream();
  const ev = [...s.feed("Melee-Magthere : The Lore room (n, s, e, w).\n"), ...s.settle()];
  assert.deepEqual(rooms(ev)[0], {
    mode: "brief",
    title: "Melee-Magthere : The Lore room",
    exits: ["n", "s", "e", "w"],
    contents: [],
  });
});

test("dizzy means the move happened and the room was not seen", () => {
  const s = new GameStream();
  const ev = s.feed("You may get dizzy if you look around like that!\n[HP:162 SP:46]\n");
  const room = ev.find((e) => e.type === "room");
  assert.equal(room?.type === "room" && room.room.mode, "dark");
  assert.equal(ev.some((e) => e.type === "move-failed"), false);
});

test("named exits, dark rooms, failures and flee", () => {
  const s = new GameStream();
  const ev = s.feed(
    [
      "The only obvious exits are : west and out.",
      "[HP:1 SP:1 PP:1]It is too dark.",
      "[HP:1 SP:1 PP:1]> You cannot go that direction.",
      "You flee like the wind, east!",
      "Dragon's lair (w, out).",
      "Small sword (wielded).",
      "",
    ].join("\n"),
  );
  const r = rooms(ev);
  assert.deepEqual(r[0]!.exits, ["w", "out"]);
  assert.equal(r[1]!.mode, "dark");
  assert.deepEqual(r[2], { mode: "brief", title: "Dragon's lair", exits: ["w", "out"], contents: [] });
  assert.equal(r.length, 3, "inventory lines with (wielded) are not rooms");
  assert.ok(ev.some((e) => e.type === "move-failed"));
  assert.ok(ev.some((e) => e.type === "flee" && e.dir === "e"));
});

test("score block parses guild, home and exp", () => {
  const s = new GameStream();
  const ev = s.feed(
    [
      "[HP:90 SP:50]You are Wybie the Adventurer.",
      "You are a male drow known as being Neutral.",
      "You are a member of the Adventurer's Guild.",
      "You call Nal Shaddar your home.",
      "You are 61 years and 0 days old.",
      "You have 90 out of 90 hit points.",
      "You have 50 out of 50 spell/skill points.",
      "STR :  15  DEX :  15  INT :  12  WIS :  12  CON :  17  CHA :  11",
      "You have 464 experience points.",
      "You need 47 more experience points to gain more hit points.",
      "",
      "Please use 'help basic' to get a list of common commands.",
      "",
      "You are carrying 164 coins, worth 2088 drakaan.",
      "You have 0 drakaan in the bank.",
      "[HP:90 SP:50]",
    ].join("\n"),
  );
  const score = ev.find((e) => e.type === "score");
  assert.ok(score && score.type === "score");
  const st = score.status;
  assert.equal(st.name, "Wybie");
  assert.equal(st.race, "drow");
  assert.equal(st.guild, "Adventurer's Guild");
  assert.equal(st.home, "Nal Shaddar");
  assert.equal(st.exp, 464);
  assert.equal(st.expToNext, 47);
  assert.equal(st.hpMax, 90);
  assert.equal(st.coins, 164);
  assert.equal(st.bank, 0);
  assert.equal(st.stats?.CON, 17);
});

test("login prompts are detected from partial lines", () => {
  const s = new GameStream();
  const a = s.feed("Please use the name 'guest'.\n\nWhat is your user name? (Or 'who', 'exit' or '#<character name>') : ");
  assert.ok(a.some((e) => e.type === "login" && e.stage === "user-prompt"));
  const b = s.feed("\r\n\uFFFD\uFFFD\u0001Password : ");
  assert.ok(b.some((e) => e.type === "login" && e.stage === "password-prompt"));
  const c = s.feed("That character is already playing!\nThrow out other copy? (Y/N)");
  assert.ok(c.some((e) => e.type === "login" && e.stage === "throw-out"));
  const d = [...s.feed("Dragon's lair (w, out).\n"), ...s.settle()];
  assert.equal(rooms(d)[0]?.title, "Dragon's lair");
});

test("hpsp prompt with max values updates vitals on the prompt event", () => {
  const s = new GameStream();
  const ev = s.feed("[HP:85(90) SP:40(50)]\n");
  const pr = ev.find((e) => e.type === "prompt");
  assert.ok(pr && pr.type === "prompt" && pr.vitals);
  assert.equal(pr.vitals.hp, 85);
  assert.equal(pr.vitals.hpMax, 90);
  assert.equal(pr.vitals.spMax, 50);
});

test("combat status line yields vitals with max values", () => {
  const s = new GameStream();
  const ev = s.feed("[ HP : 85(90) SP : 50(50) Attacker : extremely poor ]\n");
  const v = ev.find((e) => e.type === "vitals");
  assert.ok(v && v.type === "vitals");
  assert.equal(v.vitals.hpMax, 90);
  assert.equal(v.vitals.attacker, "extremely poor");
});

test("contents parsing handles counts, trailing paths and corpses", () => {
  assert.deepEqual(parseContentsText("a few Lizard men (d/std/swamp/mon/lizard_man#1897)."), {
    name: "Lizard men",
    count: 3,
    path: "d/std/swamp/mon/lizard_man#1897",
    kind: "mob",
  });
  assert.equal(
    parseContentsText("one path leading west through the forest. (u/meson/castle).")?.kind,
    "entrance",
  );
  assert.equal(parseContentsText("a couple corpses of Gladiator.")?.kind, "corpse");
  assert.equal(parseContentsText("currently ONE user logged on."), null);
});

test("a door is an exit you can open, not a mob", () => {
  const s = new GameStream();
  const ev = s.feed(
    [
      "You are standing just southwest from a large gray tower.",
      "There is a stone door leading northeast ( CLOSED ).",
      "The only obvious exits are : north and southwest.",
      "There is one Male Drow.",
      "[HP:10 SP:10]",
    ].join("\n"),
  );
  const [room] = rooms(ev);
  assert.deepEqual(room?.doors, [{ name: "stone door", direction: "ne", state: "closed" }]);
  assert.deepEqual(room?.exits, ["n", "sw", "ne"]);
  assert.deepEqual(
    room?.contents.map((c) => c.name),
    ["Male Drow"],
  );
  assert.equal(parseContentsText("a stone door leading northeast ( OPENED )."), null);
});

test("a locked door is recorded and is not an exit", () => {
  const s = new GameStream();
  const ev = s.feed(
    [
      "A wooden gatehouse.",
      "There is a wood door leading north ( LOCKED ).",
      "The only obvious exits are : east.",
      "[HP:10 SP:10]",
    ].join("\n"),
  );
  const [room] = rooms(ev);
  assert.deepEqual(room?.doors, [{ name: "wood door", direction: "n", state: "locked" }]);
  assert.deepEqual(room?.exits, ["e"]);
});

test("echo lines split alias expansions", () => {
  assert.deepEqual(splitEchoCommands("alias mstoblack => s ; s ; sw ; pry floorboard"), [
    "s",
    "s",
    "sw",
    "pry floorboard",
  ]);
  assert.deepEqual(splitEchoCommands("look"), ["look"]);
});

test("login and system lines never leak into the next room description", () => {
  const s = new GameStream();
  const ev = [
    ...s.feed("> That character is already playing!\nThrow out other copy? (Y/N)"),
    ...s.feed(
      "Channels : Setting channel 'race' to on.\nYou are standing inside of a walled arena.\nThe only obvious exits are : north, down.\n",
    ),
    ...s.settle(),
  ];
  const room = rooms(ev)[0]!;
  assert.equal(room.description, "You are standing inside of a walled arena.");
});

test("death markers: `X killed <us>.` names victim and killer; ghost line; our own kills ignored", () => {
  const deaths = (text: string) =>
    new GameStream().feed(text).flatMap((e) => (e.type === "death" ? [{ who: e.who, killer: e.killer }] : []));
  assert.deepEqual(deaths("The spider slams into you!\nJade spider killed Wybie.\n"), [
    { who: "Wybie", killer: "Jade spider" },
  ]);
  assert.deepEqual(deaths("You killed Rothe.\n"), []);
  assert.deepEqual(deaths("[HP:10 SP:20]You are a ghost, forget it!\n"), [{ who: undefined, killer: undefined }]);
});

test("score block: guild line without `the` (e.g. Melee-Magthere) still parses exp", () => {
  const ev = new GameStream().feed(
    [
      "You are Wybie gettin' smacked.",
      "You are a male drow known as being Demonic.",
      "You are a member of Melee-Magthere.",
      "You call Nal Shaddar your home.",
      "You are 61 years and 42 days old.",
      "You have 463 out of 463 hit points.",
      "You have 6 out of 50 spell/skill points.",
      "STR :  17  DEX :  19  INT :  13  WIS :  10  CON :  17  CHA :   9",
      "You have 11290 experience points.",
      "You need 711 more experience points to gain more hit points.",
      "You are carrying 380 coins, worth 2371 drakaan.",
      "You have 27588 drakaan in the bank.",
      "Cmds: skills, languages, commands.",
      "[HP:463 SP:6]",
    ].join("\n"),
  );
  const score = ev.find((e) => e.type === "score");
  assert.ok(score && score.type === "score");
  assert.equal(score.status.guild, "Melee-Magthere");
  assert.equal(score.status.home, "Nal Shaddar");
  assert.equal(score.status.exp, 11290);
  assert.equal(score.status.hpMax, 463);
  assert.equal(score.status.bank, 27588);
});
