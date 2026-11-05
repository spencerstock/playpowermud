import assert from "node:assert/strict";
import test from "node:test";
import { formatHotkeyListText } from "./formatList.js";
import { parseSlashHotkeyLine, parseSlashUnhotkeyLine } from "./slashHotkey.js";

test("parseSlashHotkeyLine list and define", () => {
  assert.equal(parseSlashHotkeyLine("/when"), null);
  assert.deepEqual(parseSlashHotkeyLine("/hotkey"), { kind: "list" });
  assert.deepEqual(parseSlashHotkeyLine('/hotkey "F2" "score"'), {
    kind: "define",
    key: "F2",
    command: "score",
  });
  assert.deepEqual(parseSlashHotkeyLine('/hotkey "F2"'), {
    kind: "error",
    reason: 'usage: /hotkey "KEY" "COMMAND"',
  });
});

test("parseSlashUnhotkeyLine uses 1-based index", () => {
  assert.deepEqual(parseSlashUnhotkeyLine("/unhotkey 2"), { ok: true, index: 2 });
  assert.deepEqual(parseSlashUnhotkeyLine("/unhotkey"), { ok: false, reason: "usage: /unhotkey NUMBER" });
});

test("formatHotkeyListText is numbered and mentions /unhotkey", () => {
  const text = formatHotkeyListText([{ key: "F2", command: "score" }]);
  assert.match(text, /1\. hotkey F2 → score/);
  assert.match(text, /\/unhotkey NUMBER/);
});
