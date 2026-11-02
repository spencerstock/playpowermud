import assert from "node:assert/strict";
import { test } from "node:test";
import {
  botSocialLinesFromEchoCommand,
  createCommsLogIngest,
  isBotWho,
} from "./commsLogIngest.js";

test("isBotWho matches progression bot attribution", () => {
  assert.equal(isBotWho("bot"), true);
  assert.equal(isBotWho("Bot"), true);
  assert.equal(isBotWho("bot:grind"), true);
  assert.equal(isBotWho("agent"), false);
});

test("botSocialLinesFromEchoCommand counts say/tell/shout in echo", () => {
  assert.equal(botSocialLinesFromEchoCommand("say hi"), 1);
  assert.equal(botSocialLinesFromEchoCommand("tell bob hello"), 1);
  assert.equal(botSocialLinesFromEchoCommand("say a;say b"), 2);
  assert.equal(botSocialLinesFromEchoCommand("n;e"), 0);
});

test("ingest allows tell always; say only for You or known players", () => {
  const known = new Set(["weaver"]);
  const ingest = createCommsLogIngest(() => known);
  const tell = ingest.ingestLogText("Weaver tells you 'hello there'\n");
  assert.equal(tell.length, 1);
  assert.equal(tell[0]!.kind, "tell");

  const unknownSay = ingest.ingestLogText("Stranger says 'hi'\n");
  assert.equal(unknownSay.length, 0);

  const youSay = ingest.ingestLogText("You say 'hi'\n");
  assert.equal(youSay.length, 1);
  assert.equal(youSay[0]!.speaker, "You");

  known.add("stranger");
  const knownSay = ingest.ingestLogText("Stranger says 'yo'\n");
  assert.equal(knownSay.length, 1);
});

test("ingest skips tell/shout/announce replay log blocks", () => {
  const ingest = createCommsLogIngest(() => new Set());
  const block = [
    "======== Tell Log ========",
    "Weaver tells you 'old message'",
    "You tell Weaver 'old reply'",
    "==========================",
  ].join("\n");
  assert.equal(ingest.ingestLogText(`${block}\n`).length, 0);
  const live = ingest.ingestLogText("Weaver tells you 'live'\n");
  assert.equal(live.length, 1);
  assert.equal(live[0]!.message, "'live'");
});

test("ingest suppresses You say after bot echo", () => {
  const ingest = createCommsLogIngest(() => new Set());
  ingest.ingestLogText(">>> [bot] say hello\nYou say 'hello'\n");
  const again = ingest.ingestLogText("You say 'again'\n");
  assert.equal(again.length, 1);
});
