import assert from "node:assert/strict";
import test from "node:test";
import {
  eventMatchesBinding,
  formatKeyBinding,
  isReservedBinding,
  keySpecFromKeyboardEvent,
  parseKeyBinding,
} from "./keySpec.js";

test("parseKeyBinding accepts F-keys and modified letters", () => {
  assert.deepEqual(parseKeyBinding("F2"), {
    ok: true,
    binding: { ctrl: false, alt: false, shift: false, meta: false, code: "F2" },
  });
  const ctrlQ = parseKeyBinding("Ctrl+Shift+q");
  assert.equal(ctrlQ.ok, true);
  if (ctrlQ.ok) {
    assert.equal(formatKeyBinding(ctrlQ.binding), "Ctrl+Shift+Q");
  }
});

test("parseKeyBinding rejects bare letters and reserved Alt chords", () => {
  assert.equal(parseKeyBinding("q").ok, false);
  const altW = parseKeyBinding("Alt+W");
  assert.equal(altW.ok, false);
  if (!altW.ok) assert.match(altW.reason, /reserved/i);
});

test("isReservedBinding matches built-in panel shortcuts", () => {
  assert.equal(
    isReservedBinding({ ctrl: false, alt: true, shift: false, meta: false, code: "KeyM" }),
    true,
  );
});

test("keySpecFromKeyboardEvent rejects reserved Alt+W", () => {
  const e = {
    repeat: false,
    key: "w",
    code: "KeyW",
    ctrlKey: false,
    altKey: true,
    shiftKey: false,
    metaKey: false,
  } as KeyboardEvent;
  const spec = keySpecFromKeyboardEvent(e);
  assert.equal(spec.ok, false);
});

test("keySpecFromKeyboardEvent accepts Ctrl+F5", () => {
  const e = {
    repeat: false,
    key: "F5",
    code: "F5",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  } as KeyboardEvent;
  const spec = keySpecFromKeyboardEvent(e);
  assert.deepEqual(spec, { ok: true, key: "Ctrl+F5" });
});

test("eventMatchesBinding compares modifiers and code", () => {
  const parsed = parseKeyBinding("Ctrl+F5");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const e = {
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    code: "F5",
  } as KeyboardEvent;
  assert.equal(eventMatchesBinding(e, parsed.binding), true);
});
