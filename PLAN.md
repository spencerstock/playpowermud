# playpowermud — plan

A standalone, browser-based Powermud client deployed on Vercel. Forked from the internals of
`~/src/mudwithme`, cut down to a basic client:

| In | Out |
|----|-----|
| MUD terminal (xterm, full ANSI, so `eset` colors render as the MUD sends them) | `/to` room walking, speedwalk, map click-to-walk |
| `/alias NAME EXPANSION`, `/unalias NAME`, `/aliases`; `;` chains, `%1`/`%*` args, zScript subset | Bots, macros, automation, triggers, smart aliases |
| Comms tab (tells / says / shouts / channels, stored per browser) | Hub, multi-viewer, lock/pause, agent/MCP/CLI |
| World map (shipped Powermud graph, live position tracking, search, room inspector) | Login profiles / auto-login, highlights, VPN, bridge |

## Architecture

The old project ran a Node **hub** that owned the MUD socket and did all parsing; browsers were thin
viewers. Here the **browser does everything** and the server is a dumb byte pipe:

```
Browser (one tab = one MUD session)
  src/web/app.ts            terminal, input line, history, alias autocomplete
  src/client/connection.ts  WebSocket to the relay; telnet IAC filter; UTF-8 decode
  src/client/runtime.ts     GameStream → GameStateTracker → Mapper  (copied from hub GameRuntime)
  src/client/aliases.ts     AliasEngine + localStorage alias table
  src/client/comms.ts       commsLogIngest → side panel, localStorage
  src/client/mapApi.ts      in-process stand-in for the hub's /api/map/* routes (worldPanel uses it)
  src/client/mapStore.ts    shipped graph (public/data/powermud.graph.json) + IndexedDB copy of what you learn
        │  wss://…/api/ws   (binary frames, raw MUD bytes both ways)
Relay  server/relay.ts      ws ↔ net.Socket to powermud.com:2000 — target is fixed, never client-chosen
  api/ws.ts                 Vercel Function entry (WebSocket on Fluid compute)
  server/dev.ts             local dev: static public/ + the same relay at /api/ws
  server/standalone.ts      relay only, for a long-lived host (see "Session length")
```

Copied verbatim (with tests): `src/game/*` stream/state/profile parsing, `src/mapper/*` graph + live
mapper, `src/aliases/{engine,zscript,slashDefine}`, `src/web/{mudTerminal,ansiHtml,telnetLineEditor,chatPanel}`.
Trimmed: `game/players.ts` (known-player registry only, no fs), `session/scrollback.ts` (stripAnsi
only), `web/sidePanel.ts` (comms only), `web/worldPanel.ts` (no bots/logins/walk/link editing),
`web/aliasAutocomplete.ts` (no `/to`, `/for`, profile aliases). Rewritten: `web/app.ts`, `index.html`.

## Session length on Vercel

Vercel Functions serve WebSockets, but a connection closes when the function hits its max
duration: **5 min on Hobby**, 800 s on Pro (1800 s beta). When the relay closes, the MUD socket
closes and the character goes link-dead; the client reconnects to the login prompt.

For uninterrupted play, run `server/standalone.ts` on any always-on host (Fly.io, Railway, a VPS)
and build with `RELAY_URL=wss://that-host/api/ws`. The client is otherwise unchanged.

## Steps

1. Scaffold repo: package.json (yarn, esbuild, tsx, ws, xterm), tsconfig, vercel.json, .gitignore.
2. Copy engine modules from mudwithme; strip node-only code (fs/path) so everything bundles for the browser.
3. Build the client layer (`src/client/*`) replacing the hub WebSocket protocol.
4. Trim the UI modules; rewrite app.ts / index.html around the local runtime.
5. Relay (`server/relay.ts`, `api/ws.ts`, `server/dev.ts`, `server/standalone.ts`).
6. Typecheck, run copied tests, run locally against powermud.com, `vercel build` dry-run.
