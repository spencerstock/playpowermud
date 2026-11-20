// Bundle the browser client.
// MUD_WS_URL is the WebSocket the page opens (production default: Powermud's own socket).
// RELAY_URL is the old name for the same slot — a self-hosted /api/ws pipe, or any override.
// Unset means direct production MUD, not this site's /api/ws.
import { build } from "esbuild";

/** Port 2000 is Powermud prod. Port 2001 is their dev instance — do not bake that here. */
const PRODUCTION_MUD_WS_URL = "wss://powermud.com:2000";

const mudWsUrl =
  process.env.MUD_WS_URL?.trim() || process.env.RELAY_URL?.trim() || PRODUCTION_MUD_WS_URL;

const minify = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  minify,
  define: {
    __MUD_WS_URL__: JSON.stringify(mudWsUrl),
    __RELAY_URL__: JSON.stringify(mudWsUrl),
  },
  logLevel: "info",
};

await build({
  ...shared,
  entryPoints: ["src/web/app.ts"],
  outfile: "public/build/app.js",
});

await build({
  ...shared,
  entryPoints: {
    "relay.shared": "src/client/relaySharedWorker.ts",
    "wiki-relay": "src/client/wikiRelayKeepalive.ts",
  },
  outdir: "public/build",
});
