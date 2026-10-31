import http from "node:http";
import { attachRelay, relayOptionsFromEnv } from "./relay.js";

/**
 * Relay only, for an always-on host (Fly.io, Railway, a VPS) so MUD sessions are not cut at
 * Vercel's function max duration. Build the client with RELAY_URL=wss://<this host>/api/ws.
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
