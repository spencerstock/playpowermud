# Powermud game reference — wiki map

This file tracks how **Powermud** knowledge is organized on the Play Powermud wiki (`public/wiki/`). Update wiki HTML when you add or rename topics.

The public wiki is the reference. Personal character sheets, client config, proxies, and cheats are not published — see [`docs/personal/`](./personal/).

---

## Getting started

| Wiki page | Topic |
|-----------|--------|
| [Beginner's guide](../public/wiki/guide/beginners-guide.html) | First hour, races, healing, money, dangers |

## World

| Wiki page | Topic |
|-----------|--------|
| [Walking directions](../public/wiki/world/directions.html) | Overworld walking routes |
| [Underdark directions](../public/wiki/world/underdark.html) | Underdark walking routes |

## Guilds

| Wiki page | Topic |
|-----------|--------|
| [Guilds](../public/wiki/guilds/index.html) | Every guild: races, minimums, location |
| [Guild pages](../public/wiki/guilds/) | One page per joinable guild (see index) |
| [Races](../public/wiki/guilds/races.html) | `help races` |
| [Drow](../public/wiki/guilds/drow.html) | Noble houses in Nal Shaddar |
| [Bastion of High Sorcery](../public/wiki/guilds/bastion.html) | Mage guild and joining quest |

## Equipment

| Wiki page | Topic |
|-----------|--------|
| [Items](../public/wiki/items/index.html) | Plus formula, sacrifice note, shop stock |
| [Normal equipment](../public/wiki/items/normal-equipment.html) | Mundane gear and locations (hand rows in `scripts/items-hand-data.mjs`, hub stats merged at build) |
| [Magic items](../public/wiki/items/magic-items.html) | Slot, plus, effects, hub judge/sell/drop columns |
| [Crafting components](../public/wiki/items/components.html) | Component pairs |

Hand-curated equipment rows: `scripts/items-hand-data.mjs`. After copying `data/stats/world-knowledge.json` and `item-values.json` from mudwithme (see repo README), run `yarn build:wiki` to refresh judge, sell, and drop columns.

## NPCs and drops

| Wiki page | Topic |
|-----------|--------|
| [Magical drops](../public/wiki/npcs/drops.html) | Witnessed magic drops |

## Quests

| Wiki page | Topic |
|-----------|--------|
| [Quest system](../public/wiki/quests/index.html) | `help quests` |
| [Quest notes](../public/wiki/quests/notes.html) | Older notes, spoilers closed |

## Mechanics

| Wiki page | Topic |
|-----------|--------|
| [Combat](../public/wiki/mechanics/combat.html) | Hit words, stun, dragon notes |
| [Stats and ranks](../public/wiki/mechanics/stats.html) | Abilities and dragon killer rank names |
| [Professions](../public/wiki/mechanics/professions.html) | Lower and upper professions |
| [Profession trainers](../public/wiki/mechanics/profession-trainers.html) | Profession NPCs, costs, stat reqs |
| [Skill trainers](../public/wiki/mechanics/skill-trainers.html) | Standalone skill NPCs (riding, tailoring, etc.) |
| [Doctor and herbs](../public/wiki/mechanics/doctor.html) | Doctor, harvest, intensify |
| [PK areas](../public/wiki/mechanics/pk-areas.html) | `help pkareas` |

## Browser client

| Wiki page | Topic |
|-----------|--------|
| [Getting started](../public/wiki/client/getting-started.html) | Connect, shortcuts, relay |
| [Terminal and colors](../public/wiki/client/terminal.html) | Input and ANSI |
| [Colors (eset)](../public/wiki/reference/help/eset.html) | In-game `eset` |
| [Aliases](../public/wiki/client/aliases.html) | Browser aliases |
| [Comms](../public/wiki/client/comms.html) | Tells, says, shouts |
| [World map](../public/wiki/client/map.html) | Live mapper |
| [Map data](../public/wiki/reference/explored-world.html) | Shared graph |
| [Site data](../public/wiki/reference/data-caches.html) | JSON the client ships |
