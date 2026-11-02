# Powermud game reference — wiki map

This file tracks how **Powermud** knowledge is organized on the Play Powermud wiki (`public/wiki/`). Update wiki HTML when you add or rename topics.

---

## Using the client

| Wiki page | Topic |
|-----------|--------|
| [Getting started](../public/wiki/client/getting-started.html) | Connect, shortcuts, relay, local dev |
| [Terminal & colors](../public/wiki/client/terminal.html) | Input, ANSI, `eset` |
| [Aliases](../public/wiki/client/aliases.html) | Browser `/alias` macros |
| [Comms](../public/wiki/client/comms.html) | Tells, says, shouts panel |
| [World map](../public/wiki/client/map.html) | Live mapper |

---

## World

| Wiki page | Source notes |
|-----------|----------------|
| [World overview](../public/wiki/reference/world-and-directions.html) | Threshold, zones, `directions.txt` / HTML routes |
| [Explored map data](../public/wiki/reference/explored-world.html) | `public/data/powermud.graph.json`, IndexedDB merge |

---

## Characters

| Wiki page | Source notes |
|-----------|----------------|
| [Races](../public/wiki/reference/help/races.html) | `help races` |
| [Stats & builds](../public/wiki/reference/characters-and-stats.html) | Player stat sheets, ranks, professions |
| [Battlemages](../public/wiki/reference/help/battlemage.html) | `help battlemage` + community join steps |

---

## Items & combat

| Wiki page | Source notes |
|-----------|----------------|
| [Items & equipment](../public/wiki/reference/items-and-equipment.html) | Item catalogs, drops, sac/plus |
| [Combat](../public/wiki/reference/combat.html) | Damage scales, stun, dragon guide |
| [PK areas](../public/wiki/reference/help/pk-areas.html) | `help pkareas` |

---

## Quests & crafting

| Wiki page | Source notes |
|-----------|----------------|
| [Quest system](../public/wiki/reference/help/quests.html) | `help quests` |
| [Quest notes & clues](../public/wiki/reference/quests-corpus.html) | Lists, `clues.md` hooks |
| [Herbs & doctor](../public/wiki/reference/help/herbs-doctor.html) | Doctor profession, herb routes |
| [Player guides](../public/wiki/reference/guides.html) | Compatible spells, Apex components, legacy doctor TXTs |

---

## Spells & help

| Wiki page | Source notes |
|-----------|----------------|
| [Help topic index](../public/wiki/reference/spells.html) | Curated help copies under `docs/powermud/help/` |
| [Colors (eset)](../public/wiki/reference/help/eset.html) | `help eset` / ANSI |

---

## About the wiki

| Wiki page | Purpose |
|-----------|---------|
| [Spoilers & sources](../public/wiki/reference/content-notes.html) | Unofficial or spoiler-heavy material |
| [Behind the scenes data](../public/wiki/reference/data-caches.html) | `known-players.json` and related caches |

---

## Repo corpus (maintainers)

Raw imports and archives live under `docs/powermud/` (items, quests, world-and-directions, help, etc.). The wiki surfaces a readable subset; not every file has a HTML page yet.
