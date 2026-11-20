import http from "node:http";
import { attachRelay, relayOptionsFromEnv } from "../server/relay.js";

/**
 * Legacy TCP relay on Vercel: `wss://<site>/api/ws` → powermud.com:2000.
 * The production client connects straight to wss://powermud.com:2000.
 * This function stays so `?relay=wss://<site>/api/ws` can roll back for one release.
 * It still ends when the function hits maxDuration (vercel.json).
 */
const server = http.createServer((_req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("WebSocket upgrade required\n");
});
attachRelay(server, relayOptionsFromEnv());

export default server;
