import assert from "node:assert/strict";
import test from "node:test";
import { ScrollbackBuffer, stripAnsi } from "./scrollback.js";

test("stripAnsi removes color codes", () => {
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
});

test("ScrollbackBuffer tailLines", () => {
  const buf = new ScrollbackBuffer(100);
  buf.append("line one\nline two\n");
  const tail = buf.tailLines(2);
  assert.equal(tail.length, 2);
  assert.equal(tail[0]?.text, "line one");
  assert.equal(tail[1]?.text, "line two");
  assert.equal(tail[1]?.n, 2);
});
