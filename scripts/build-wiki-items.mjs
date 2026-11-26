/**
 * Regenerate equipment wiki pages from scripts/items-hand-data.mjs + vendored stats JSON.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAGIC_SECTIONS, NORMAL_SECTIONS } from "./items-hand-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const STATS_DIR = path.join(ROOT, "data", "stats");
const ITEMS_DIR = path.join(ROOT, "public", "wiki", "items");
const WITNESS_DROPS_HTML = path.join(ROOT, "public", "wiki", "npcs", "drops.html");

/** @param {string} s */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const JUDGE_NOT_APPLICABLE =
  /^You can only judge a weapon or a piece of armor or an arrow\.?$/i;

/** @param {{ verdict?: string | null, text?: string } | undefined} judge */
export function formatJudge(judge) {
  if (!judge) return "";
  const verdict = judge.verdict?.trim();
  if (verdict && !JUDGE_NOT_APPLICABLE.test(verdict)) return verdict;
  const text = judge.text?.trim() ?? "";
  if (!text || JUDGE_NOT_APPLICABLE.test(text)) return "";
  return text;
}

/** @param {string} name */
export function itemKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** @param {string} s */
function decodeWikiText(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Player-reported magic drops from public/wiki/npcs/drops.html (NPC → item lists).
 * @param {string} html
 * @returns {Map<string, { displayName: string, npcs: string[] }>}
 */
export function parseMagicalDropsHtml(html) {
  /** @type {Map<string, { displayName: string, npcs: string[] }>} */
  const byKey = new Map();
  for (const block of html.matchAll(
    /<h3[^>]*>([^<]+)<\/h3>\s*<ul>([\s\S]*?)<\/ul>/g,
  )) {
    const npc = formatDropNpcLabel(decodeWikiText(block[1].trim()));
    for (const li of block[2].matchAll(/<li>([^<]+)<\/li>/g)) {
      const displayName = decodeWikiText(li[1].trim());
      const key = itemKey(displayName);
      if (!key) continue;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { displayName, npcs: [] };
        byKey.set(key, entry);
      }
      if (!entry.npcs.includes(npc)) entry.npcs.push(npc);
    }
  }
  for (const entry of byKey.values()) {
    entry.npcs.sort((a, b) => a.localeCompare(b));
  }
  return byKey;
}

const LEGACY_DROP_NPC_SUFFIX = / \(legacy 2008\)$/i;
const DROP_COUNT_SUFFIX = /×\d+$/;

/** NPC names in equipment drop columns (not full drops.html headings). */
export function formatDropNpcLabel(name) {
  let s = String(name).trim().replace(LEGACY_DROP_NPC_SUFFIX, "");
  if (s === s.toLowerCase() && /[a-z]/.test(s)) s = titleCaseNpc(s);
  return s;
}

/** @param {string} piece */
function dropNpcDedupeKey(label) {
  return formatDropNpcLabel(label.replace(DROP_COUNT_SUFFIX, "")).toLowerCase();
}

/** Provenance notes (not kill drops) stay out of equipment tables. */
function isNpcDropLabel(piece) {
  const base = formatDropNpcLabel(piece.replace(DROP_COUNT_SUFFIX, "")).toLowerCase();
  if (base.includes("bey-sandrax")) return false;
  if (base.includes("chest only")) return false;
  if (/^staff\s+chest\b/.test(base)) return false;
  return true;
}

/** @param {string} piece */
function dropNpcPieceScore(piece) {
  let score = 0;
  if (!DROP_COUNT_SUFFIX.test(piece.trim())) score += 2;
  if (!LEGACY_DROP_NPC_SUFFIX.test(piece)) score += 1;
  return score;
}

/** @param {string | undefined} a @param {string | undefined} b */
export function mergeDroppedByColumns(a, b) {
  /** @type {Map<string, { label: string, score: number }>} */
  const byKey = new Map();
  for (const col of [a, b]) {
    if (!col?.trim()) continue;
    for (const piece of col.split(/,\s*/)) {
      const t = piece.trim();
      if (!t || !isNpcDropLabel(t)) continue;
      const key = dropNpcDedupeKey(t);
      const count = DROP_COUNT_SUFFIX.exec(t)?.[0] ?? "";
      const label = formatDropNpcLabel(t.replace(DROP_COUNT_SUFFIX, "")) + count;
      const score = dropNpcPieceScore(t);
      const prev = byKey.get(key);
      if (!prev || score > prev.score) byKey.set(key, { label, score });
    }
  }
  // Drop kill-count suffix when the same NPC appears more than once in the merge input.
  /** @type {Map<string, number>} */
  const keyCounts = new Map();
  for (const col of [a, b]) {
    if (!col?.trim()) continue;
    for (const piece of col.split(/,\s*/)) {
      const t = piece.trim();
      if (!t || !isNpcDropLabel(t)) continue;
      const key = dropNpcDedupeKey(t);
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
  }
  const labels = [...byKey.entries()].map(([key, { label }]) => {
    if ((keyCounts.get(key) ?? 0) > 1 && DROP_COUNT_SUFFIX.test(label)) {
      return label.replace(DROP_COUNT_SUFFIX, "");
    }
    return label;
  });
  return labels.sort((x, y) => x.localeCompare(y)).join(", ");
}

/** @param {Map<string, { displayName: string, npcs: string[] }>} witnessMap @param {string} key */
export function witnessDroppedBy(witnessMap, key) {
  const entry = witnessMap.get(key);
  if (!entry?.npcs.length) return "";
  return mergeDroppedByColumns(entry.npcs.join(", "), "");
}

/** @param {string} title @param {string} description */
function wikiShell(title, description, mainHtml, statsUpdated, footLinks) {
  const footExtra = statsUpdated
    ? `\n      <p class="wiki-foot-note">Hub stats merged: ${escapeHtml(statsUpdated)}.</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en" class="wiki-root">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
    <title>${escapeHtml(title)} — Play Powermud wiki</title>
    <link rel="stylesheet" href="/style.css" />
    <link rel="stylesheet" href="/wiki/wiki.css" />
  </head>
  <body class="wiki-page">
    <a class="wiki-skip" href="#wiki-main">Skip to content</a>
    <header class="wiki-top">
      <h1><a href="/wiki/">playpowermud wiki</a></h1>
      <div class="wiki-top-actions">
        <button type="button" id="wiki-skin">Skin: Dark</button>
        <a href="/" class="primary">Play</a>
      </div>
    </header>

    <div id="wiki-nav-root"></div>

    <main class="wiki-main" id="wiki-main">
${mainHtml}
    </main>

    <footer class="wiki-foot">
      <p><a href="/wiki/">Wiki home</a> · ${footLinks} · <a href="/">Play Powermud</a></p>${footExtra}
    </footer>
    <script src="/wiki/wiki.js"></script>
  </body>
</html>
`;
}

/** Hand-curated quality lines and hub judge verdicts are the same field on the wiki. */
export function displayNormalJudge(row) {
  return (row.quality?.trim() || row.judge?.trim() || "");
}

/** @param {{ quality?: string, judge?: string }} row */
export function displayMagicJudge(row) {
  return (row.quality?.trim() || row.judge?.trim() || "");
}

/** @param {import("./items-hand-data.mjs").NORMAL_SECTIONS[0]["rows"][0] & { judge?: string, sell?: string, droppedBy?: string }} row @param {boolean} withStats */
function renderNormalRow(row, withStats) {
  const judge = displayNormalJudge(row);
  let cells = `<tr><td>${escapeHtml(row.item)}</td><td>${escapeHtml(judge)}</td><td>${escapeHtml(row.where)}</td>`;
  if (withStats) {
    cells += `<td>${escapeHtml(row.sell ?? "")}</td><td>${escapeHtml(row.droppedBy ?? "")}</td>`;
  }
  return `${cells}</tr>\n`;
}

/**
 * @param {import("./items-hand-data.mjs").MAGIC_SECTIONS[0]["rows"][0] & { judge?: string, sell?: string, droppedBy?: string }} row
 * @param {string} slot
 * @param {{ withStats: boolean, withDropColumn: boolean }} cols
 */
function renderMagicRow(row, slot, cols) {
  const judge = displayMagicJudge(row);
  let cells = `<tr><td>${escapeHtml(slot)}</td><td>${escapeHtml(row.item)}</td><td>${escapeHtml(row.plus)}</td><td>${escapeHtml(row.effects)}</td><td>${escapeHtml(judge)}</td>`;
  if (cols.withStats) cells += `<td>${escapeHtml(row.sell ?? "")}</td>`;
  if (cols.withDropColumn) cells += `<td>${escapeHtml(row.droppedBy ?? "")}</td>`;
  return `${cells}</tr>\n`;
}

/**
 * @param {object | null} knowledge
 * @param {object | null} values
 * @param {Record<string, { name?: string }>} npcs
 * @param {string} name
 */
export function enrichRow(name, knowledge, values, npcs) {
  const key = itemKey(name);
  /** @type {{ judge?: string, sell?: string, droppedBy?: string }} */
  const extra = {};
  const kItem = knowledge?.items?.[key];
  const iv = values?.items?.[key];

  const judge = formatJudge(kItem?.judge);
  if (judge) extra.judge = judge;
  if (iv) {
    if (iv.worthless) extra.sell = "worthless";
    else if (iv.price != null) {
      extra.sell =
        iv.maxPrice != null && iv.maxPrice > iv.price
          ? `${iv.price}–${iv.maxPrice}`
          : String(iv.price);
    }
  }
  const dropped = droppedByNames(kItem, npcs);
  if (dropped) extra.droppedBy = dropped;
  return extra;
}

/** @param {object | undefined} kItem @param {Record<string, { key?: string, name?: string, seenLoot?: Record<string, string> }>} npcs */
function droppedByNames(kItem, npcs) {
  if (!kItem) return "";
  const by = new Map();
  for (const [nk, count] of Object.entries(kItem.droppedBy ?? {})) {
    if (/bey[- ]?sandrax/i.test(nk)) continue;
    const raw = npcs[nk]?.name || titleCaseNpc(nk);
    if (!raw) continue;
    const label = count > 1 ? `${formatDropNpcLabel(raw)}×${count}` : formatDropNpcLabel(raw);
    by.set(nk, label);
  }
  const itemKey = kItem.key;
  if (itemKey) {
    for (const n of Object.values(npcs)) {
      if (!n?.key || /bey[- ]?sandrax/i.test(n.key) || by.has(n.key) || !n.seenLoot?.[itemKey]) continue;
      by.set(n.key, formatDropNpcLabel(n.name || titleCaseNpc(n.key)));
    }
  }
  return mergeDroppedByColumns([...by.values()].join(", "), "");
}

/** @param {string} nk */
function titleCaseNpc(nk) {
  return nk.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** @param {object | null} knowledge */
function buildChanceMap(knowledge) {
  /** @type {Map<string, { npc: string, pct: number }[]>} */
  const map = new Map();
  for (const entry of knowledge?.chanceDrops ?? []) {
    const key = itemKey(entry.item);
    const kills = entry.kills || 0;
    const dropped = entry.dropped || 0;
    if (!kills) continue;
    const pct = Math.round((100 * dropped) / kills);
    const list = map.get(key) ?? [];
    list.push({ npc: titleCaseNpc(entry.npc), pct });
    map.set(key, list);
  }
  return map;
}

/** @param {string} key @param {object | null} knowledge @param {object | null} values */
function hasStatEvidence(key, knowledge, values, chanceByKey) {
  const kItem = knowledge?.items?.[key];
  const iv = values?.items?.[key];
  if (kItem?.judge || (kItem?.droppedBy && Object.keys(kItem.droppedBy).length)) return true;
  if (iv && (iv.price != null || iv.sales > 0)) return true;
  if (chanceByKey.has(key)) return true;
  return false;
}

/** @param {object | undefined} kItem */
function normalTargetSection(kItem) {
  const kind = kItem?.judge?.kind;
  if (kind === "weapon") return "slash";
  if (kind === "armor") return "armors";
  return "misc";
}

/**
 * @param {typeof NORMAL_SECTIONS} sections
 * @param {Set<string>} handKeysOnPage
 * @param {"normal" | "magic"} page
 */
function appendStatRows(sections, page, knowledge, values, chanceByKey, npcs, allHandKeys) {
  const appendedInSection = new Set();
  const allKeys = new Set([
    ...Object.keys(knowledge?.items ?? {}),
    ...Object.keys(values?.items ?? {}),
  ]);

  for (const key of allKeys) {
    if (!hasStatEvidence(key, knowledge, values, chanceByKey)) continue;
    if (allHandKeys.has(key)) continue;

    const iv = values?.items?.[key];
    const kItem = knowledge?.items?.[key];
    const routeMagic = iv?.magic === true;
    if (page === "normal" && routeMagic) continue;
    if (page === "magic" && !routeMagic) continue;

    const sectionId = page === "magic" ? "mi" : normalTargetSection(kItem);
    const dedupe = `${sectionId}:${key}`;
    if (appendedInSection.has(dedupe)) continue;
    appendedInSection.add(dedupe);

    let section = sections.find((s) => s.id === sectionId);
    if (!section) {
      section = {
        id: sectionId,
        title: page === "magic" ? "Misc (MI)" : "Misc",
        rows: [],
      };
      sections.push(section);
    }

    const name = kItem?.name || iv?.name || key;
    const extra = enrichRow(name, knowledge, values, npcs);
    const row =
      page === "magic"
        ? { item: name, plus: "", effects: "", ...extra }
        : { item: name, quality: "", where: "", ...extra };
    section.rows.push(row);
  }
}

/** @param {typeof MAGIC_SECTIONS} magicSections */
function magicItemKeys(magicSections) {
  const keys = new Set();
  for (const sec of magicSections) {
    for (const row of sec.rows) keys.add(itemKey(row.item));
  }
  return keys;
}

/**
 * @param {typeof MAGIC_SECTIONS} magicSections
 * @param {Map<string, { displayName: string, npcs: string[] }>} witnessMap
 */
function applyWitnessDropsToMagicSections(magicSections, witnessMap) {
  if (!witnessMap.size) return;
  for (const sec of magicSections) {
    for (const row of sec.rows) {
      const witness = witnessDroppedBy(witnessMap, itemKey(row.item));
      if (witness) row.droppedBy = mergeDroppedByColumns(row.droppedBy, witness);
    }
  }
}

/**
 * @param {typeof MAGIC_SECTIONS} magicSections
 * @param {Map<string, { displayName: string, npcs: string[] }>} witnessMap
 * @param {Set<string>} keysOnPage
 */
function appendWitnessDropRows(magicSections, witnessMap, keysOnPage) {
  if (!witnessMap.size) return;
  let section = magicSections.find((s) => s.id === "mi");
  if (!section) {
    section = { id: "mi", title: "Misc (MI)", rows: [] };
    magicSections.push(section);
  }
  const pending = [...witnessMap.entries()]
    .filter(([key]) => !keysOnPage.has(key))
    .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName));
  for (const [key, entry] of pending) {
    keysOnPage.add(key);
    section.rows.push({
      item: entry.displayName,
      plus: "",
      effects: "",
      droppedBy: witnessDroppedBy(witnessMap, key),
    });
  }
}

/**
 * @param {typeof NORMAL_SECTIONS} normalHand
 * @param {typeof MAGIC_SECTIONS} magicHand
 * @param {object | null} knowledge
 * @param {object | null} values
 * @param {Map<string, { displayName: string, npcs: string[] }>} [witnessDrops]
 */
export function buildPages(normalHand, magicHand, knowledge, values, witnessDrops = new Map()) {
  const withStats = !!(knowledge && values);
  const npcs = knowledge?.npcs ?? {};
  const chanceByKey = knowledge ? buildChanceMap(knowledge) : new Map();

  const normalSections = structuredClone(normalHand);
  const magicSections = structuredClone(magicHand);

  const handNormalKeys = new Set();
  for (const sec of normalSections) {
    for (const row of sec.rows) {
      handNormalKeys.add(itemKey(row.item));
    }
  }
  const handMagicKeys = new Set();
  for (const sec of magicSections) {
    for (const row of sec.rows) {
      handMagicKeys.add(itemKey(row.item));
    }
  }

  if (withStats) {
    for (const sec of normalSections) {
      for (const row of sec.rows) {
        Object.assign(row, enrichRow(row.item, knowledge, values, npcs));
      }
    }
    for (const sec of magicSections) {
      for (const row of sec.rows) {
        Object.assign(row, enrichRow(row.item, knowledge, values, npcs));
      }
    }

    const allHandKeys = new Set([...handNormalKeys, ...handMagicKeys]);
    appendStatRows(normalSections, "normal", knowledge, values, chanceByKey, npcs, allHandKeys);
    appendStatRows(magicSections, "magic", knowledge, values, chanceByKey, npcs, allHandKeys);
  }

  const keysOnMagicPage = magicItemKeys(magicSections);
  appendWitnessDropRows(magicSections, witnessDrops, keysOnMagicPage);
  applyWitnessDropsToMagicSections(magicSections, witnessDrops);

  const withDropColumn = withStats || witnessDrops.size > 0;
  const magicCols = { withStats, withDropColumn };

  let statsUpdated = "";
  if (knowledge?.updatedAt || values?.updatedAt) {
    const dates = [knowledge?.updatedAt, values?.updatedAt].filter(Boolean).sort();
    statsUpdated = dates[dates.length - 1] ?? "";
  }

  const normalHead = withStats
    ? "<thead><tr><th>Item</th><th>Judge</th><th>Where</th><th>Sell</th><th>Dropped by</th></tr></thead>"
    : "<thead><tr><th>Item</th><th>Judge</th><th>Where</th></tr></thead>";

  const magicHead = withStats
    ? "<thead><tr><th>Slot</th><th>Name</th><th>Plus</th><th>Effects</th><th>Judge</th><th>Sell</th><th>Dropped by</th></tr></thead>"
    : withDropColumn
      ? "<thead><tr><th>Slot</th><th>Name</th><th>Plus</th><th>Effects</th><th>Judge</th><th>Dropped by</th></tr></thead>"
      : "<thead><tr><th>Slot</th><th>Name</th><th>Plus</th><th>Effects</th><th>Judge</th></tr></thead>";

  let normalBody = `<h2>Normal equipment</h2>
      <p class="wiki-lede">Mundane weapons and armor, with judge verdicts and where each one was seen. The original list was unfinished. Areas it names: Threshold, Cerene, Kobold Village, Kal-Thax, Sheep Ledge, Dwarven Mines, Lowhill, Cutland's Pass, Mining Tunnel, Orc Camp, Deep Forest, Threshold Swamps, Cannibal Village, Reptiloid Village, Nymph Forest, Bandit Camp, Goblin Tunnels, Dulaj Road, Fire Grotto, Elinost (outside the gate), Zeraf Pit.${
        withStats
          ? " Sell and drop-source columns refresh when hub stats are copied into <code>data/stats/</code> and the site is rebuilt."
          : ""
      }</p>\n`;

  for (const sec of normalSections) {
    if (!sec.rows.length) continue;
    normalBody += `      <h3 id="${escapeHtml(sec.id)}">${escapeHtml(sec.title)}</h3>\n      <table>\n        ${normalHead}\n        <tbody>\n`;
    for (const row of sec.rows) {
      normalBody += renderNormalRow(row, withStats);
    }
    normalBody += `        </tbody>\n      </table>\n\n`;
  }

  const magicCount = magicSections.reduce((n, s) => n + s.rows.length, 0);
  let magicBody = `<h2>Magic items</h2>
      <p class="wiki-lede">A player catalog of magic items that were in the game when the list was kept. ${magicCount} entries in one table; slot codes are the list's own abbreviations. If an item is missing, that only means it was not on this list. The <strong>Dropped by</strong> column merges hub kill data with witnessed drops from <a href="/wiki/npcs/drops.html">Magical drops</a>.${
        withStats
          ? " Judge and sell refresh when hub stats are copied into <code>data/stats/</code> and the site is rebuilt."
          : ""
      }</p>
      <p>Plus is magical power. See <a href="/wiki/items/index.html">how plus adds up</a>.</p>\n\n`;

  magicBody += `      <table>\n        ${magicHead}\n        <tbody>\n`;
  for (const sec of magicSections) {
    for (const row of sec.rows) {
      magicBody += renderMagicRow(row, sec.title, magicCols);
    }
  }
  magicBody += `        </tbody>\n      </table>\n\n`;

  const normalHtml = wikiShell(
    "Normal equipment",
    "Mundane Powermud gear, quality, and where it was seen.",
    normalBody,
    withStats ? statsUpdated : "",
    '<a href="/wiki/items/index.html">Items</a>',
  );
  const magicHtml = wikiShell(
    "Magic items",
    "Player catalog of Powermud magic items with slot, plus, and effects.",
    magicBody,
    withStats ? statsUpdated : "",
    '<a href="/wiki/items/index.html">Items</a>',
  );

  return { normalHtml, magicHtml, withStats, statsUpdated };
}

/** @param {string | null | undefined} text */
async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const knowledge = await readJsonIfExists(path.join(STATS_DIR, "world-knowledge.json"));
  const values = await readJsonIfExists(path.join(STATS_DIR, "item-values.json"));
  if (!knowledge || !values) {
    console.warn(
      "build-wiki-items: missing data/stats/world-knowledge.json or item-values.json — writing hand-curated pages only",
    );
  }

  let witnessDrops = new Map();
  try {
    const dropsHtml = await readFile(WITNESS_DROPS_HTML, "utf8");
    witnessDrops = parseMagicalDropsHtml(dropsHtml);
  } catch {
    console.warn(
      `build-wiki-items: missing ${path.relative(ROOT, WITNESS_DROPS_HTML)} — magical drops not merged`,
    );
  }

  const { normalHtml, magicHtml, withStats } = buildPages(
    NORMAL_SECTIONS,
    MAGIC_SECTIONS,
    knowledge,
    values,
    witnessDrops,
  );

  await writeFile(path.join(ITEMS_DIR, "normal-equipment.html"), normalHtml, "utf8");
  await writeFile(path.join(ITEMS_DIR, "magic-items.html"), magicHtml, "utf8");
  console.log(
    `equipment wiki: wrote normal + magic (${withStats ? "with" : "without"} hub stats) → ${path.relative(process.cwd(), ITEMS_DIR)}`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
