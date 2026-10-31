import assert from "node:assert/strict";
import test from "node:test";
import { pickPlaceLabel } from "./areaPhrases.js";

const nalProse =
  "You are in the Market Area of Nal Shaddar.  Many shelves line the walls.";
const junkTitle = "purchasing?";
const combatTitle = "Drow emerges from hiding";

test("Nal Shaddar blob ignores junk titles and picks place name", () => {
  const rooms = [
    { title: junkTitle, description: nalProse },
    { title: combatTitle, description: nalProse },
    { title: null, description: "This is the market center of Nal Shaddar." },
  ];
  const pick = pickPlaceLabel(rooms, "nal-shaddar", "Nal Shaddar");
  assert.equal(pick.label, "Nal Shaddar");
  assert.equal(pick.usedFallback, false);
});

test("Overworld blob with tunnel titles stays Overworld", () => {
  const rooms = [
    { title: "Dark Tunnel", description: "The tunnel is narrow and damp." },
    { title: "Mine Tunnel", description: "A dusty path through the wilderness." },
    { title: "[0mThe tunnel", description: "You hear dripping water." },
  ];
  const pick = pickPlaceLabel(rooms, "overworld", "Overworld");
  assert.equal(pick.label, "Overworld");
  assert.equal(pick.usedFallback, true);
});

test("Northern Warrens wins on dunkrist blob when support is strong", () => {
  const north = "You are in the Northern Warrens, in the Duergar city of Dunkrist.";
  const rooms = [
    { description: north },
    { description: north },
    { description: "You are near the north end of the Northern Warrens." },
  ];
  const pick = pickPlaceLabel(rooms, "dunkrist", "Dunkrist");
  assert.equal(pick.label, "Northern Warrens");
});

test("weak hints fall back to areaLabel", () => {
  const pick = pickPlaceLabel([{ title: "Gateway Road", description: "A road." }], "kraken-alley", "Kraken Alley");
  assert.equal(pick.label, "Kraken Alley");
  assert.equal(pick.usedFallback, true);
});
