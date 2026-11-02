// Bundle the browser client. RELAY_URL (optional) points the client at a relay other than
// this site's own /api/ws — e.g. an always-on host (see PLAN.md "Session length").
import { build } from "esbuild";

const relayUrl = process.env.RELAY_URL?.trim() ?? "";

const minify = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
const shared = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  minify,
  define: { __RELAY_URL__: JSON.stringify(relayUrl) },
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
