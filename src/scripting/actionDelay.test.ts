import assert from "node:assert/strict";
import test from "node:test";
import { runActionSteps, splitDelayTokens } from "./actionDelay.js";

test("splitDelayTokens isolates waits", () => {
  const plain = splitDelayTokens("say hi; still one");
  assert.equal(plain.ok, true);
  if (!plain.ok) return;
  assert.deepEqual(plain.parts, ["say hi; still one"]);
  assert.deepEqual(splitDelayTokens("say hi @delay 2 say bye"), {
    ok: true,
    parts: ["say hi", "@delay 2", "say bye"],
  });
  assert.equal(splitDelayTokens("say @delay").ok, false);
  assert.equal(splitDelayTokens("@delay 9999").ok, false);
});

test("runActionSteps waits before later commands and batches the rest", async () => {
  const sent: string[][] = [];
  const waits: number[] = [];
  await runActionSteps(["cast a", "cast b", "@delay 2", "cast c", "@delay 0.5", "cast d"], {
    send: (lines) => sent.push(lines),
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(sent, [["cast a", "cast b"], ["cast c"], ["cast d"]]);
  assert.deepEqual(waits, [2000, 500]);
});

test("runActionSteps stops after a delay when the connection is gone", async () => {
  const sent: string[][] = [];
  let connected = true;
  await runActionSteps(["look", "@delay 1", "inventory"], {
    send: (lines) => sent.push(lines),
    sleep: async () => {
      connected = false;
    },
    connected: () => connected,
  });
  assert.deepEqual(sent, [["look"]]);
});

test("runActionSteps flushes before a taken command and skips sending it", async () => {
  const sent: string[][] = [];
  const taken: string[] = [];
  await runActionSteps(["look", "/to home", "score"], {
    send: (lines) => sent.push(lines),
    takes: (command) => command.startsWith("/to"),
    run: async (command) => {
      taken.push(command);
    },
  });
  assert.deepEqual(sent, [["look"], ["score"]]);
  assert.deepEqual(taken, ["/to home"]);
});

test("runActionSteps stops after a taken command throws", async () => {
  const sent: string[][] = [];
  let message = "";
  await runActionSteps(["look", "/to x", "score"], {
    send: (lines) => sent.push(lines),
    takes: (command) => command.startsWith("/to"),
    run: async () => {
      throw new Error("no path");
    },
    onError: (err) => {
      message = err instanceof Error ? err.message : String(err);
    },
  });
  assert.deepEqual(sent, [["look"]]);
  assert.equal(message, "no path");
});

test("runActionSteps reports a bad delay before sending", async () => {
  const sent: string[][] = [];
  let message = "";
  await runActionSteps(["look @delay nope"], {
    send: (lines) => sent.push(lines),
    onError: (err) => {
      message = err instanceof Error ? err.message : String(err);
    },
  });
  assert.equal(sent.length, 0);
  assert.match(message, /@delay/);
});
