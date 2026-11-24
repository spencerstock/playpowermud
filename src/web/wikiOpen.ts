/** Extensionless wiki URL (matches Vercel cleanUrls and local dev resolution). */
export function normalizeWikiPath(path: string): string {
  const url = new URL(path, window.location.origin);
  if (!url.pathname.startsWith("/wiki")) return "/wiki/";
  let p = url.pathname;
  if (p.endsWith("/index.html")) p = p.slice(0, -"/index.html".length) || "/wiki";
  else if (p.endsWith(".html")) p = p.slice(0, -".html".length);
  if (p === "/wiki/index") p = "/wiki";
  return `${p}${url.search}${url.hash}`;
}

const DEFAULT_WIKI_PATH = "/wiki/";

/** Open the static wiki in a new browser tab so each page has its own URL. */
export function openWikiInNewTab(path = DEFAULT_WIKI_PATH): Window | null {
  const url = normalizeWikiPath(path);
  return window.open(url, "_blank", "noopener,noreferrer");
}

export { DEFAULT_WIKI_PATH };