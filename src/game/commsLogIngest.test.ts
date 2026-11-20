import assert from "node:assert/strict";
import { test } from "node:test";
import {
  botSocialLinesFromEchoCommand,
  COMMS_CONTINUATION_MS,
  createCommsLogIngest,
  isBotWho,
  isChatContinuationLine,
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
  assert.equal(tell.added.length, 1);
  assert.equal(tell.added[0]!.kind, "tell");

  const unknownSay = ingest.ingestLogText("Stranger says 'hi'\n");
  assert.equal(unknownSay.added.length, 0);

  const youSay = ingest.ingestLogText("You say 'hi'\n");
  assert.equal(youSay.added.length, 1);
  assert.equal(youSay.added[0]!.speaker, "You");

  known.add("stranger");
  const knownSay = ingest.ingestLogText("Stranger says 'yo'\n");
  assert.equal(knownSay.added.length, 1);
});

test("ingest skips tell/shout/announce replay log blocks", () => {
  const ingest = createCommsLogIngest(() => new Set());
  const block = [
    "======== Tell Log ========",
    "Weaver tells you 'old message'",
    "You tell Weaver 'old reply'",
    "==========================",
  ].join("\n");
  assert.equal(ingest.ingestLogText(`${block}\n`).added.length, 0);
  const live = ingest.ingestLogText("Weaver tells you 'live'\n");
  assert.equal(live.added.length, 1);
  assert.equal(live.added[0]!.message, "'live'");
});

test("ingest suppresses You say after bot echo", () => {
  const ingest = createCommsLogIngest(() => new Set());
  ingest.ingestLogText(">>> [bot] say hello\nYou say 'hello'\n");
  const again = ingest.ingestLogText("You say 'again'\n");
  assert.equal(again.added.length, 1);
});

test("isChatContinuationLine accepts indented speech and rejects maps", () => {
  assert.equal(isChatContinuationLine("     very limited.  AA games will do well"), true);
  assert.equal(isChatContinuationLine("  years ago?"), true);
  assert.equal(isChatContinuationLine("Sassman tells you : hello"), false);
  assert.equal(isChatContinuationLine("     #--#"), false);
  assert.equal(isChatContinuationLine("     |"), false);
});

test("ingest joins Powermud-wrapped tell lines in one chunk", () => {
  const ingest = createCommsLogIngest(() => new Set());
  const raw = [
    "Sassman tells you : Yeah, I agree.  I think the age of AAA games are gone and ",
    "     very limited.  AA games will do well and indies should do the best.  ",
    "     It's more about saturation than anything at this point.  ",
  ].join("\r\n");
  const { added, updated } = ingest.ingestLogText(`${raw}\r\n`, 1_000);
  assert.equal(added.length, 1);
  assert.equal(updated.length, 0);
  assert.equal(
    added[0]!.message,
    "Yeah, I agree.  I think the age of AAA games are gone and very limited.  AA games will do well and indies should do the best. It's more about saturation than anything at this point.",
  );
});

test("ingest joins wrap tails that arrive in a later chunk and reports them as updates", () => {
  const ingest = createCommsLogIngest(() => new Set());
  const first = ingest.ingestLogText(
    "Sassman tells you : lol, I could tell you stories.  There is a game at 2K \r\n",
    1_000,
  );
  assert.equal(first.added.length, 1);
  assert.equal(first.added[0]!.message, "lol, I could tell you stories.  There is a game at 2K");

  const more = [
    "     called Horizon internally and Project Ethos on Steam.  It had a beta, ",
    "     and they forced every player to sign into 2K to get their key and lost ",
    "     so many players.  It bombed badly.  That was October 2024.",
  ].join("\r\n");
  const second = ingest.ingestLogText(`${more}\r\n`, 1_200);
  assert.equal(second.added.length, 0);
  assert.equal(second.updated.length, 1);
  assert.equal(second.updated[0], first.added[0]);
  assert.equal(
    first.added[0]!.message,
    "lol, I could tell you stories.  There is a game at 2K called Horizon internally and Project Ethos on Steam.  It had a beta, and they forced every player to sign into 2K to get their key and lost so many players.  It bombed badly.  That was October 2024.",
  );
});

test("ingest does not join a flush-left line or a wrap after the continuation window", () => {
  const ingest = createCommsLogIngest(() => new Set());
  const first = ingest.ingestLogText("Sassman tells you : well, 33,000 is the high end.\r\n", 1_000);
  const combat = ingest.ingestLogText("You stab City guard with precision accuracy.\r\n", 1_100);
  assert.equal(combat.added.length, 0);
  assert.equal(combat.updated.length, 0);
  assert.equal(first.added[0]!.message, "well, 33,000 is the high end.");

  const late = ingest.ingestLogText("     Are you at EA?\r\n", 1_000 + COMMS_CONTINUATION_MS + 1);
  assert.equal(late.added.length, 0);
  assert.equal(late.updated.length, 0);
  assert.equal(first.added[0]!.message, "well, 33,000 is the high end.");
});
