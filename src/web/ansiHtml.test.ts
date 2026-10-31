import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ansi256ToRgb, ansiToHtml, recastInlineColor, setAnsiSkin } from "./ansiHtml.js";

describe("ansiToHtml", () => {
  it("escapes HTML and leaves plain text alone", () => {
    assert.equal(ansiToHtml("a <b>"), "a &lt;b&gt;");
  });

  it("wraps SGR foreground color", () => {
    assert.equal(
      ansiToHtml("\x1b[31mred\x1b[0m plain"),
      '<span class="ansi-fg-red">red</span> plain',
    );
  });

  it("supports bright colors and bold", () => {
    const html = ansiToHtml("\x1b[1;91mhi\x1b[0m");
    assert.match(html, /ansi-bold/);
    assert.match(html, /ansi-fg-bright-red/);
    assert.match(html, />hi<\//);
  });

  it("supports 256-color foreground", () => {
    const html = ansiToHtml("\x1b[38;5;196m!\x1b[0m");
    assert.match(html, /style="color:rgb\(255, 0, 0\)"/);
  });
});

describe("ansi256ToRgb", () => {
  it("maps gray ramp", () => {
    assert.equal(ansi256ToRgb(232), "rgb(8, 8, 8)");
  });
});

describe("recastInlineColor", () => {
  it("darkens highlight greens on light skin", () => {
    setAnsiSkin("light");
    assert.equal(recastInlineColor("#8ae234", "fg"), "#2d6a00");
    setAnsiSkin("dark");
    assert.equal(recastInlineColor("#8ae234", "fg"), "#8ae234");
  });
});
