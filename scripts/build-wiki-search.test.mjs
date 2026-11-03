import assert from "node:assert/strict";
import test from "node:test";
import {
  extractHeadings,
  indexEntryFromHtml,
  isRedirectPage,
  stripHtml,
  stripSpoilers,
  wikiPageTitle,
  wikiUrlFromPath,
} from "./build-wiki-search.mjs";

test("isRedirectPage detects meta refresh stubs", () => {
  assert.equal(
    isRedirectPage('<meta http-equiv="refresh" content="0;url=/wiki/client/foo.html" />'),
    true,
  );
  assert.equal(isRedirectPage("<title>Getting started</title><main id=\"wiki-main\">Hi</main>"), false);
});

test("wikiPageTitle strips site suffix", () => {
  const html = "<title>Getting started — Play Powermud wiki</title>";
  assert.equal(wikiPageTitle(html), "Getting started");
});

test("indexEntryFromHtml extracts main text and headings", () => {
  const html = `<!DOCTYPE html><title>Combat — Play Powermud wiki</title>
<main id="wiki-main"><h2>Combat</h2><p>Dragon <strong>breath</strong> hurts.</p></main>`;
  const entry = indexEntryFromHtml(html, "/wiki/reference/combat.html");
  assert.equal(entry.title, "Combat");
  assert.deepEqual(entry.headings, ["Combat"]);
  assert.match(entry.text, /Dragon breath hurts/);
});

test("wikiUrlFromPath", () => {
  assert.equal(wikiUrlFromPath("client/map.html"), "/wiki/client/map.html");
});

test("stripHtml removes tags", () => {
  assert.equal(stripHtml("<p>Hello <code>world</code></p>"), "Hello world");
});

test("extractHeadings collects h2 and h3", () => {
  assert.deepEqual(extractHeadings("<h2>A</h2><h3>B</h3>"), ["A", "B"]);
});

test("stripSpoilers hides spoiler bodies but keeps the summary", () => {
  const out = stripHtml(
    stripSpoilers('<p>Hint</p><details class="wiki-spoiler"><summary>Spoiler: answer</summary><p>pry stone</p></details><p>After</p>'),
  );
  assert.equal(out, "Hint Spoiler: answer After");
});

test("indexEntryFromHtml leaves spoiler text out of the index", () => {
  const html = `<title>Q — Play Powermud wiki</title><main id="wiki-main"><h2>Q</h2>
<details class="wiki-spoiler">
  <summary>Spoiler: route</summary><h3>Secret</h3><p>jump through the mirror</p></details></main>`;
  const entry = indexEntryFromHtml(html, "/wiki/reference/q.html");
  assert.doesNotMatch(entry.text, /jump through/);
  assert.deepEqual(entry.headings, ["Q"]);
  assert.match(entry.text, /Spoiler: route/);
});
