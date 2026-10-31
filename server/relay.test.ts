import assert from "node:assert/strict";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket } from "ws";
import { attachRelay, originAllowed } from "./relay.js";

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

test("originAllowed: empty list allows any, otherwise exact match", () => {
  assert.equal(originAllowed(undefined, []), true);
  assert.equal(originAllowed("https://a.vercel.app", ["https://a.vercel.app"]), true);
  assert.equal(originAllowed("https://evil.example", ["https://a.vercel.app"]), false);
  assert.equal(originAllowed(undefined, ["https://a.vercel.app"]), false);
});

test("relays bytes both ways and reports status", async () => {
  const received: Buffer[] = [];
  const mud = net.createServer((sock) => {
    sock.write(Buffer.from([0xff, 0xfb, 0x01, ...Buffer.from("Password: ")]));
    sock.on("data", (d) => {
      received.push(d);
      sock.end("bye\r\n");
    });
  });
  const mudPort = await listen(mud);
  const web = http.createServer();
  attachRelay(web, { host: "127.0.0.1", port: mudPort, allowedOrigins: [] });
  const webPort = await listen(web);

  const ws = new WebSocket(`ws://127.0.0.1:${webPort}/api/ws`);
  const events: string[] = [];
  const bytes: number[] = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const msg = JSON.parse(String(data)) as { state: string };
        events.push(msg.state);
        return;
      }
      bytes.push(...(data as Buffer));
      if (bytes.length >= 13 && received.length === 0) ws.send(Buffer.from("secret\r\n"));
    });
    ws.on("close", () => resolve());
    ws.on("error", reject);
  });
  assert.deepEqual(events.slice(0, 1), ["connected"]);
  assert.ok(events.includes("closed"));
  assert.deepEqual(bytes.slice(0, 3), [0xff, 0xfb, 0x01]);
  assert.match(Buffer.from(bytes).toString("latin1"), /Password: bye/);
  assert.equal(Buffer.concat(received).toString(), "secret\r\n");
  web.close();
  mud.close();
});

test("rejects other paths and disallowed origins", async () => {
  const web = http.createServer();
  attachRelay(web, { host: "127.0.0.1", port: 9, allowedOrigins: ["https://ok.example"] });
  const port = await listen(web);
  const fails = (url: string, origin?: string) =>
    new Promise<boolean>((resolve) => {
      const ws = new WebSocket(url, origin ? { origin } : {});
      ws.on("open", () => {
        ws.close();
        resolve(false);
      });
      ws.on("error", () => resolve(true));
    });
  assert.equal(await fails(`ws://127.0.0.1:${port}/nope`, "https://ok.example"), true);
  assert.equal(await fails(`ws://127.0.0.1:${port}/api/ws`, "https://evil.example"), true);
  web.close();
});
