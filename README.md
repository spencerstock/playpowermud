# playpowermud

Play [Powermud](http://powermud.com) in the browser. A basic client built from the internals of
`mudwithme`: terminal, aliases, comms, world map — nothing else.

- **Terminal** — xterm.js with full ANSI, so `eset` colors show exactly as the MUD sends them.
  Command history (↑/↓), empty Enter repeats the last command, the password prompt is masked.
- **Aliases** — `/alias NAME EXPANSION`, `/unalias NAME`, `/aliases [filter]`. `;` chains, nested
  aliases, `$1$` args. Type `/` for autocomplete. Stored in this browser (localStorage).
- **Comms** — tells, says, shouts and channels in the side panel (Option+C), kept per character.
- **Map** — the shipped Powermud world graph with live position tracking, level/plane view,
  search and a room inspector (Option+M). What you map is saved in this browser (IndexedDB).

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
300 s on Hobby (set in `vercel.json`), up to 800 s on Pro (1800 s in beta). When it closes the
character goes link-dead and the client shows the login prompt again on reconnect. For
uninterrupted play, run `yarn relay` on an always-on host and build with
`RELAY_URL=wss://<host>/api/ws`. `?relay=wss://…` on the page URL overrides it for testing.

## Updating the map

`public/data/powermud.graph.json` is copied from `mudwithme/data/world/powermud.graph.json`.
Browsers keep their own learned copy until a shipped map with a newer `updatedAt` arrives.
