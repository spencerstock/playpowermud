import assert from "node:assert/strict";
import { test } from "node:test";
import { isNonTitleLine, roomDisplayTitle, titleFromDescription } from "./roomTitle.js";

const MARKET =
  "You are in the Market Area of Nal Shaddar.  The cavern is not so high above\nyour head here, as it is close to the cavern walls to the east.";

test("combat lines leaked into a description never become the title", () => {
  assert.equal(
    titleFromDescription(`Drow punches you with zeal, but doing no damage.\n${MARKET}`),
    "You are in the Market Area of Nal Shaddar",
  );
  assert.equal(
    titleFromDescription(`Human slave punches you with zeal, but doing no damage.\nYou slash Human slave solidly, causing moderate damage.\nYour broadsword takes some damage.\n${MARKET}`),
    "You are in the Market Area of Nal Shaddar",
  );
  assert.equal(
    titleFromDescription(`The fire golem breathes fire at you!\n\nGolem punches you with zeal, but doing no damage.\nYou are standing in a short hallway.`),
    "You are standing in a short hallway",
  );
});

test("NPC speech leaked into a description is skipped", () => {
  assert.equal(
    titleFromDescription(`Bartender asks in drow : What can I get you?\n${MARKET}`),
    "You are in the Market Area of Nal Shaddar",
  );
});

test("clean descriptions and stored titles are unchanged", () => {
  assert.equal(titleFromDescription(MARKET), "You are in the Market Area of Nal Shaddar");
  assert.equal(roomDisplayTitle({ title: "Grand Melee", description: "Drow punches you with zeal." }), "Grand Melee");
  assert.equal(roomDisplayTitle({ description: undefined }), undefined);
  assert.equal(titleFromDescription("The Dark Trinity was established by an almost-insane\nzealot."), "The Dark Trinity was established by an almost-insane");
  assert.equal(isNonTitleLine("The Merchant Area of Nal Shaddar stretches on here."), false);
});

test("a description that is only noise yields no title", () => {
  assert.equal(titleFromDescription("Drow punches you with zeal, but doing no damage."), undefined);
});

test("an all-fragment description keeps its fragment rather than losing the title", () => {
  assert.equal(titleFromDescription("so continues to the west and north."), "so continues to the west and north");
  assert.equal(titleFromDescription("Orc slave punches you with zeal, but doing no damage.\nso continues west."), "so continues west");
});

test("hunger ticks and mob-on-you exclamations never become the title", () => {
  const R1 = "This part of Nal Shaddar has been set aside for the merchant trade.  Various\nbooths and vendors are around, hawking their wares.";
  assert.equal(titleFromDescription(`The spider slams into you!\n${R1}`), "This part of Nal Shaddar has been set aside for the merchant");
  assert.equal(titleFromDescription(`Your stomach rumbles.\n${MARKET}`), "You are in the Market Area of Nal Shaddar");
  assert.equal(titleFromDescription(`The cave fisher is having a hard time reeling you in!\n${MARKET}`), "You are in the Market Area of Nal Shaddar");
});
