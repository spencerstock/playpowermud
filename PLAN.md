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
viewers. Here the **browser does everything** and talks to Powermud's own WebSocket:

```
Browser
  src/web/app.ts            terminal, input line, history, alias autocomplete
  src/client/connection.ts  WebSocket to the MUD; telnet IAC filter; UTF-8 decode
  src/client/relayClient.ts SharedWorker: one socket across game + wiki views (not a TCP relay)
  src/client/runtime.ts     GameStream → GameStateTracker → Mapper
  src/client/aliases.ts     AliasEngine + localStorage alias table
  src/client/comms.ts       commsLogIngest → side panel, localStorage
  src/client/mapApi.ts      in-process stand-in for the hub's /api/map/* routes
  src/client/mapStore.ts    one session's learned graph in IndexedDB (starts empty)
        │  wss://powermud.com:2000   (prod; binary telnet frames)
        │  ?relay=… or MUD_WS_URL    override
Legacy relay (rollback / non-WSS MUDs only)
  server/relay.ts           ws ↔ net.Socket; target fixed server-side
  api/ws.ts                 still on Vercel so ?relay=wss://<site>/api/ws rolls back
  server/dev.ts             local static site + that relay at /api/ws
  server/standalone.ts      yarn relay
```

Production default is `wss://powermud.com:2000`. Port 2001 is Powermud's dev instance.
Empty `MUD_WS_URL` / `RELAY_URL` at build time bakes the production URL. Direct mode is "not
`/api/ws`": ports 2000 and 2001 and paths `/ws2000` / `/ws2001` all count, and the first binary
frame still marks the socket connected if the guess is wrong. A direct close says "connection
lost", not "relay connection lost".

## Session length

The direct socket is limited by Powermud and the network, not by a Vercel function timeout.
`api/ws.ts` remains deployed for one release as rollback. That path still dies at `maxDuration`
in `vercel.json`. Do not document it as the way to play.

Copied verbatim (with tests): `src/game/*` stream/state/profile parsing, `src/mapper/*` graph + live
mapper, `src/aliases/{engine,zscript,slashDefine}`, `src/web/{mudTerminal,ansiHtml,telnetLineEditor,chatPanel}`.
Trimmed: `game/players.ts` (known-player registry only, no fs), `session/scrollback.ts` (stripAnsi
only), `web/sidePanel.ts` (comms only), `web/worldPanel.ts` (no bots/logins/walk/link editing),
`web/aliasAutocomplete.ts` (no `/to`, `/for`, profile aliases). Rewritten: `web/app.ts`, `index.html`.

## Steps

1. Scaffold repo: package.json (yarn, esbuild, tsx, ws, xterm), tsconfig, vercel.json, .gitignore.
2. Copy engine modules from mudwithme; strip node-only code (fs/path) so everything bundles for the browser.
3. Build the client layer (`src/client/*`) replacing the hub WebSocket protocol.
4. Trim the UI modules; rewrite app.ts / index.html around the local runtime.
5. Relay (`server/relay.ts`, `api/ws.ts`, `server/dev.ts`, `server/standalone.ts`).
6. Typecheck, run copied tests, run locally against powermud.com, `vercel build` dry-run.
