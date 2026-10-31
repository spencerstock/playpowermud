import assert from "node:assert/strict";
import { test } from "node:test";
import {
  outputSaysClosedDoor,
  outputSaysLockedDoor,
  outputSaysOpenedDoor,
  parseDoorLine,
  parseDoors,
} from "./doors.js";

test("door lines name the direction and whether open door will work", () => {
  assert.deepEqual(parseDoorLine("There is a stone door leading northeast ( OPENED )."), {
    name: "stone door",
    direction: "ne",
    state: "open",
  });
  assert.deepEqual(parseDoorLine("There is a adamantite door leading southwest ( CLOSED )."), {
    name: "adamantite door",
    direction: "sw",
    state: "closed",
  });
  assert.deepEqual(parseDoorLine("There is a wood door leading north ( LOCKED )."), {
    name: "wood door",
    direction: "n",
    state: "locked",
  });
  assert.equal(parseDoorLine("There is one Loreman."), null);
  assert.equal(parseDoors("There is a stone door leading up ( CLOSED ).\nThere is one guard.").length, 1);
});

test("look text is not a failed open", () => {
  const look = "There is a stone door leading northeast ( CLOSED ).";
  assert.equal(outputSaysClosedDoor(look), false);
  assert.equal(outputSaysClosedDoor("The stone door is closed."), true);
  assert.equal(outputSaysLockedDoor("The door is locked."), true);
  assert.equal(outputSaysOpenedDoor("You open the door."), true);
  assert.equal(outputSaysOpenedDoor("You open the trapdoor."), false);
});
