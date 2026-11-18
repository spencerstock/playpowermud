import assert from "node:assert/strict";
import test from "node:test";
import { loadMobileButtons, normalizeMobileButtons, type MobileCommandButton } from "./mobileButtons.js";

test("defaults keep look, who, and score when storage is empty or junk", () => {
  assert.deepEqual(
    normalizeMobileButtons(null).map((b) => b.id),
    ["look", "who", "score"],
  );
  assert.deepEqual(loadMobileButtons(null).map((b) => b.command), ["look", "who", "score"]);
  const storage = { getItem: () => "{not json" };
  assert.equal(loadMobileButtons(storage)[0]?.command, "look");
});

test("saved commands replace builtins and custom buttons stay after them", () => {
  const buttons: MobileCommandButton[] = [
    { id: "btn-home", label: "home", command: "/to home" },
    { id: "who", label: "who", command: "who" },
    { id: "score", label: "sc", command: "score;inventory" },
    { id: "look", label: "see", command: "look" },
    { id: "btn-home", label: "dup", command: "dup" },
    { id: "btn-blank", label: "  ", command: "look" },
  ];
  const out = normalizeMobileButtons({ buttons });
  assert.deepEqual(
    out.map((b) => [b.id, b.label, b.command]),
    [
      ["look", "see", "look"],
      ["who", "who", "who"],
      ["score", "sc", "score;inventory"],
      ["btn-home", "home", "/to home"],
    ],
  );
});
