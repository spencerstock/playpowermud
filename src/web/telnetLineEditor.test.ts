import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CSI,
  TelnetKeyParser,
  TelnetLineEditor,
  applyTelnetKeyAction,
} from "./telnetLineEditor.js";

describe("TelnetLineEditor", () => {
  it("passes plain text unchanged on the wire", () => {
    const ed = new TelnetLineEditor();
    for (const ch of "look") ed.insertChar(ch);
    assert.equal(ed.text, "look");
    assert.equal(ed.getWireText(), "look");
  });

  it("inserts mid-line after moving the cursor left (no CSI on wire)", () => {
    const ed = new TelnetLineEditor();
    for (const ch of "ab") ed.insertChar(ch);
    ed.cursorLeft();
    ed.insertChar("c");
    assert.equal(ed.text, "acb");
    assert.equal(ed.getWireText(), "acb");
  });

  it("removes a character on backspace", () => {
    const ed = new TelnetLineEditor();
    ed.insertChar("x");
    ed.backspace();
    assert.equal(ed.text, "");
    assert.equal(ed.getWireText(), "");
  });

  it("deletes a word backward (macOS Option+Backspace)", () => {
    const ed = new TelnetLineEditor();
    for (const ch of "look north") ed.insertChar(ch);
    ed.deleteWordBackward();
    assert.equal(ed.text, "look ");
    ed.deleteWordBackward();
    assert.equal(ed.text, "look");
    ed.deleteWordBackward();
    assert.equal(ed.text, "");
  });

  it("deletes to line start (macOS Command+Backspace)", () => {
    const ed = new TelnetLineEditor();
    for (const ch of "goto temple") ed.insertChar(ch);
    ed.cursor = ed.text.length;
    ed.deleteToLineStart();
    assert.equal(ed.text, "");
  });

  it("backspace removes embedded CSI as one logical character", () => {
    const ed = new TelnetLineEditor();
    for (const ch of "say") ed.insertChar(ch);
    ed.insertWireCursorUp();
    ed.backspace();
    assert.equal(ed.text, "say");
  });

  it("inserts up/down CSI at the cursor for say-style layout", () => {
    const ed = new TelnetLineEditor();
    for (const ch of "say hi") ed.insertChar(ch);
    ed.insertWireCursorUp();
    for (const ch of " hi") ed.insertChar(ch);
    assert.equal(ed.text, `say hi${CSI.cursorUp} hi`);
    assert.equal(ed.getWireText(), ed.text);
  });

  it("does not move the cursor on left/right beyond line bounds", () => {
    const ed = new TelnetLineEditor();
    ed.insertChar("a");
    ed.cursorLeft();
    ed.cursorLeft();
    assert.equal(ed.cursor, 0);
    ed.cursorRight();
    assert.equal(ed.cursor, 1);
  });
});

describe("TelnetKeyParser", () => {
  it("parses split arrow key sequences", () => {
    const parser = new TelnetKeyParser();
    assert.deepEqual(parser.feed("\x1b"), []);
    assert.deepEqual(parser.feed("[D"), [{ type: "left" }]);
  });

  it("applies parsed keys to the editor", () => {
    const ed = new TelnetLineEditor();
    const parser = new TelnetKeyParser();
    for (const action of parser.feed("ab\x1b[Dc\r")) {
      if (action.type === "enter") break;
      applyTelnetKeyAction(ed, action);
    }
    assert.equal(ed.text, "acb");
    assert.equal(ed.getWireText(), "acb");
  });

  it("maps plain up/down to history and Option+up to wire CSI", () => {
    const parser = new TelnetKeyParser();
    assert.deepEqual(parser.feed("\x1b[A"), [{ type: "history-up" }]);
    assert.deepEqual(parser.feed("\x1b[B"), [{ type: "history-down" }]);
    assert.deepEqual(parser.feed("\x1b\x1b[A"), [{ type: "wire-up" }]);
    const ed = new TelnetLineEditor();
    for (const ch of "say") ed.insertChar(ch);
    applyTelnetKeyAction(ed, { type: "wire-up" });
    assert.equal(ed.getWireText(), `say${CSI.cursorUp}`);
  });

  it("maps Option+left/right to wire CSI", () => {
    const parser = new TelnetKeyParser();
    assert.deepEqual(parser.feed("\x1b\x1b[D"), [{ type: "wire-left" }]);
    const ed = new TelnetLineEditor();
    ed.insertChar("x");
    applyTelnetKeyAction(ed, { type: "wire-left" });
    assert.equal(ed.getWireText(), `x${CSI.cursorLeft}`);
  });
});
