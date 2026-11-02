/**
 * Build a client-side search index from static wiki HTML under public/wiki/.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIKI_ROOT = path.join(__dirname, "..", "public", "wiki");
const OUT = path.join(WIKI_ROOT, "wiki-search-index.json");

/** @param {string} html */
export function isRedirectPage(html) {
  return /http-equiv\s*=\s*["']refresh["']/i.test(html);
}

/** @param {string} html */
export function wikiPageTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "Wiki page";
  return m[1]
    .replace(/\s*[—–-]\s*Play Powermud wiki\s*$/i, "")
    .replace(/\s*$/g, "")
    .trim();
}

/** @param {string} html */
function mainInnerHtml(html) {
  const m = html.match(/<main[^>]*\bid=["']wiki-main["'][^>]*>([\s\S]*?)<\/main>/i);
  return m?.[1] ?? "";
}

/** @param {string} fragment */
export function stripHtml(fragment) {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} fragment */
export function extractHeadings(fragment) {
  const headings = [];
  for (const m of fragment.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const t = stripHtml(m[1]);
    if (t) headings.push(t);
  }
  return headings;
}

/** @param {string} relPath e.g. client/foo.html */
export function wikiUrlFromPath(relPath) {
  const posix = relPath.split(path.sep).join("/");
  return `/wiki/${posix}`;
}

/** @param {string} html @param {string} url */
export function indexEntryFromHtml(html, url) {
  const main = mainInnerHtml(html);
  const headings = extractHeadings(main);
  const text = stripHtml(main).slice(0, 12000);
  return {
    url,
    title: wikiPageTitle(html),
    headings,
    text,
  };
}

async function walkHtml(dir, base = dir) {
  /** @type {string[]} */
  const files = [];
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) files.push(...(await walkHtml(full, base)));
    else if (name.isFile() && name.name.endsWith(".html")) files.push(full);
  }
  return files;
}

async function main() {
  const files = await walkHtml(WIKI_ROOT);
  /** @type {ReturnType<typeof indexEntryFromHtml>[]} */
  const entries = [];

  for (const file of files.sort()) {
    const html = await readFile(file, "utf8");
    if (isRedirectPage(html)) continue;
    const rel = path.relative(WIKI_ROOT, file);
    entries.push(indexEntryFromHtml(html, wikiUrlFromPath(rel)));
  }

  entries.sort((a, b) => a.title.localeCompare(b.title, "en"));
  await writeFile(OUT, `${JSON.stringify(entries)}\n`, "utf8");
  console.log(`wiki search: ${entries.length} pages → ${path.relative(process.cwd(), OUT)}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
