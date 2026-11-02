import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractChatMessage,
  parsePowermudChatLine,
  parsePowermudSideChatLine,
  parsePowermudSocialLine,
  sideChatLogBlockHeader,
} from "./socialLines.js";

test("parsePowermudSocialLine handles channel, movement, tell, and shout", () => {
  assert.deepEqual(parsePowermudSocialLine("[Adventurer] You : hi"), {
    kind: "channel",
    name: "You",
    channel: "Adventurer",
    text: "hi",
  });
  assert.equal(parsePowermudSocialLine("Zedd arrives from the north.")?.kind, "arrive");
  assert.equal(parsePowermudSocialLine("Zedd leaves east.")?.kind, "leave");
  assert.equal(parsePowermudSocialLine("Weaver tells you hello.")?.kind, "tell");
  assert.equal(parsePowermudSocialLine("Bob shouts help!")?.kind, "shout");
});

test("parsePowermudChatLine includes outgoing say, tell, and shout", () => {
  assert.deepEqual(parsePowermudChatLine("You say in common : hello there."), {
    kind: "say",
    speaker: "You",
    message: "hello there.",
    raw: "You say in common : hello there.",
  });
  assert.deepEqual(parsePowermudChatLine("You tell Weaver hi."), {
    kind: "tell",
    speaker: "You",
    target: "Weaver",
    message: "hi.",
    raw: "You tell Weaver hi.",
  });
  assert.deepEqual(parsePowermudChatLine("You shout anyone around?"), {
    kind: "shout",
    speaker: "You",
    message: "anyone around?",
    raw: "You shout anyone around?",
  });
  assert.equal(parsePowermudChatLine("Weaver says in common : yo")?.speaker, "Weaver");
  assert.equal(extractChatMessage("say", "Weaver says in common : yo"), "yo");
  assert.equal(
    extractChatMessage("say", 'Weaver says in common : he said "wait!"'),
    'he said "wait!"',
  );
  assert.equal(extractChatMessage("tell", "Weaver tells you don't stop."), "don't stop.");
});

test("parsePowermudSideChatLine is room say only", () => {
  assert.equal(parsePowermudSideChatLine("Weaver says in common : yo")?.speaker, "Weaver");
  assert.equal(parsePowermudSideChatLine("Weaver tells you hello."), null);
  assert.equal(parsePowermudSideChatLine("Bob shouts help!"), null);
});

test("sideChatLogBlockHeader matches Powermud replay log titles", () => {
  assert.ok(sideChatLogBlockHeader("Tell log"));
  assert.ok(sideChatLogBlockHeader("======== Tell Log ========"));
  assert.ok(!sideChatLogBlockHeader("Weaver tells you hi."));
});
