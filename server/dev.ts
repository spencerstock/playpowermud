import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachRelay, relayOptionsFromEnv } from "./relay.js";

/** Local dev: serve public/ and the relay at /api/ws on one port (run `yarn build` first). */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const port = Number(process.env.PORT) || 3000;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://local");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found\n");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  });
});
const opts = relayOptionsFromEnv();
attachRelay(server, opts);
server.listen(port, () => console.log(`playpowermud dev → http://localhost:${port}  (relay → ${opts.host}:${opts.port})`));
