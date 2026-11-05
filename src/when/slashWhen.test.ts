import assert from "node:assert/strict";
import test from "node:test";
import { formatWhenListText } from "./formatList.js";
import { parseSlashUnwhenLine, parseSlashWhenLine } from "./slashWhen.js";

test("parseSlashWhenLine list and define", () => {
  assert.equal(parseSlashWhenLine("/alias x y"), null);
  assert.deepEqual(parseSlashWhenLine("/when"), { kind: "list" });
  assert.deepEqual(parseSlashWhenLine('/when "too entangled" "flee"'), {
    kind: "define",
    trigger: "too entangled",
    command: "flee",
  });
  assert.deepEqual(parseSlashWhenLine('/when "a"'), {
    kind: "error",
    reason: 'usage: /when "TRIGGER" "COMMAND"',
  });
});

test("parseSlashUnwhenLine uses 1-based index", () => {
  assert.deepEqual(parseSlashUnwhenLine("/unwhen 2"), { ok: true, index: 2 });
  assert.deepEqual(parseSlashUnwhenLine("/unwhen"), { ok: false, reason: "usage: /unwhen NUMBER" });
  assert.deepEqual(parseSlashUnwhenLine('/unwhen "foo"'), {
    ok: false,
    reason: "usage: /unwhen NUMBER",
  });
});

test("formatWhenListText is numbered and mentions /unwhen", () => {
  const text = formatWhenListText([{ match: "entangled", command: "flee" }]);
  assert.match(text, /1\. when "entangled" → flee/);
  assert.match(text, /\/unwhen NUMBER/);
});
