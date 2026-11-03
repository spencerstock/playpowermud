const SKIN_LS = "playpowermud-skin";

/** Single source for wiki sidebar navigation. */
const WIKI_CLIENT_SECTION = {
  title: "Using the client",
  links: [
    ["Getting started", "/wiki/client/getting-started.html"],
    ["Terminal & colors", "/wiki/client/terminal.html"],
    ["Aliases", "/wiki/client/aliases.html"],
    ["Comms", "/wiki/client/comms.html"],
    ["World map", "/wiki/client/map.html"],
  ],
};

const WIKI_NAV_SECTIONS = [
  {
    title: "Characters",
    links: [
      ["Races", "/wiki/reference/help/races.html"],
      ["Stats & builds", "/wiki/reference/characters-and-stats.html"],
      ["Battlemages", "/wiki/reference/help/battlemage.html"],
    ],
  },
  {
    title: "Items & combat",
    links: [
      ["Items & equipment", "/wiki/reference/items-and-equipment.html"],
      ["Combat", "/wiki/reference/combat.html"],
      ["PK areas", "/wiki/reference/help/pk-areas.html"],
    ],
  },
  {
    title: "Quests & crafting",
    links: [
      ["Quest system", "/wiki/reference/help/quests.html"],
      ["Quest notes & clues", "/wiki/reference/quests-corpus.html"],
      ["Player guides", "/wiki/reference/guides.html"],
    ],
  },
  {
    title: "Professions",
    links: [["Doctor", "/wiki/reference/help/herbs-doctor.html"]],
  },
  WIKI_CLIENT_SECTION,
];

function isClientWikiPath() {
  return window.location.pathname.startsWith("/wiki/client/");
}

function applySkin(name) {
  const skin = name === "light" ? "light" : "dark";
  document.documentElement.dataset.skin = skin;
  const btn = document.getElementById("wiki-skin");
  if (btn) btn.textContent = skin === "light" ? "Skin: Light" : "Skin: Dark";
}

applySkin(localStorage.getItem(SKIN_LS) ?? "dark");

document.getElementById("wiki-skin")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.skin === "light" ? "dark" : "light";
  localStorage.setItem(SKIN_LS, next);
  applySkin(next);
});

function renderWikiNav() {
  const mount = document.getElementById("wiki-nav-root");
  if (!mount) return;
  const details = document.createElement("details");
  details.className = "wiki-nav";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Browse wiki";
  details.append(summary);
  const body = document.createElement("div");
  body.className = "wiki-nav-body";
  function appendNavSection(parent, section) {
    const sec = document.createElement("section");
    const h2 = document.createElement("h2");
    h2.textContent = section.title;
    sec.append(h2);
    const ul = document.createElement("ul");
    for (const [label, href] of section.links) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      li.append(a);
      ul.append(li);
    }
    sec.append(ul);
    parent.append(sec);
  }

  for (const section of WIKI_NAV_SECTIONS) {
    if (section === WIKI_CLIENT_SECTION) {
      const clientFold = document.createElement("details");
      clientFold.className = "wiki-nav-client";
      if (isClientWikiPath()) clientFold.open = true;
      const clientSummary = document.createElement("summary");
      clientSummary.textContent = section.title;
      clientFold.append(clientSummary);
      const clientBody = document.createElement("div");
      clientBody.className = "wiki-nav-client-body";
      appendNavSection(clientBody, section);
      clientFold.append(clientBody);
      body.append(clientFold);
      continue;
    }
    appendNavSection(body, section);
  }
  details.append(body);
  mount.replaceWith(details);
}

renderWikiNav();

/** @type {Map<string, string>} */
const WIKI_NAV_SECTION_BY_HREF = new Map();
for (const section of WIKI_NAV_SECTIONS) {
  for (const [, href] of section.links) {
    WIKI_NAV_SECTION_BY_HREF.set(href.replace(/\/$/, ""), section.title);
  }
}

function wikiSectionForUrl(url) {
  const norm = url.replace(/\/index\.html$/i, "").replace(/\/$/, "");
  return WIKI_NAV_SECTION_BY_HREF.get(norm) ?? "";
}

function wikiSearchTerms(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** @param {{ title: string; headings: string[]; text: string }} entry @param {string[]} terms */
function wikiSearchScore(entry, terms) {
  let score = 0;
  const title = entry.title.toLowerCase();
  const text = entry.text.toLowerCase();
  const headings = entry.headings.map((h) => h.toLowerCase());
  for (const term of terms) {
    if (title === term) score += 40;
    else if (title.startsWith(term)) score += 28;
    else if (title.includes(term)) score += 18;
    for (const h of headings) {
      if (h.includes(term)) score += 10;
    }
    if (text.includes(term)) score += 4;
  }
  return score;
}

/** @param {string} text @param {string[]} terms */
function wikiSearchSnippet(text, terms) {
  const lower = text.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return text.slice(0, 120);
  const start = Math.max(0, idx - 48);
  const end = Math.min(text.length, idx + 72);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

/** @type {Promise<{ url: string; title: string; headings: string[]; text: string }[]> | null} */
let wikiSearchIndexPromise = null;

function loadWikiSearchIndex() {
  if (!wikiSearchIndexPromise) {
    wikiSearchIndexPromise = fetch("/wiki/wiki-search-index.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .catch(() => []);
  }
  return wikiSearchIndexPromise;
}

function mountWikiSearch() {
  const top = document.querySelector(".wiki-top");
  if (!top || document.getElementById("wiki-search")) return;

  const wrap = document.createElement("div");
  wrap.className = "wiki-search";
  wrap.id = "wiki-search";

  const label = document.createElement("label");
  label.className = "wiki-search-label";
  label.htmlFor = "wiki-search-input";
  label.textContent = "Search wiki";

  const input = document.createElement("input");
  input.type = "search";
  input.id = "wiki-search-input";
  input.className = "wiki-search-input";
  input.placeholder = "Search topics…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-controls", "wiki-search-results");
  input.setAttribute("aria-expanded", "false");

  const status = document.createElement("div");
  status.className = "wiki-search-status";
  status.id = "wiki-search-status";
  status.hidden = true;

  const results = document.createElement("div");
  results.className = "wiki-search-results";
  results.id = "wiki-search-results";
  results.hidden = true;
  results.setAttribute("role", "listbox");

  wrap.append(label, input, status, results);

  const actions = top.querySelector(".wiki-top-actions");
  if (actions) top.insertBefore(wrap, actions);
  else top.append(wrap);

  /** @type {{ url: string; title: string; section: string; snippet: string; score: number }[]} */
  let hits = [];
  let selected = -1;
  let debounce = 0;

  function closeResults() {
    results.hidden = true;
    status.hidden = true;
    input.setAttribute("aria-expanded", "false");
    selected = -1;
  }

  function renderResults() {
    results.replaceChildren();
    if (!hits.length) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const btn = document.createElement("a");
      btn.className = "wiki-search-hit";
      btn.href = hit.url;
      btn.setAttribute("role", "option");
      if (i === selected) btn.classList.add("is-selected");
      const head = document.createElement("div");
      head.className = "wiki-search-hit-head";
      const titleEl = document.createElement("span");
      titleEl.className = "wiki-search-hit-title";
      titleEl.textContent = hit.title;
      head.append(titleEl);
      if (hit.section) {
        const sec = document.createElement("span");
        sec.className = "wiki-search-hit-section";
        sec.textContent = hit.section;
        head.append(sec);
      }
      const meta = document.createElement("div");
      meta.className = "wiki-search-hit-snippet";
      meta.textContent = hit.snippet;
      btn.append(head, meta);
      results.append(btn);
    }
  }

  async function runSearch() {
    const raw = input.value.trim();
    const terms = wikiSearchTerms(raw);
    if (!terms.length) {
      hits = [];
      status.hidden = true;
      closeResults();
      return;
    }
    const index = await loadWikiSearchIndex();
    if (!index.length) {
      status.textContent = "Search index unavailable — run yarn build:wiki";
      status.hidden = false;
      closeResults();
      return;
    }
    hits = index
      .map((entry) => {
        const score = wikiSearchScore(entry, terms);
        if (score <= 0) return null;
        return {
          url: entry.url,
          title: entry.title,
          section: wikiSectionForUrl(entry.url),
          snippet: wikiSearchSnippet(entry.text, terms),
          score,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "en"))
      .slice(0, 12);
    selected = hits.length ? 0 : -1;
    if (!hits.length) {
      status.textContent = `No results for “${raw}”`;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
    renderResults();
  }

  input.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      void runSearch();
    }, 120);
  });

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      closeResults();
      input.blur();
      return;
    }
    if (!hits.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      selected = Math.min(hits.length - 1, selected + 1);
      renderResults();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      selected = Math.max(0, selected - 1);
      renderResults();
    } else if (ev.key === "Enter" && selected >= 0 && hits[selected]) {
      ev.preventDefault();
      window.location.href = hits[selected].url;
    }
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) void runSearch();
  });

  document.addEventListener("click", (ev) => {
    if (!(ev.target instanceof Node) || !wrap.contains(ev.target)) closeResults();
  });
}

mountWikiSearch();

(function wireWikiEmbedMode() {
  if (window.parent === window) return;
  document.documentElement.classList.add("wiki-embedded");
  const closeParent = () => {
    window.parent.postMessage({ type: "playpowermud-wiki-close" }, window.location.origin);
  };
  for (const a of document.querySelectorAll('a[href="/"]')) {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      closeParent();
    });
  }
  const playTop = document.querySelector(".wiki-top-actions a.primary");
  if (playTop instanceof HTMLAnchorElement && playTop.getAttribute("href") === "/") {
    playTop.textContent = "Back to game";
  }
})();

if (typeof SharedWorker !== "undefined") {
  const keep = document.createElement("script");
  keep.type = "module";
  keep.src = "/build/wiki-relay.js";
  document.head.appendChild(keep);
}

(function highlightWikiNav() {
  const norm = (p) => p.replace(/\/index\.html$/i, "").replace(/\/$/, "") || "/";
  const here = norm(window.location.pathname);
  for (const a of document.querySelectorAll(".wiki-nav a[href]")) {
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/")) continue;
    const link = norm(new URL(href, window.location.origin).pathname);
    const match =
      here === link ||
      (here === "/wiki/reference" && link === "/wiki/reference") ||
      (here === "/wiki" && link === "/wiki");
    if (match) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
})();
