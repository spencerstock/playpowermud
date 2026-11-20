import assert from "node:assert/strict";
import test from "node:test";
import { parseSessionIndex, sanitizeSessionName, sessionConfigKey } from "./sessions.js";

test("sanitizeSessionName trims and falls back", () => {
  assert.equal(sanitizeSessionName("  Alt  "), "Alt");
  assert.equal(sanitizeSessionName("   "), "Session");
  assert.equal(sanitizeSessionName("x".repeat(50)).length, 40);
});

test("sessionConfigKey rejects odd ids", () => {
  assert.equal(sessionConfigKey("abc-123"), "session-config:abc-123");
  assert.throws(() => sessionConfigKey("../nope"), /Bad session id/);
});

test("parseSessionIndex requires a live session that exists", () => {
  assert.equal(
    parseSessionIndex({
      activeId: "a",
      sessions: [{ id: "a", name: "Main", updatedAt: "t" }],
    })?.activeId,
    "a",
  );
  assert.equal(parseSessionIndex({ activeId: "missing", sessions: [{ id: "a", name: "Main", updatedAt: "t" }] }), undefined);
  assert.equal(parseSessionIndex({ activeId: "a", sessions: [] }), undefined);
});
