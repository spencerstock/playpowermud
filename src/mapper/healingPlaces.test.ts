import assert from "node:assert/strict";
import test from "node:test";
import { GameStream } from "../game/stream.js";
import { cheapestHealingItem, HEALING_TAG, healingPlaces, MenuListParser, roomHealing } from "./healingPlaces.js";
import { Mapper } from "./Mapper.js";
import { WorldMap } from "./WorldMap.js";

const P = "> ";
const RULE = "=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=";
const FOOD = [
  "Food                  Cost",
  RULE,
  "Rothe haunch           75  drakaan",
  "Boiled rothe           45  drakaan",
  "Myconid soup           5   drakaan",
  RULE,
].join("\n");
const DRINK = [
  "Drink                 Cost",
  RULE,
  "Gratock               100  drakaan",
  "Faerie blood           50  drakaan",
  "Caffya                 30  drakaan",
  "Dragon blood           20  drakaan",
  "Mushroom whiskey       10  drakaan",
  "Red wine               5   drakaan",
  RULE,
].join("\n");

function parse(text: string) {
  const p = new MenuListParser();
  const out = text.split("\n").map((l) => p.feed(l)).filter(Boolean);
  return out;
}

test("food and drink list tables parse into menus", () => {
  const [food] = parse(FOOD);
  assert.deepEqual(food, {
    kind: "food",
    items: [
      { name: "Rothe haunch", cost: 75, currency: "drakaan" },
      { name: "Boiled rothe", cost: 45, currency: "drakaan" },
      { name: "Myconid soup", cost: 5, currency: "drakaan" },
    ],
  });
  const [drink] = parse(DRINK);
  assert.equal(drink!.kind, "drink");
  assert.equal(drink!.items.length, 6);
  assert.deepEqual(drink!.items[0], { name: "Gratock", cost: 100, currency: "drakaan" });
});

test("a table interrupted by other output is dropped", () => {
  assert.deepEqual(parse(["Food                  Cost", RULE, "Myconid soup  5  drakaan", "A rat arrives from the north.", RULE].join("\n")), []);
  assert.deepEqual(parse(["Weapon                Cost", RULE, "Dagger   10  drakaan", RULE].join("\n")), []);
});

test("a list in a room tags it as a healing place; cheapest item across both menus", () => {
  const map = WorldMap.empty("test");
  const mapper = new Mapper(map);
  const stream = new GameStream();
  const feed = (text: string) => {
    for (const ev of stream.feed(text)) mapper.onGameEvent(ev);
  };
  feed(`The Rothe Tavern (n)\n${P}`);
  const bar = mapper.current()!;
  mapper.onCommandSent("list");
  feed(`${FOOD}\n${P}`);
  assert.ok(bar.tags.includes(HEALING_TAG));
  assert.equal(roomHealing(bar)?.food?.items.length, 3);
  assert.equal(cheapestHealingItem(bar)?.name, "Myconid soup");

  mapper.onCommandSent("list");
  feed(`${DRINK}\n${P}`);
  assert.equal(bar.tags.filter((t) => t === HEALING_TAG).length, 1);
  assert.equal(roomHealing(bar)?.food?.items.length, 3, "drink menu keeps the food menu");
  const pick = cheapestHealingItem(bar)!;
  assert.equal(pick.cost, 5);
  assert.equal(pick.kind, "food", "ties keep the first (food) item");
  assert.equal(pick.buy, "buy myconid soup");
  assert.deepEqual(healingPlaces(map).map((h) => h.room.id), [bar.id]);
});
