/**
 * Generate guild overview and per-guild wiki pages from scripts/guild-data.mjs.
 * Bastion keeps a hand-edited page at public/wiki/guilds/bastion.html.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GUILD_SECTIONS, RACE_GUILD_ROWS, guildPageHref } from "./guild-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUILDS_DIR = path.join(__dirname, "..", "public", "wiki", "guilds");

/** @param {string} title @param {string} description */
function wikiShell(title, description, mainHtml) {
  return `<!DOCTYPE html>
<html lang="en" class="wiki-root">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description.replace(/"/g, "&quot;")}" />
    <title>${title} — Play Powermud wiki</title>
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
      <p><a href="/wiki/">Wiki home</a> · <a href="/">Play Powermud</a></p>
    </footer>
    <script src="/wiki/wiki.js"></script>
  </body>
</html>
`;
}

/** @param {import("./guild-data.mjs").Guild & { page?: string }} guild @param {string} category */
function renderGuildPage(guild, category) {
  const href = guildPageHref(guild);
  const desc = `${guild.name}: races, minimum stats, location, and guild notes from in-game help.`;
  let body = `<h2>${guild.name}</h2>
      <p class="wiki-lede">${category} guild in Powermud. Join at 500+ exp (Merchants are the exception). At the recruiter, type <code>info</code> for the joining task. In-game: <code>help ${guild.help}</code>.</p>
      <table>
        <thead><tr><th>Races</th><th>Minimum stats</th><th>Where</th></tr></thead>
        <tbody>
          <tr><td>${guild.races}</td><td>${guild.stats}</td><td>${guild.where}</td></tr>
        </tbody>
      </table>
      <p>${guild.description}</p>`;
  if (guild.closed) {
    body += `\n      <div class="wiki-callout"><strong>Closed guild.</strong> In-game help says new members cannot join.</div>`;
  }
  if (guild.experienced) {
    body += `\n      <div class="wiki-callout">In-game help marks this guild as suited to experienced players.</div>`;
  }
  body += `
      <div class="wiki-see-also">
        <h2>See also</h2>
        <ul>
          <li><a href="/wiki/guilds/index.html">All guilds</a></li>
          <li><a href="/wiki/guilds/races.html">Races</a></li>
          <li><a href="/wiki/guilds/index.html#race-guild">Which race for which guild</a></li>
        </ul>
      </div>`;
  return wikiShell(guild.name, desc, body);
}

function renderIndex() {
  let sections = "";
  for (const section of GUILD_SECTIONS) {
    sections += `<h3>${section.title}</h3>\n<table>\n<thead><tr><th>Guild</th><th>Races</th><th>Minimum stats</th><th>Where</th></tr></thead>\n<tbody>\n`;
    for (const guild of section.guilds) {
      const href = guildPageHref(guild);
      sections += `<tr><td><a href="${href}">${guild.name}</a></td><td>${guild.races}</td><td>${guild.stats}</td><td>${guild.where}</td></tr>\n`;
    }
    sections += `</tbody>\n</table>\n<ul>`;
    for (const guild of section.guilds) {
      const href = guildPageHref(guild);
      const id =
        guild.slug === "celtian-battlemages" ? ' id="battlemages"' : "";
      sections += `<li><strong${id}><a href="${href}">${guild.name}</a></strong> — ${guild.description}</li>`;
    }
    sections += `</ul>\n`;
  }

  let raceRows = "";
  for (const row of RACE_GUILD_ROWS) {
    raceRows += `<tr><td>${row.race}</td><td>${row.guilds}</td></tr>\n`;
  }

  const main = `<p class="wiki-lede">From in-game guild help. Join at 500+ exp (Merchants are the exception). At the recruiter, type <code>info</code> for the joining task. Each guild below has the same fields: races, minimum stats, where, and a short description.</p>
<h2>Guilds</h2>
${sections}
<div class="wiki-callout"><strong>Skills don't always carry over.</strong> Some skills stop working when you join a guild. For example, a mage guild loses Slash, so check <code>help &lt;guild&gt;</code> before you train a weapon type in the arena. Blunt and Pierce carry into almost every guild.</div>

<h3 id="race-guild">Which race for which guild</h3>
<p class="wiki-lede">The joinable-guilds list from <code>help guilds</code>.</p>
<table>
<thead><tr><th>Race</th><th>Guilds it can join</th></tr></thead>
<tbody>
${raceRows}</tbody>
</table>

      <div class="wiki-see-also">
        <h2>See also</h2>
        <ul>
          <li><a href="/wiki/guilds/races.html">Races</a></li>
          <li><a href="/wiki/mechanics/professions.html">Professions</a></li>
        </ul>
      </div>`;

  return wikiShell(
    "Guilds",
    "Powermud guilds: races, minimum stats, and locations.",
    main,
  );
}

async function main() {
  await writeFile(path.join(GUILDS_DIR, "index.html"), renderIndex(), "utf8");

  let count = 1;
  for (const section of GUILD_SECTIONS) {
    for (const guild of section.guilds) {
      if (guild.slug === "bastion") continue;
      const file = `${guild.slug}.html`;
      await writeFile(path.join(GUILDS_DIR, file), renderGuildPage(guild, section.title), "utf8");
      count += 1;
    }
  }
  console.log(`guild pages: wrote index + ${count - 1} guild pages → ${path.relative(process.cwd(), GUILDS_DIR)}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) await main();

export { renderGuildPage, renderIndex };
