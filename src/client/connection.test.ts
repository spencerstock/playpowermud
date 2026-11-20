import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_MUD_WS_URL,
  defaultMudWebSocketUrl,
  defaultRelayUrl,
  isDirectMudWebSocket,
  isRelayWebSocket,
} from "./connection.js";

test("isDirectMudWebSocket: prod :2000, dev :2001, path routes; relay is /api/ws", () => {
  assert.equal(isDirectMudWebSocket("wss://powermud.com:2000"), true);
  assert.equal(isDirectMudWebSocket("wss://powermud.com:2000/"), true);
  assert.equal(isDirectMudWebSocket("ws://powermud.com:2001"), true);
  assert.equal(isDirectMudWebSocket("wss://powermud.com:2001/"), true);
  assert.equal(isDirectMudWebSocket("wss://powermud.com/ws2000"), true);
  assert.equal(isDirectMudWebSocket("wss://powermud.com/ws2001"), true);
  assert.equal(isDirectMudWebSocket("wss://playpowermud.vercel.app/api/ws"), false);
  assert.equal(isDirectMudWebSocket("wss://playpowermud.com/api/ws/"), false);
  assert.equal(isDirectMudWebSocket("ws://127.0.0.1:3000/api/ws"), false);
  assert.equal(isRelayWebSocket("ws://127.0.0.1:3000/api/ws"), true);
  assert.equal(isDirectMudWebSocket("not a url"), false);
});

test("defaultMudWebSocketUrl: production when unset, query override wins", () => {
  const bare = { search: "" } as Location;
  assert.equal(defaultMudWebSocketUrl(bare, ""), PRODUCTION_MUD_WS_URL);
  assert.equal(defaultMudWebSocketUrl(bare, "  "), PRODUCTION_MUD_WS_URL);
  assert.equal(defaultMudWebSocketUrl(bare, "wss://example.test/api/ws"), "wss://example.test/api/ws");
  const loc = { search: "?relay=ws%3A%2F%2Fpowermud.com%3A2001" } as Location;
  assert.equal(defaultMudWebSocketUrl(loc, PRODUCTION_MUD_WS_URL), "ws://powermud.com:2001");
  assert.equal(defaultRelayUrl(bare, ""), PRODUCTION_MUD_WS_URL);
});