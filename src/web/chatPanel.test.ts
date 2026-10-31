import assert from "node:assert/strict";
import { test } from "node:test";
import { botSocialLinesFromEchoCommand, isBotWho } from "../game/commsLogIngest.js";

test("isBotWho matches progression bot attribution", () => {
  assert.equal(isBotWho("bot"), true);
  assert.equal(isBotWho("Bot"), true);
  assert.equal(isBotWho("bot:grind"), true);
  assert.equal(isBotWho("agent"), false);
  assert.equal(isBotWho("Wybie"), false);
});

test("botSocialLinesFromEchoCommand counts say/tell/shout in echo", () => {
  assert.equal(botSocialLinesFromEchoCommand("say hi"), 1);
  assert.equal(botSocialLinesFromEchoCommand("tell bob hello"), 1);
  assert.equal(botSocialLinesFromEchoCommand("n;say hi"), 1);
  assert.equal(botSocialLinesFromEchoCommand("alias greet => say hello"), 1);
  assert.equal(botSocialLinesFromEchoCommand("n;e"), 0);
  assert.equal(botSocialLinesFromEchoCommand("say a;say b"), 2);
});
