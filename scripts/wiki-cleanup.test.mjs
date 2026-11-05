import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const wiki = path.join(root, "public/wiki");

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(full));
    else if (ent.name.endsWith(".html") || ent.name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("wiki copy is not tied to the Link client or to files the wiki does not contain", async () => {
  const banned = [
    /link prof/i,
    /Link profession/,
    /link\.cfg/i,
    /Hemligt/,
    /\bcorpus\b/i,
    /docs\/powermud/,
    /official item list/i,
    /quests\.txt/,
    /doctor\.txt/,
    /psionicsquest/,
  ];
  const hits = [];
  for (const file of await walk(wiki)) {
    const text = await readFile(file, "utf8");
    for (const re of banned) {
      if (re.test(text)) hits.push(`${path.relative(root, file)} matches ${re}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("sidebar sections are even-handed and in reading order", async () => {
  const nav = await readFile(path.join(wiki, "wiki.js"), "utf8");
  const titles = [...nav.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(titles.slice(0, 8), [
    "Browser client",
    "Getting started",
    "World",
    "Guilds",
    "Equipment",
    "NPCs & drops",
    "Quests",
    "Mechanics",
  ]);
  assert.equal(nav.includes("Battlemages"), false);
  assert.match(nav, /\/wiki\/reference\/data-caches\.html/);
  assert.match(nav, /\/wiki\/reference\/help\/eset\.html/);
  assert.match(nav, /\/wiki\/reference\/explored-world\.html/);
});

test("old wiki URLs redirect at the new pages", async () => {
  const cases = [
    ["public/wiki/reference/beginners-guide.html", "/wiki/guide/beginners-guide"],
    ["public/wiki/reference/help/battlemage.html", "/wiki/guilds/celtian-battlemages"],
    ["public/wiki/quests/bastion.html", "/wiki/guilds/bastion"],
    ["public/wiki/reference/professions.html", "/wiki/mechanics/professions"],
    ["public/wiki/reference/content-notes.html", "/wiki/about"],
    ["public/wiki/reference/quests-corpus.html", "/wiki/quests/notes"],
    ["public/wiki/powermud/zones.html", "/wiki/world/areas#zones"],
  ];
  for (const [rel, url] of cases) {
    const html = await readFile(path.join(root, rel), "utf8");
    assert.match(html, new RegExp(`url=${url.replaceAll("/", "\\/")}`));
  }
});

test("underdark directions keep the routes that share a line with the banner", async () => {
  const page = await readFile(path.join(wiki, "world/underdark.html"), "utf8");
  const blocks = [...page.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 15);
  assert.ok(blocks.some((b) => b.includes("*climb hatch*(supply room)")));
  assert.ok(blocks.some((b) => b.includes("2swim s")));
  assert.ok(blocks.some((b) => b.includes("n, sw,s,se,sw")));
  assert.match(page, /Nal Shaddar to Rothe Island/);
  assert.match(page, /<p>\(very newbie safe\)<\/p>/);
  assert.equal(page.includes("(very newbie safe)\n(arena)"), false);
});

test("crafting components keep wrapped names", async () => {
  const page = await readFile(path.join(wiki, "items/components.html"), "utf8");
  assert.match(page, /Silk of the Spider Parasite/);
  assert.match(page, /Mithril Encrusted Onyx Gemstone/);
});

test("guild pages do not single out a best guild", async () => {
  const guilds = await readFile(path.join(wiki, "guilds/index.html"), "utf8");
  const guide = await readFile(path.join(wiki, "guide/beginners-guide.html"), "utf8");
  const races = await readFile(path.join(wiki, "guilds/races.html"), "utf8");
  for (const page of [guilds, guide, races]) {
    assert.equal(page.includes("safest pick"), false);
    assert.equal(page.includes("Want to hit"), false);
    assert.equal(page.includes("Battlemage-eligible"), false);
    assert.equal(page.includes("easy first guild"), false);
    assert.equal(page.includes("strongest general"), false);
  }
  assert.match(guilds, /id="battlemages"/);
  assert.match(guilds, /id="race-guild"/);
  assert.match(guilds, /href="\/wiki\/guilds\/threshold-militia"/);
});

test("each guild help topic has a wiki route", async () => {
  const { GUILD_SECTIONS } = await import("./guild-data.mjs");
  for (const section of GUILD_SECTIONS) {
    for (const guild of section.guilds) {
      const html = await readFile(path.join(wiki, "reference/help", `${guild.help}.html`), "utf8");
      const target = guild.page?.replace(/\.html$/i, "") ?? guild.slug;
      assert.match(html, new RegExp(`url=/wiki/guilds/${target.replaceAll("-", "\\-")}`));
    }
  }
});

test("vercel serves extensionless wiki URLs", async () => {
  const vercel = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
  assert.equal(vercel.cleanUrls, true);
  const dests = new Set(vercel.rewrites.map((r) => r.destination));
  assert.ok(dests.has("/wiki/guilds/index.html"));
  assert.ok(dests.has("/wiki/items/index.html"));
});

test("each joinable guild has a dedicated page", async () => {
  const { GUILD_SECTIONS } = await import("./guild-data.mjs");
  const { readdir } = await import("node:fs/promises");
  const names = new Set(await readdir(path.join(wiki, "guilds")));
  for (const section of GUILD_SECTIONS) {
    for (const guild of section.guilds) {
      const file = guild.page ?? `${guild.slug}.html`;
      assert.ok(names.has(file), `missing guild page ${file}`);
    }
  }
});
