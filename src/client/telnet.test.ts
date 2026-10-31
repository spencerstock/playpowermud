import assert from "node:assert/strict";
import test from "node:test";
import { encodeLine, TelnetFilter } from "./telnet.js";

const bytes = (...xs: (number | string)[]) =>
  Uint8Array.from(xs.flatMap((x) => (typeof x === "string" ? [...new TextEncoder().encode(x)] : [x])));
const text = (u: Uint8Array) => new TextDecoder().decode(u);

test("passes plain text through", () => {
  const f = new TelnetFilter();
  assert.equal(text(f.feed(bytes("Hello\r\n")).data), "Hello\r\n");
});

test("strips negotiation and reports server echo", () => {
  const f = new TelnetFilter();
  const on = f.feed(bytes("Password: ", 0xff, 0xfb, 0x01));
  assert.equal(text(on.data), "Password: ");
  assert.equal(on.serverEcho, true);
  const off = f.feed(bytes(0xff, 0xfc, 0x01, "\r\nWelcome"));
  assert.equal(text(off.data), "\r\nWelcome");
  assert.equal(off.serverEcho, false);
});

test("handles sequences split across chunks and subnegotiation", () => {
  const f = new TelnetFilter();
  assert.equal(text(f.feed(bytes("a", 0xff)).data), "a");
  const r = f.feed(bytes(0xfb, 0x01, "b", 0xff, 0xfa, 0x18, 0x01, 0xff, 0xf0, "c"));
  assert.equal(text(r.data), "bc");
  assert.equal(r.serverEcho, true);
  assert.equal(f.feed(bytes(0xff, 0xff)).data[0], 0xff);
});

test("encodeLine appends CRLF as UTF-8", () => {
  assert.deepEqual([...encodeLine("hi")], [0x68, 0x69, 0x0d, 0x0a]);
});
