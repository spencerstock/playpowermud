// Bundle the browser client. RELAY_URL (optional) points the client at a relay other than
// this site's own /api/ws — e.g. an always-on host (see PLAN.md "Session length").
import { build } from "esbuild";

const relayUrl = process.env.RELAY_URL?.trim() ?? "";

await build({
  entryPoints: ["src/web/app.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "public/build/app.js",
  sourcemap: true,
  minify: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
  define: { __RELAY_URL__: JSON.stringify(relayUrl) },
  logLevel: "info",
});
