const SKIN_LS = "playpowermud-skin";

/** Single source for wiki sidebar navigation. */
const WIKI_NAV_SECTIONS = [
  {
    title: "Using the client",
    links: [
      ["Getting started", "/wiki/client/getting-started.html"],
      ["Terminal & colors", "/wiki/client/terminal.html"],
      ["Aliases", "/wiki/client/aliases.html"],
      ["Comms", "/wiki/client/comms.html"],
      ["World map", "/wiki/client/map.html"],
    ],
  },
  {
    title: "World",
    links: [
      ["World overview", "/wiki/reference/world-and-directions.html"],
      ["Explored map data", "/wiki/reference/explored-world.html"],
    ],
  },
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
      ["Herbs & doctor", "/wiki/reference/help/herbs-doctor.html"],
      ["Player guides", "/wiki/reference/guides.html"],
    ],
  },
  {
    title: "Spells & help",
    links: [
      ["Help topic index", "/wiki/reference/spells.html"],
      ["Colors (eset)", "/wiki/reference/help/eset.html"],
    ],
  },
  {
    title: "About this wiki",
    links: [
      ["Game wiki home", "/wiki/reference/"],
      ["Spoilers & sources", "/wiki/reference/content-notes.html"],
      ["Behind the scenes data", "/wiki/reference/data-caches.html"],
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
