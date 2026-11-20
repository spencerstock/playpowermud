import http from "node:http";
import { attachRelay, relayOptionsFromEnv } from "./relay.js";

/**
 * Legacy self-hosted TCP bridge for a MUD that has no WebSocket of its own.
 * Powermud production does: the client defaults to wss://powermud.com:2000.
 * Point a build at this process with MUD_WS_URL=wss://<this host>/api/ws (RELAY_URL still works).
 */
const port = Number(process.env.PORT) || 8787;
const opts = relayOptionsFromEnv();
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, target: `${opts.host}:${opts.port}` }));
    return;
  }
  res.writeHead(404);
  res.end();
});
attachRelay(server, opts);
server.listen(port, () => console.log(`[relay] listening on :${port}/api/ws → ${opts.host}:${opts.port}`));
