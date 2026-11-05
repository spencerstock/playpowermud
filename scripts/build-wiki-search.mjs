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

/** Canonical extensionless wiki URL for a file under public/wiki/. */
export function wikiUrlFromPath(relPath) {
  const posix = relPath.split(path.sep).join("/");
  if (posix === "index.html") return "/wiki/";
  if (posix.endsWith("/index.html")) return `/wiki/${posix.slice(0, -"/index.html".length)}`;
  if (posix.endsWith(".html")) return `/wiki/${posix.slice(0, -".html".length)}`;
  return `/wiki/${posix}`;
}

/** Extensionless public URL for wiki paths (hash and query preserved). */
export function normalizeWikiPublicUrl(url) {
  const u = new URL(url, "https://local");
  if (!u.pathname.startsWith("/wiki")) return url;
  let p = u.pathname;
  if (p.endsWith("/index.html")) p = p.slice(0, -"/index.html".length) || "/wiki";
  else if (p.endsWith(".html")) p = p.slice(0, -".html".length);
  if (p === "/wiki/index") p = "/wiki";
  return `${p}${u.search}${u.hash}`;
}

/** @param {string} html */
export function normalizeWikiRedirectHtml(html) {
  return html
    .replace(/(\burl=)(\/wiki[^"'\s>]+)/gi, (_, prefix, target) => `${prefix}${normalizeWikiPublicUrl(target)}`)
    .replace(/(\bhref=")(\/wiki[^"]+)(")/gi, (_, pre, target, post) => `${pre}${normalizeWikiPublicUrl(target)}${post}`);
}

/**
 * Drop spoiler bodies so search results never reveal them; keep the summary line.
 * @param {string} fragment
 */
export function stripSpoilers(fragment) {
  return fragment.replace(
    /<details\b[^>]*\bclass=["'][^"']*\bwiki-spoiler\b[^"']*["'][^>]*>\s*(<summary[^>]*>[\s\S]*?<\/summary>)?[\s\S]*?<\/details>/gi,
    (_, summary) => ` ${summary ?? ""} `,
  );
}

/** @param {string} html @param {string} url */
export function indexEntryFromHtml(html, url) {
  const main = stripSpoilers(mainInnerHtml(html));
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
  let redirects = 0;
  for (const file of files) {
    const html = await readFile(file, "utf8");
    if (!isRedirectPage(html)) continue;
    const next = normalizeWikiRedirectHtml(html);
    if (next !== html) {
      await writeFile(file, next, "utf8");
      redirects += 1;
    }
  }
  if (redirects) console.log(`wiki redirects: normalized ${redirects} stub URLs`);

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
