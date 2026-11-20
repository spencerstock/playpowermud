import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPages,
  enrichRow,
  escapeHtml,
  displayNormalJudge,
  displayMagicJudge,
  formatJudge,
  itemKey,
  mergeDroppedByColumns,
  parseMagicalDropsHtml,
  witnessDroppedBy,
} from "./build-wiki-items.mjs";

const FIXTURE_KNOWLEDGE = {
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  npcs: {
    "test npc": { name: "Test NPC", key: "test npc" },
  },
  items: {
    "test blade": {
      key: "test blade",
      name: "Test Blade",
      droppedBy: { "test npc": 3 },
      judge: { verdict: "good", kind: "weapon", text: "ok" },
    },
    "magic armbands": {
      key: "magic armbands",
      name: "Magic Armbands",
      judge: { verdict: "poor", kind: "armor", text: "x" },
    },
  },
  chanceDrops: [
    { npc: "test npc", item: "Test Blade", kills: 10, dropped: 2 },
  ],
};

const FIXTURE_VALUES = {
  version: 1,
  updatedAt: "2026-01-02T00:00:00.000Z",
  items: {
    "test blade": { name: "Test Blade", price: 12, maxPrice: 15, magic: false, sales: 2 },
    "magic armbands": { name: "Magic Armbands", price: 4, magic: true, sales: 1 },
  },
};

const HAND_NORMAL = [
  {
    id: "slash",
    title: "Slash",
    rows: [{ item: "Longsword", quality: "Fair weapon.", where: "Shop" }],
  },
];

const HAND_MAGIC = [
  {
    id: "ar",
    title: "Armor",
    rows: [{ item: "Fine Piwafwi", plus: "2", effects: "+10 hide" }],
  },
];

test("itemKey normalizes names", () => {
  assert.equal(itemKey("  Dark-Katana  "), "dark katana");
});

test("escapeHtml escapes angle brackets", () => {
  assert.equal(escapeHtml("a<b"), "a&lt;b");
});

test("displayNormalJudge prefers hand quality then hub judge", () => {
  assert.equal(
    displayNormalJudge({ quality: "Good weapon.", judge: "good" }),
    "Good weapon.",
  );
  assert.equal(displayNormalJudge({ quality: "", judge: "extremely good" }), "extremely good");
});

test("displayMagicJudge prefers hand quality then hub judge", () => {
  assert.equal(
    displayMagicJudge({ quality: "Terrific weapon.", judge: "terrific" }),
    "Terrific weapon.",
  );
  assert.equal(displayMagicJudge({ quality: "", judge: "poor" }), "poor");
});

test("formatJudge omits non-judgeable item reply", () => {
  assert.equal(
    formatJudge({
      text: "You can only judge a weapon or a piece of armor or an arrow.",
      verdict: null,
    }),
    "",
  );
  assert.equal(formatJudge({ verdict: "good", text: "ok" }), "good");
});

test("parseMagicalDropsHtml groups items and NPC witnesses", () => {
  const map = parseMagicalDropsHtml(`
      <h3 id="red">Red Dragon</h3>
      <ul><li>Test Blade</li><li>Scroll &amp; Parchment Case [Medium]</li></ul>
      <h3 id="blue">Blue Dragon</h3>
      <ul><li>Test Blade</li></ul>
    `);
  assert.equal(map.get("test blade")?.npcs.join(", "), "Blue Dragon, Red Dragon");
  assert.equal(map.get("scroll parchment case medium")?.displayName, "Scroll & Parchment Case [Medium]");
});

test("mergeDroppedByColumns unions hub and witness drop lists", () => {
  assert.equal(mergeDroppedByColumns("Red Dragon", "Blue Dragon"), "Blue Dragon, Red Dragon");
  assert.equal(mergeDroppedByColumns("Red Dragon×2", "Red Dragon"), "Red Dragon, Red Dragon×2");
});

test("buildPages merges witnessed drops into magic items", () => {
  const witness = parseMagicalDropsHtml(
    `<h3 id="x">Red Dragon</h3><ul><li>Only In Drops</li><li>Fine Piwafwi</li></ul>`,
  );
  const { magicHtml } = buildPages(HAND_NORMAL, HAND_MAGIC, null, null, witness);
  assert.match(magicHtml, /Only In Drops/);
  assert.match(magicHtml, /Red Dragon/);
  const piwafwi = magicHtml.match(/Fine Piwafwi[\s\S]*?<\/tr>/);
  assert.ok(piwafwi?.[0].includes("Red Dragon"), "existing row should gain witness NPC");
});

test("enrichRow fills judge sell and dropped by", () => {
  const extra = enrichRow(
    "Test Blade",
    FIXTURE_KNOWLEDGE,
    FIXTURE_VALUES,
    FIXTURE_KNOWLEDGE.npcs,
  );
  assert.equal(extra.judge, "good");
  assert.equal(extra.sell, "12–15");
  assert.equal(extra.droppedBy, "Test NPC×3");
});

test("buildPages with stats adds columns and appended rows", () => {
  const { normalHtml, magicHtml, withStats } = buildPages(
    HAND_NORMAL,
    HAND_MAGIC,
    FIXTURE_KNOWLEDGE,
    FIXTURE_VALUES,
  );
  assert.equal(withStats, true);
  assert.match(normalHtml, /<th>Judge<\/th>/);
  assert.match(normalHtml, /Test Blade/);
  assert.match(normalHtml, /good/);
  assert.doesNotMatch(normalHtml, /<th>[^<]*[Ee]xp/);
  assert.match(magicHtml, /Magic Armbands/);
  assert.match(magicHtml, /Fine Piwafwi/);
  assert.match(magicHtml, /<th>Slot<\/th>/);
  assert.equal((magicHtml.match(/<table>/g) ?? []).length, 1);
  assert.doesNotMatch(normalHtml, /<th>Drop rate<\/th>/);
  assert.doesNotMatch(normalHtml, /<th>Quality<\/th>/);
});

test("buildPages without stats keeps three-column tables", () => {
  const { normalHtml, withStats } = buildPages(HAND_NORMAL, HAND_MAGIC, null, null);
  assert.equal(withStats, false);
  assert.match(normalHtml, /<th>Where<\/th>/);
  assert.match(normalHtml, /<th>Judge<\/th>/);
  assert.doesNotMatch(normalHtml, /<th>Quality<\/th>/);
  assert.match(normalHtml, /Longsword/);
});

test("full hand data row count preserved in normal sections", async () => {
  const { NORMAL_SECTIONS, MAGIC_SECTIONS } = await import("./items-hand-data.mjs");
  const handNormal = NORMAL_SECTIONS.reduce((n, s) => n + s.rows.length, 0);
  const { normalHtml } = buildPages(
    NORMAL_SECTIONS,
    MAGIC_SECTIONS,
    FIXTURE_KNOWLEDGE,
    FIXTURE_VALUES,
  );
  const rows = (normalHtml.match(/<tr><td>/g) ?? []).length;
  assert.ok(rows >= handNormal, `expected at least ${handNormal} rows, got ${rows}`);
});
