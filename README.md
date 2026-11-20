# playpowermud

Open source ([MIT](./LICENSE)) — [github.com/spencerstock/playpowermud](https://github.com/spencerstock/playpowermud)

Play [Powermud](http://powermud.com) in the browser. A basic client built from the internals of
`mudwithme`: terminal, aliases, comms, world map — nothing else.

- **Terminal** — xterm.js with full ANSI, so `eset` colors show exactly as the MUD sends them.
  Command history (↑/↓), empty Enter repeats the last command, the password prompt is masked.
- **Aliases** — `/alias NAME EXPANSION`, `/alias NAME` (show one), `/unalias NAME`, `/aliases [filter]`. `;` chains, nested
  aliases, `$1$` args, and `@delay 2` (pause 2 seconds before the next command, also in `/when`).
  Type `/` for autocomplete. Stored in this browser (localStorage).
- **Config** — **Export config** / **Import config** saves or adds a session (aliases, comms,
  skin, panel prefs, and that session's map). The menu switches sessions. Each session has its own
  map. **Export map** / **Import map** move a map without the rest of the session.
- **Comms** — tells, says, and shouts in the side panel (Option+C), kept per character.
- **Map** — starts empty for each session. As you walk, rooms and exits are learned, with live
  position tracking, level/plane view, search, and a room inspector (Option+M). The map is saved
  with that session in this browser (IndexedDB). The game does not ship a world map.
- **Wiki** — [/wiki](/wiki): **Using the client** and **Powermud game wiki** (characters, items, quests, professions).

## Run locally

```bash
yarn install
yarn dev            # http://localhost:3000 — site; client opens wss://powermud.com:2000
yarn test
yarn typecheck
```

`yarn dev` still listens with the legacy TCP relay at `ws://localhost:3000/api/ws`. The page does
not use it unless you add `?relay=ws://localhost:3000/api/ws`.

## How it works

The game UI runs in the browser (`src/client`, `src/web`, plus `src/game`, `src/mapper`,
`src/aliases`). **Connect** opens a WebSocket straight to Powermud production:

`wss://powermud.com:2000`

Port **2000** is prod. Port **2001** is their dev instance — do not point the public client there.
A path on 443 such as `wss://powermud.com/ws2000` is recognized as a direct socket if they publish
one; it is not the default.

A SharedWorker keeps that one socket alive across the game page and wiki views in the same browser.
It multiplexes tabs. It is not a TCP relay and it does not cap session length.

| Entry | Use |
|-------|-----|
| `src/client/connection.ts` | WebSocket URL, telnet filter, direct-vs-relay detection |
| `server/dev.ts` | Local static site, plus the legacy relay at `/api/ws` |
| `server/relay.ts`, `server/standalone.ts`, `api/ws.ts` | Legacy TCP bridge (`yarn relay`). Kept for rollback and for MUDs with no WebSocket |

See [PLAN.md](./PLAN.md) for what was copied from mudwithme.

## Deploy on Vercel

`vercel.json` builds the client (`yarn build` → `public/build/`) and serves `public/`. A normal
build bakes `wss://powermud.com:2000`, so the dashboard does not need `MUD_WS_URL` for production.

`api/ws.ts` is still deployed as a **rollback** relay. Open
`?relay=wss://<this-site>/api/ws` to use it. That function still dies at Vercel's max duration
(1800 s in `vercel.json`). The direct socket does not. Remove the function in a later release
once prod has been stable on `:2000`.

| Var | Default | Meaning |
|-----|---------|---------|
| `MUD_WS_URL` | `wss://powermud.com:2000` | Build-time WebSocket URL |
| `RELAY_URL` | *(used only if `MUD_WS_URL` is unset)* | Old name for `MUD_WS_URL` |
| `MUD_HOST` / `MUD_PORT` | `powermud.com` / `2000` | Legacy relay TCP target only |
| `ALLOWED_ORIGINS` | *(any)* | Legacy relay only |

`?relay=wss://…` on the page URL overrides the baked URL (support and local testing).

Smoke-test the production socket from the terminal:

```bash
yarn test:mud-ws
yarn test:mud-wss-hosted
```

Pass another URL when you mean to hit dev, for example `yarn test:mud-ws wss://powermud.com:2001`.

## Updating equipment wiki stats

Judge, sell, and drop columns on the normal and magic equipment pages come from vendored hub stats. Copy from mudwithme, then regenerate the wiki:

```bash
cp ~/src/mudwithme/data/stats/world-knowledge.json data/stats/
cp ~/src/mudwithme/data/stats/item-values.json data/stats/
cp data/stats/*.json public/data/stats/   # optional static download mirror
yarn build:wiki
```

Hand-curated rows live in `scripts/items-hand-data.mjs`; `build-wiki-items.mjs` merges them with the JSON files.

## License

MIT — see [LICENSE](./LICENSE). Contributions welcome via pull request on GitHub.
