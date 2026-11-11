const SKIN_LS = "playpowermud-skin";

/** Single source for wiki sidebar navigation. */
const WIKI_CLIENT_SECTION = {
  title: "Browser client",
  links: [
    ["Getting started", "/wiki/client/getting-started.html"],
    ["Terminal & colors", "/wiki/client/terminal.html"],
    ["Colors (eset)", "/wiki/reference/help/eset.html"],
    ["Aliases", "/wiki/client/aliases.html"],
    ["Comms", "/wiki/client/comms.html"],
    ["World map", "/wiki/client/map.html"],
    ["Map data", "/wiki/reference/explored-world.html"],
    ["Site data", "/wiki/reference/data-caches.html"],
  ],
};

const WIKI_NAV_SECTIONS = [
  WIKI_CLIENT_SECTION,
  {
    title: "Getting started",
    links: [["Beginner's guide", "/wiki/guide/beginners-guide.html"]],
  },
  {
    title: "World",
    links: [
      ["Walking directions", "/wiki/world/directions.html"],
      ["Underdark directions", "/wiki/world/underdark.html"],
    ],
  },
  {
    title: "Guilds",
    links: [
      ["All guilds", "/wiki/guilds/index.html"],
      ["Races", "/wiki/guilds/races.html"],
      ["Drow", "/wiki/guilds/drow.html"],
    ],
  },
  {
    title: "Equipment",
    links: [
      ["Items overview", "/wiki/items/index.html"],
      ["Normal equipment", "/wiki/items/normal-equipment.html"],
      ["Magic items", "/wiki/items/magic-items.html"],
      ["Crafting components", "/wiki/items/components.html"],
    ],
  },
  {
    title: "NPCs & drops",
    links: [["Magical drops", "/wiki/npcs/drops.html"]],
  },
  {
    title: "Quests",
    links: [
      ["Quest system", "/wiki/quests/index.html"],
      ["Quest notes", "/wiki/quests/notes.html"],
    ],
  },
  {
    title: "Mechanics",
    links: [
      ["Combat", "/wiki/mechanics/combat.html"],
      ["Stats & ranks", "/wiki/mechanics/stats.html"],
      ["Professions", "/wiki/mechanics/professions.html"],
      ["Skill trainers", "/wiki/mechanics/skill-trainers.html"],
      ["Profession trainers", "/wiki/mechanics/profession-trainers.html"],
      ["Doctor & herbs", "/wiki/mechanics/doctor.html"],
      ["PK areas", "/wiki/mechanics/pk-areas.html"],
    ],
  },
];

/** @type {Map<string, string>} */
const WIKI_NAV_PREFIX_SECTION = new Map([
  ["/wiki/client", "Browser client"],
  ["/wiki/guide", "Getting started"],
  ["/wiki/world", "World"],
  ["/wiki/guilds", "Guilds"],
  ["/wiki/items", "Equipment"],
  ["/wiki/npcs", "NPCs & drops"],
  ["/wiki/quests", "Quests"],
  ["/wiki/mechanics", "Mechanics"],
]);

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

function wikiPathKey(url) {
  return url.replace(/\/index\.html$/i, "").replace(/\.html$/i, "").replace(/\/$/, "") || "/";
}

/** @type {Map<string, string>} */
const WIKI_NAV_SECTION_BY_HREF = new Map();
for (const section of WIKI_NAV_SECTIONS) {
  for (const [, href] of section.links) {
    WIKI_NAV_SECTION_BY_HREF.set(wikiPathKey(href), section.title);
  }
}

function wikiNavSectionTitleForPath(here) {
  const direct = WIKI_NAV_SECTION_BY_HREF.get(here);
  if (direct) return direct;
  for (const [prefix, title] of WIKI_NAV_PREFIX_SECTION) {
    if (here === prefix || here.startsWith(`${prefix}/`)) return title;
  }
  return "";
}

function wikiSectionForUrl(url) {
  return wikiNavSectionTitleForPath(wikiPathKey(url));
}

function renderWikiNav() {
  const mount = document.getElementById("wiki-nav-root");
  if (!mount) return;

  const here = wikiPathKey(window.location.pathname);
  const activeSection = wikiNavSectionTitleForPath(here);
  const onHome = here === "/wiki" || here === "/wiki/index";

  const aside = document.createElement("aside");
  aside.className = "wiki-sidebar";
  aside.id = "wiki-sidebar";

  const shell = document.createElement("details");
  shell.className = "wiki-nav-shell";
  shell.open = true;

  const shellSummary = document.createElement("summary");
  shellSummary.textContent = "Navigation";
  shell.append(shellSummary);

  const nav = document.createElement("nav");
  nav.className = "wiki-nav";
  nav.setAttribute("aria-label", "Wiki sections");

  const homeP = document.createElement("p");
  homeP.className = "wiki-nav-home";
  const homeA = document.createElement("a");
  homeA.href = "/wiki/";
  homeA.textContent = "Main page";
  if (onHome) homeA.setAttribute("aria-current", "page");
  homeP.append(homeA);
  nav.append(homeP);

  for (const section of WIKI_NAV_SECTIONS) {
    const group = document.createElement("details");
    group.className = "wiki-nav-group";
    if (onHome || section.title === activeSection) group.open = true;

    const summary = document.createElement("summary");
    summary.textContent = section.title;
    group.append(summary);

    const ul = document.createElement("ul");
    for (const [label, href] of section.links) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      li.append(a);
      ul.append(li);
    }
    group.append(ul);
    nav.append(group);
  }

  shell.append(nav);
  aside.append(shell);
  mount.replaceWith(aside);
}

renderWikiNav();

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
  const here = wikiPathKey(window.location.pathname);
  for (const a of document.querySelectorAll(".wiki-nav a[href]")) {
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/")) continue;
    const link = wikiPathKey(new URL(href, window.location.origin).pathname);
    const match =
      here === link ||
      (here === "/wiki/reference" && link === "/wiki/reference") ||
      (here === "/wiki" && link === "/wiki");
    if (match) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
})();

(function mountWikiBreadcrumb() {
  const here = wikiPathKey(window.location.pathname);
  if (here === "/wiki" || here === "/wiki/index") return;
  const main = document.getElementById("wiki-main");
  if (!main) return;

  const section = wikiNavSectionTitleForPath(here);
  const pageTitle = document.title.replace(/\s*—\s*Play Powermud wiki\s*$/i, "").trim();

  const nav = document.createElement("nav");
  nav.className = "wiki-breadcrumb";
  nav.setAttribute("aria-label", "Breadcrumb");

  const ol = document.createElement("ol");
  const addCrumb = (label, href) => {
    const li = document.createElement("li");
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = label;
      li.append(a);
    } else {
      li.textContent = label;
      li.setAttribute("aria-current", "page");
    }
    ol.append(li);
  };

  addCrumb("Main page", "/wiki/");
  if (section) {
    const sectionLink = WIKI_NAV_SECTIONS.find((s) => s.title === section)?.links[0]?.[1];
    const onSectionHub = sectionLink && wikiPathKey(sectionLink) === here;
    if (onSectionHub) addCrumb(section, null);
    else {
      if (sectionLink) addCrumb(section, sectionLink);
      else addCrumb(section, null);
      if (pageTitle && pageTitle !== section) addCrumb(pageTitle, null);
    }
  } else if (pageTitle) {
    addCrumb(pageTitle, null);
  }

  nav.append(ol);
  main.insertBefore(nav, main.firstChild);
})();

(function mountWikiRouteBlocks() {
  const main = document.getElementById("wiki-main");
  if (!main || !document.body.classList.contains("wiki-directions")) return;

  /** @param {string} raw */
  function normalizeRouteText(raw) {
    return raw
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("")
      .trim();
  }

  for (const pre of main.querySelectorAll("pre:has(code)")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const normalized = normalizeRouteText(code.textContent ?? "");
    if (!normalized) continue;

    const heading = pre.previousElementSibling;
    let label = "Route steps";
    if (heading?.matches("h3[id]")) label = heading.textContent?.trim() || label;

    const wrap = document.createElement("div");
    wrap.className = "wiki-route";

    const head = document.createElement("div");
    head.className = "wiki-route-head";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "wiki-route-copy";
    copyBtn.textContent = "Copy";

    const hint = document.createElement("span");
    hint.className = "wiki-route-hint";
    hint.textContent = "One line — paste into the game or an alias";

    head.append(copyBtn, hint);

    const ta = document.createElement("textarea");
    ta.className = "wiki-route-input";
    ta.readOnly = true;
    ta.spellcheck = false;
    ta.rows = Math.min(6, Math.max(2, Math.ceil(normalized.length / 88)));
    ta.value = normalized;
    ta.setAttribute("aria-label", label);

    const flashCopied = () => {
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("is-done");
      window.setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("is-done");
      }, 1600);
    };

    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(normalized);
        flashCopied();
      } catch {
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy");
          flashCopied();
        } catch {
          copyBtn.textContent = "Select text";
        }
      }
    });

    ta.addEventListener("click", () => ta.select());

    wrap.append(head, ta);
    pre.replaceWith(wrap);
  }

  for (const h3 of main.querySelectorAll("h3[id]")) {
    h3.classList.add("wiki-route-title");
    const tags = [];
    let el = h3.nextElementSibling;
    while (el && !el.matches("pre, .wiki-route, .wiki-callout, h2, h3")) {
      if (el.matches("p") && /^\([^)]+\)$/.test(el.textContent?.trim() ?? "")) {
        tags.push(el);
      }
      el = el.nextElementSibling;
    }
    if (tags.length) {
      const row = document.createElement("div");
      row.className = "wiki-route-tags";
      for (const p of tags) {
        const span = document.createElement("span");
        span.className = "wiki-route-tag";
        span.textContent = p.textContent?.trim() ?? "";
        row.append(span);
        p.remove();
      }
      h3.insertAdjacentElement("afterend", row);
    }
  }
})();
