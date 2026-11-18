# playpowermud

Open source ([MIT](./LICENSE)) — [github.com/spencerstock/playpowermud](https://github.com/spencerstock/playpowermud)

Play [Powermud](http://powermud.com) in the browser. A basic client built from the internals of
`mudwithme`: terminal, aliases, comms, world map — nothing else.

- **Terminal** — xterm.js with full ANSI, so `eset` colors show exactly as the MUD sends them.
  Command history (↑/↓), empty Enter repeats the last command, the password prompt is masked.
- **Aliases** — `/alias NAME EXPANSION`, `/unalias NAME`, `/aliases [filter]`. `;` chains, nested
  aliases, `$1$` args, and `@delay 2` (pause 2 seconds before the next command, also in `/when`).
  Type `/` for autocomplete. Stored in this browser (localStorage).
- **Config** — **Export config** / **Import config** in the header backs up aliases, comms, skin,
  panel prefs, and the learned map (JSON file).
- **Comms** — tells, says, and shouts in the side panel (Option+C), kept per character.
- **Map** — starts empty in each browser. As you walk, rooms and exits are learned, with live
  position tracking, level/plane view, search, and a room inspector (Option+M). The map is saved
  in this browser (IndexedDB) and restored next time.
- **Wiki** — [/wiki](/wiki): **Using the client** and **Powermud game wiki** (characters, items, quests, professions).

## Run locally

```bash
yarn install
yarn dev            # http://localhost:3000 — static site + relay at /api/ws
yarn test
yarn typecheck
```

## How it works

Everything runs in the browser (`src/client`, `src/web`, plus the copied `src/game`, `src/mapper`,
`src/aliases`). The only server piece is a relay (`server/relay.ts`) that pipes WebSocket frames to
a TCP connection to `powermud.com:2000`. The target is fixed server-side; clients cannot choose it.

| Entry | Use |
|-------|-----|
| `api/ws.ts` | Vercel Function (WebSockets on Fluid compute) |
| `server/dev.ts` | Local dev: serves `public/` and the relay |
| `server/standalone.ts` | Relay alone, for an always-on host (`yarn relay`, `PORT`, `/health`) |

See [PLAN.md](./PLAN.md) for what was copied, trimmed and rewritten from mudwithme.

## Deploy on Vercel

`vercel.json` builds the client (`yarn build` → `public/build/`), serves `public/`, and deploys
`api/ws.ts` as the relay function.

Environment variables (all optional):

| Var | Default | Meaning |
|-----|---------|---------|
| `MUD_HOST` / `MUD_PORT` | `powermud.com` / `2000` | Relay target |
| `ALLOWED_ORIGINS` | *(any)* | Comma-separated `Origin`s allowed to open the relay, e.g. `https://playpowermud.vercel.app` |
| `RELAY_URL` | *(this site's `/api/ws`)* | Build-time: point the client at an external relay |

**Session length:** a Vercel WebSocket closes when the function reaches its max duration —
1800 s (30 min) on Pro/Enterprise with extended duration (set in `vercel.json`; 300 s on Hobby). When it closes the
character goes link-dead and the client shows the login prompt again on reconnect. For
uninterrupted play, run `yarn relay` on an always-on host and build with
`RELAY_URL=wss://<host>/api/ws`. `?relay=wss://…` on the page URL overrides it for testing.

**Powermud native WebSocket (`:2001`):** the game server can expose telnet over WebSocket at
`ws://powermud.com:2001` (plain `ws` only for now — `wss` on that port is not up yet). Smoke-test
from the terminal with `yarn test:mud-ws` (optional URL and commands:
`yarn test:mud-ws ws://powermud.com:2001 guest quit`). On **local** `yarn dev` (HTTP), point the
browser at it with `?relay=ws://powermud.com:2001` — HTTPS pages cannot use `ws://` (mixed content).

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
