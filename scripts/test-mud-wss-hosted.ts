/**
 * Simulate a browser-hosted client: WSS + Origin header, binary telnet frames, login flow.
 * Default: wss://powermud.com/ws2001 with Origin https://playpowermud.com
 */
import { TelnetFilter, encodeLine } from "../src/client/telnet.js";
import WebSocket from "ws";

const url = process.env.MUD_WSS_URL?.trim() || "wss://powermud.com/ws2001";
const origin = process.env.MUD_WSS_ORIGIN?.trim() || "https://playpowermud.com";
const name = process.argv[2]?.trim() || "guest";

const telnet = new TelnetFilter();
const decoder = new TextDecoder("utf-8");
let text = "";
let sentLogin = false;
let sentQuit = false;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

console.log(`→ ${url}`);
console.log(`  Origin: ${origin}`);
console.log(`  login: ${name}`);

const ws = new WebSocket(url, { origin });
ws.binaryType = "nodebuffer";

const timeout = setTimeout(() => {
  ws.terminate();
  fail("timed out (no prompt / session end)");
}, 25_000);

ws.on("open", () => {
  console.log("WebSocket open (wss ok)");
});

ws.on("message", (data, isBinary) => {
  if (!isBinary) {
    console.log(`(text frame) ${String(data).slice(0, 200)}`);
    return;
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  const chunk = telnet.feed(buf);
  const part = decoder.decode(chunk.data, { stream: true });
  if (part) process.stdout.write(part);
  text += part;

  if (/What is your user/i.test(text) && !sentLogin) {
    sentLogin = true;
    console.log(`\n← ${name}`);
    ws.send(Buffer.from(encodeLine(name)));
    return;
  }
  if (
    sentLogin &&
    !sentQuit &&
    (new RegExp(`Welcome back, ${name}`, "i").test(text) ||
      /MOVING TO 'start'|You wake up|Setting prompt to:/i.test(text))
  ) {
    sentQuit = true;
    console.log("\n← quit");
    ws.send(Buffer.from(encodeLine("quit")));
    return;
  }
  if (/Closing down\./i.test(text)) {
    clearTimeout(timeout);
    ws.close();
    console.log("\nok — hosted-style wss session completed");
    process.exit(0);
  }
});

ws.on("error", (err) => {
  clearTimeout(timeout);
  fail(err.message);
});

ws.on("close", (code, reason) => {
  clearTimeout(timeout);
  if (/Closing down/i.test(text)) process.exit(0);
  fail(`closed early: ${code} ${reason.toString() || ""}`);
});