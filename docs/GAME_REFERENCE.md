# Powermud game reference — location index

Copy of mudwithme `docs/GAME_REFERENCE.md` for alignment with the playpowermud wiki (`public/wiki/`). Canonical source: `~/src/mudwithme/docs/GAME_REFERENCE.md` — update there first, then refresh this copy and wiki HTML as needed.

Where game knowledge lives in the mudwithme repo (not tooling docs like `bots.md` or `cursor-agent.md`). For every file in the old player corpus, see [powermud/README.md](./powermud/README.md).

---

## Hub and entry points

| Location | Purpose |
|----------|---------|
| [AGENT_CONTEXT.md](../AGENT_CONTEXT.md) | Main agent playbook: living session state (Zim), rules of engagement (no PK, social inbox, dragon oversight), Zim spells/aliases/combat notes, pitfalls, user prefs. Links map + character docs. |
| [powermud/README.md](./powermud/README.md) | **Canonical index** for imported player docs: folder map, one-line file descriptions, provenance (Gmail, Downloads, `PM.rar` / `TXTs.zip`), renames, and what came from **`PM/Underhanded/`**. |

---

## `docs/powermud/` — imported + curated reference

| Folder | What it holds |
|--------|----------------|
| [items-and-equipment/](./powermud/items-and-equipment/) | Magic/mundane item catalogs, NPC drops, sac/plus formulas, personal gear lists; [sources.md](./powermud/items-and-equipment/sources.md) = agent-verified shops/drops from live play. |
| [characters-and-stats/](./powermud/characters-and-stats/) | Sample builds, stat sheets, exp notes, profession picks, rank ladders. |
| [combat/](./powermud/combat/) | Damage scales, stun times, battlemage damage notes, dragon guide. |
| [quests/](./powermud/quests/) | Quest lists, drow/DQ requirements, psionics notes, fast-exp mob list; [clues.md](./powermud/quests/clues.md) = hooks from play (avoids full ToS walkthroughs). |
| [guides/](./powermud/guides/) | Doctor/herb notes (legacy + 2008 variant), spell compatibility, area components. |
| [world-and-directions/](./powermud/world-and-directions/) | `directions.txt`, HTML route guides, agent [zones.md](./powermud/world-and-directions/zones.md) / [threshold.md](./powermud/world-and-directions/threshold.md). |
| [code-and-functions/](./powermud/code-and-functions/) | [functions.txt](./powermud/code-and-functions/functions.txt) — player-object LPC function name dump. |
| [client/](./powermud/client/) | Ashavar AL Client binaries/archives (third-party MUD client). |
| [help/](./powermud/help/) | Agent-maintained in-game help (**paths stable — referenced from code**). |
| [misc/](./powermud/misc/) | Logs, splash, emotes, signatures, **proxy list**. |
| [archives/](./powermud/archives/) | Original `PM.rar` / `TXTs.zip` and byte-identical duplicates (including `TXTs/Underhanded/*`). |

### `help/` topic index

| Doc | Contents |
|-----|----------|
| [help/README.md](./powermud/help/README.md) | Index; Zim spell digest regeneration |
| [herbs-and-doctor.md](./powermud/help/herbs-and-doctor.md) | Doctor, harvest, intensify, plant routes |
| [topics/quests.md](./powermud/help/topics/quests.md) | Quest system help |
| [topics/pkareas.md](./powermud/help/topics/pkareas.md) | PK area list command |
| [topics/eset-ansi.md](./powermud/help/topics/eset-ansi.md) | `eset` / ANSI colors |
| [topics/battlemage.md](./powermud/help/topics/battlemage.md) | Battlemage help + agent-discovered join steps |
| [topics/races.md](./powermud/help/topics/races.md) | Race help |

---

## Explored world (live map, not static PM dumps)

| Location | Purpose |
|----------|---------|
| [world/MAP.md](./world/MAP.md) | Human-readable map index; sync via `yarn dev` / `yarn cli play persist map` |
| [world/world-map.json](./world/world-map.json), zone JSON, [room-corpus.json](./world/room-corpus.json) | Machine-readable rooms and links |
| [world/rooms/](./world/rooms/) | Per-room text snapshots (large corpus) |

---

## Per-character agent notes

| Doc | Character |
|-----|-----------|
| [characters/wybie/AGENT_CONTEXT.md](./characters/wybie/AGENT_CONTEXT.md) | Wybie |
| [characters/zurker/AGENT_CONTEXT.md](./characters/zurker/AGENT_CONTEXT.md) | Zurker |
| [characters/esmira/AGENT_CONTEXT.md](./characters/esmira/AGENT_CONTEXT.md) | Esmira |
| [characters/aria/AGENT_CONTEXT.md](./characters/aria/AGENT_CONTEXT.md) | Aria |

Root [AGENT_CONTEXT.md](../AGENT_CONTEXT.md) is **Zim-centric**; other toons live under `docs/characters/`.

---

## Zim spell digest (repo root)

| File | Purpose |
|------|---------|
| [.agent-zim-helps-digest.md](../.agent-zim-helps-digest.md) | Summary table of ~114 `help` topics for Zim |
| `.agent-zim-helps.txt` (gitignored) | Raw fetch — see [help/README.md](./powermud/help/README.md) for scripts |

---

## JSON caches (`data/powermud/`)

| File | Purpose |
|------|---------|
| [known-players.json](../data/powermud/known-players.json) | Admin names (social/staff awareness) |
| [discovered-players.json](../data/powermud/discovered-players.json) | Players seen via announce/who |
| [atmosphere-commands.json](../data/powermud/atmosphere-commands.json) | Full `emotes`/souls list |
| [npc-gauge-results.json](../data/powermud/npc-gauge-results.json) | Cached `gauge` output per NPC/room |

---

## Hybrid: game mechanics for grind bots

| Doc | Purpose |
|-----|---------|
| [powermud-bot-guide.md](./powermud-bot-guide.md) | Powermud mechanics mapped to `bot-template.ts` (automation design; pairs with [bots.md](./bots.md)) |

---

## Underhanded / edgy / automation-adjacent content

The old bundle used a folder **`PM/Underhanded/`**. Those files were merged into normal categories (see [powermud/README.md](./powermud/README.md)); duplicates under `archives/duplicates/TXTs/Underhanded/`.

### Clearly underhanded

| Item | Why |
|------|-----|
| [misc/proxies.txt](./powermud/misc/proxies.txt) | Open **proxy host:port** list with character names — multi-connection / IP-evasion material, not normal game lore. **Most sensitive file in the tree.** |

### From “Underhanded” — mostly spoilers / min-max

| Now | Content |
|-----|---------|
| [quests/quests.txt](./powermud/quests/quests.txt) | Full quest walkthrough triggers |
| [quests/psionicsquest.txt](./powermud/quests/psionicsquest.txt) | Psionics quest notes |
| [guides/compatible spells.txt](./powermud/guides/compatible%20spells.txt) | Short spell combo list |
| [items-and-equipment/spare-ish eq.txt](./powermud/items-and-equipment/spare-ish%20eq.txt) | Personal gear list |
| [misc/custom emote.txt](./powermud/misc/custom%20emote.txt) | Dice-roll emote patterns (social flavor) |

### Powergaming / meta (typical MUD wiki territory)

- Drop lists, item HTML, sac/plus guides, [merevia fastexp.txt](./powermud/quests/merevia%20fastexp.txt)
- [combat/](./powermud/combat/) and Dragon Guide
- [help/topics/battlemage.md](./powermud/help/topics/battlemage.md) join section (kill clerk for quill — game path, not in official `help`)
- `npc-gauge-results.json`

### Automation-adjacent (repo policy: human lock/pause wins)

- [client/](./powermud/client/) — third-party client (triggers/macros historically)
- [functions.txt](./powermud/code-and-functions/functions.txt) — internal LPC API names
- [powermud-bot-guide.md](./powermud-bot-guide.md) and `data/bots/`

### Not nefarious

- Pulled `help/*`, [quests/clues.md](./powermud/quests/clues.md), [world/](./world/) exploration data, admin list in `known-players.json`

---

## Mental model

```text
AGENT_CONTEXT.md ──┬── docs/world/MAP.md
                   ├── docs/characters/*/
                   ├── .agent-zim-helps-digest.md
                   └── docs/powermud/README.md
                            ├── static PM/Gmail corpus
                            ├── help/ (curated + code-linked)
                            └── archives/ (original zips + Underhanded dupes)

data/powermud/*.json ── observation caches
```
