const SKIN_LS = "playpowermud-skin";

/** Single source for wiki navigation (mirrors mudwithme docs/GAME_REFERENCE.md). */
const WIKI_NAV_SECTIONS = [
  {
    title: "Client",
    links: [
      ["Getting started", "/wiki/client/getting-started.html"],
      ["Terminal & colors", "/wiki/client/terminal.html"],
      ["Aliases", "/wiki/client/aliases.html"],
      ["Comms", "/wiki/client/comms.html"],
      ["World map", "/wiki/client/map.html"],
    ],
  },
  {
    title: "Game reference",
    links: [
      ["Overview", "/wiki/reference/"],
      ["Items & equipment", "/wiki/reference/items-and-equipment.html"],
      ["Characters & stats", "/wiki/reference/characters-and-stats.html"],
      ["Combat", "/wiki/reference/combat.html"],
      ["Quests corpus", "/wiki/reference/quests-corpus.html"],
      ["Guides", "/wiki/reference/guides.html"],
      ["World & directions", "/wiki/reference/world-and-directions.html"],
      ["Explored world", "/wiki/reference/explored-world.html"],
      ["Data caches", "/wiki/reference/data-caches.html"],
      ["Spells & help index", "/wiki/reference/spells.html"],
      ["Content notes", "/wiki/reference/content-notes.html"],
    ],
  },
  {
    title: "Help topics",
    links: [
      ["Herbs & doctor", "/wiki/reference/help/herbs-doctor.html"],
      ["Quest system", "/wiki/reference/help/quests.html"],
      ["PK areas", "/wiki/reference/help/pk-areas.html"],
      ["Races", "/wiki/reference/help/races.html"],
      ["Battlemages", "/wiki/reference/help/battlemage.html"],
      ["Eset & ANSI", "/wiki/reference/help/eset.html"],
    ],
  },
];

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
  for (const section of WIKI_NAV_SECTIONS) {
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
    body.append(sec);
  }
  details.append(body);
  mount.replaceWith(details);
}

renderWikiNav();

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
