import http from "node:http";
import { attachRelay, relayOptionsFromEnv } from "../server/relay.js";

/**
 * Vercel Function (Fluid compute, WebSockets): `wss://<site>/api/ws` → powermud.com:2000.
 * The connection ends when the function hits maxDuration (vercel.json); see PLAN.md.
 */
const server = http.createServer((_req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("WebSocket upgrade required\n");
});
attachRelay(server, relayOptionsFromEnv());

export default server;
