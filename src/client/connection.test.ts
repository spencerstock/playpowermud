import assert from "node:assert/strict";
import test from "node:test";
import { defaultRelayUrl, isDirectMudWebSocket } from "./connection.js";

test("isDirectMudWebSocket: port 2001 and powermud host", () => {
  assert.equal(isDirectMudWebSocket("ws://powermud.com:2001"), true);
  assert.equal(isDirectMudWebSocket("wss://powermud.com:2001/"), true);
  assert.equal(isDirectMudWebSocket("wss://playpowermud.vercel.app/api/ws"), false);
  assert.equal(isDirectMudWebSocket("ws://127.0.0.1:3000/api/ws"), false);
});

test("defaultRelayUrl: query override", () => {
  const loc = { protocol: "https:", host: "playpowermud.com", search: "?relay=ws%3A%2F%2Fpowermud.com%3A2001" } as Location;
  assert.equal(defaultRelayUrl(loc, ""), "ws://powermud.com:2001");
});