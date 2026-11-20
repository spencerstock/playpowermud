/**
 * Smoke-test Powermud's native WebSocket.
 * Default is production: wss://powermud.com:2000. Port 2001 is their dev instance.
 *
 * Usage:
 *   yarn test:mud-ws
 *   yarn test:mud-ws wss://powermud.com:2000 guest quit
 *   MUD_WS_URL=wss://powermud.com:2000 yarn test:mud-ws
 */
import { TelnetFilter } from "../src/client/telnet.js";
import WebSocket from "ws";

const DEFAULT_URL = "wss://powermud.com:2000";
const url = process.argv[2]?.startsWith("ws") ? process.argv[2] : process.env.MUD_WS_URL?.trim() || DEFAULT_URL;
const commands = process.argv[2]?.startsWith("ws") ? process.argv.slice(3) : process.argv.slice(2);
const idleMs = Number(process.env.MUD_WS_IDLE_MS) || 8_000;

function usage(): void {
  console.error(`Usage: yarn test:mud-ws [${DEFAULT_URL}] [command ...]`);
  process.exit(2);
}

if (process.argv.includes("-h") || process.argv.includes("--help")) usage();

const telnet = new TelnetFilter();
const decoder = new TextDecoder("utf-8");
let sawPrompt = false;
let exitCode = 1;

const ws = new WebSocket(url);
ws.binaryType = "nodebuffer";

console.log(`→ ${url}`);

const finish = (code: number, reason: string) => {
  if (exitCode === 1) exitCode = code;
  console.log(`\n${reason}`);
  try {
    ws.close();
  } catch {
    /* */
  }
  process.exit(code);
};

const idle = setTimeout(() => finish(sawPrompt ? 0 : 1, sawPrompt ? "ok (login prompt seen)" : "timed out before login prompt"), idleMs);

ws.on("open", () => {
  console.log("WebSocket open");
  let i = 0;
  const sendNext = () => {
    if (i >= commands.length) return;
    const line = commands[i++]!;
    console.log(`← ${line}`);
    ws.send(Buffer.from(`${line}\r\n`));
    if (i < commands.length) setTimeout(sendNext, 400);
  };
  sendNext();
});

ws.on("message", (data, isBinary) => {
  if (!isBinary) {
    console.log(`(text) ${String(data)}`);
    return;
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  const chunk = telnet.feed(buf);
  const text = decoder.decode(chunk.data, { stream: true });
  if (text) process.stdout.write(text);
  if (/What is your user/i.test(text)) {
    sawPrompt = true;
    if (commands.length === 0) {
      clearTimeout(idle);
      finish(0, "ok (login prompt seen)");
    }
  }
});

ws.on("error", (err) => {
  clearTimeout(idle);
  console.error(err.message);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  clearTimeout(idle);
  const why = reason.toString() || `code ${code}`;
  finish(sawPrompt ? 0 : 1, `closed: ${why}`);
});