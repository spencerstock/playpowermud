import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_ESET_DEFAULTS, EsetLoginSync, esetFixCommands, parseEsetListing } from "./esetSync.js";

const LISTING = `Variable                       Setting
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
announce                       bold yellow
ansi                           on
auction                        bold yellow
chat                           bold green
emote                          cyan
fields                         green
follow                         on
globe_move                     backstab
glove_move                     spin-kick
groupchat                      bold magenta
guild                          green
monitor                        on
moon                           off
more_length                    50
no_moon                        on
race                           green
say                            green
shout                          bold cyan
teaching                       on
tell                           bold green
`;

test("parseEsetListing reads variable rows and ignores the frame", () => {
  const settings = parseEsetListing(LISTING);
  assert.ok(settings);
  assert.equal(settings.get("announce"), "bold yellow");
  assert.equal(settings.get("tell"), "bold green");
  assert.equal(settings.get("no_moon"), "on");
  assert.equal(settings.get("more_length"), "50");
  assert.equal(settings.get("glove_move"), "spin-kick");
  assert.equal(settings.has("variable"), false);
});

test("a fully configured listing needs no writes", () => {
  const settings = parseEsetListing(`${LISTING}[HP:100 SP:50]> `);
  assert.deepEqual(esetFixCommands(settings!), []);
});

test("missing channels, ansi, no_moon, more_length, and follow are filled in", () => {
  const settings = parseEsetListing(`Variable                       Setting
=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
ansi                           off
moon                           off
`);
  assert.deepEqual(esetFixCommands(settings!), [
    "eset ansi on",
    ...Object.entries(CHANNEL_ESET_DEFAULTS).map(([name, value]) => `eset ${name} ${value}`),
    "eset no_moon on",
    "eset more_length 50",
    "eset follow on",
  ]);
});

test("no_moon off and existing more_length and follow are left alone", () => {
  const settings = parseEsetListing(`Variable                       Setting
=-=-=-=-=-=-=-=-=-=
ansi                           on
${Object.entries(CHANNEL_ESET_DEFAULTS)
  .map(([name, value]) => `${name}                       ${value}`)
  .join("\n")}
no_moon                        off
more_length                    20
follow                         off
`);
  assert.deepEqual(esetFixCommands(settings!), []);
});

test("no_moon is turned on when it is present but not off", () => {
  const base = `Variable                       Setting
=-=-=-=-=-=-=-=-=-=
ansi                           ON
follow                         on
more_length                    50
no_moon                        yes
${Object.entries(CHANNEL_ESET_DEFAULTS)
  .map(([name, value]) => `${name}   ${value}`)
  .join("\n")}
`;
  assert.deepEqual(esetFixCommands(parseEsetListing(base)!), ["eset no_moon on"]);
});

test("login capture hides the listing and releases the prompt", () => {
  const sync = new EsetLoginSync();
  assert.equal(sync.onEnteredGame(), "eset");
  const raw = `\r\neset\r\n${LISTING.replace(/\n/g, "\r\n")}[HP:99 SP:40]> `;
  let visible = "";
  const sends: string[] = [];
  for (let i = 0; i < raw.length; i += 11) {
    const step = sync.consume(raw.slice(i, i + 11));
    visible += step.visible;
    sends.push(...step.send);
  }
  assert.equal(sends.length, 0);
  assert.equal(visible.includes("Variable"), false);
  assert.equal(visible.includes("bold yellow"), false);
  assert.equal(visible.includes("eset"), false);
  assert.match(visible, /\[HP:99 SP:40\]> $/);
});

test("login capture sends fixes and swallows their acknowledgements", () => {
  const sync = new EsetLoginSync();
  sync.onEnteredGame();
  const listing = `Variable                       Setting
=-=-=-=-=-=-=-=-=-=
ansi                           off
follow                         off
`;
  const first = sync.consume(`${listing}\n[HP:10 SP:10]> `);
  assert.equal(first.visible.includes("ansi"), false);
  assert.match(first.visible, /\[HP:10 SP:10\]> $/);
  assert.ok(first.send.includes("eset ansi on"));
  assert.equal(first.send.includes("eset follow on"), false);
  assert.ok(first.send.includes("eset no_moon on"));
  assert.ok(first.send.includes("eset more_length 50"));

  let shown = "";
  const body = first.send
    .map((cmd) => {
      const name = cmd.split(/\s+/)[1];
      return `${name} set to ${cmd.split(/\s+/).slice(2).join(" ")}.\r\n[HP:10 SP:10]> \r\n`;
    })
    .join("");
  const trail = "Lorax tells you: hi\r\n";
  const step = sync.consume(body + trail);
  shown += step.visible;
  assert.equal(shown.includes("set to"), false);
  assert.match(shown, /\[HP:10 SP:10\]> /);
  assert.match(shown, /Lorax tells you: hi/);
});

test("Setting variable replies are hidden only for the automatic writes", () => {
  const sync = new EsetLoginSync();
  sync.onEnteredGame();
  const listing = `Variable                       Setting
=-=-=-=-=-=-=-=-=-=
ansi                           on
`;
  const first = sync.consume(`${listing}\n[HP:10 SP:10]> `);
  assert.ok(first.send.length > 0);
  const body = first.send
    .map((cmd) => {
      const parts = cmd.split(/\s+/);
      const name = parts[1];
      const value = parts.slice(2).join(" ");
      return `>Setting variable '${name}' to '${value}'.\r\n`;
    })
    .join("");
  const step = sync.consume(`${body}[HP:10 SP:10]> `);
  assert.equal(step.visible.includes("Setting variable"), false);
  assert.match(step.visible, /\[HP:10 SP:10\]> $/);
  const later = sync.consume(">Setting variable 'tell' to 'bold red'.\r\n");
  assert.match(later.visible, /Setting variable 'tell' to 'bold red'/);
});

test("a non-listing reply is shown and does not loop", () => {
  const sync = new EsetLoginSync();
  sync.onEnteredGame();
  const step = sync.consume("What?\r\n[HP:1 SP:1]> ");
  assert.match(step.visible, /What\?/);
  assert.deepEqual(step.send, []);
  const next = sync.consume("You see nothing.\r\n");
  assert.match(next.visible, /You see nothing/);
});

test("leaving the game arms another character", () => {
  const sync = new EsetLoginSync();
  assert.equal(sync.onEnteredGame(), "eset");
  assert.equal(sync.onEnteredGame(), null);
  sync.leaveGame();
  assert.equal(sync.onEnteredGame(), "eset");
});
