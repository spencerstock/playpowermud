import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(rel) {
  return readFile(path.join(root, rel), "utf8");
}

test("walking directions page keeps every route step verbatim", async () => {
  const page = await read("public/wiki/world/directions.html");
  const blocks = [...page.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => m[1]);
  assert.equal(blocks.length, 35);

  const expected = [
    `(guardhouse)2e,se,e,se,2e(small sign),2s,se,5s,5se,2s,
4se,2s,se,2s,2e,se,3s,sw,8s,5se,s,2se,4s,2se,5s,2s,4s,6se,4s,2se,s,
e,4se,2s,sw,2s,se,2s,3se,s,e,4se,s,2e,se(small sign),2n,w,n`,
    `(guardhouse)2e,se,e,se,2e(small sign),4e,2se,e,2se,
2e,4s,3e,2se,3e,se,8e,2s,se,e,ne,2e(small sign),4s,w`,
    `(guardhouse)2e,se,e,se,2e(small sign),2s,se,5s,5se,2s,
4se,2s,se,2s,2e,se,3s,sw,8s,5se,s,2se,4s,2se,5s,2s,4s,6se,4s,2se,s,
e,4se,2s,sw,2s,se,2s,3se,s,e,4se,s,2e,se(small sign),8n,11nw(small sign),w`,
    `(guardhouse)2e,se,e,se,2e(small sign),2s,se,5s,5se,2s,
4se,2s,se,2s,2e,se,3s,sw,8s,5se,s,2se,4s,2se,5s,2s,4s,6se,4s,2se,s,
e,4se,2s,sw,2s,se,2s,3se,s,e,4se,s,2e,se(small sign),s,2se,s,se,19s,
10se,30s(edge of town),15s(top of diamond`,
    `(guardhouse)2w,10n,w,nw,w,s,*purchase 3*,5w,*board ship*,*ready*,
ne,3s,2e,4s,10e,n(arena)`,
    `(guardhouse)2e,se,e,se,2e(small sign),2s,se,5s,5se,2s,
4se,2s,se,2s,2e,se,3s,sw,8s,5se,s,2se,4s,2se,5s,2s,4s,6se,4s,2se,s,
e,4se,2s,sw,2s,se,2s,3se,s,e,4se,s,2e,se(small sign),8n,11nw,6n,w,
nw,w,sw,w`,
    `(guardhouse)2e,se,e,se,2e(small sign),4e,2se,e,2se,
2e,4s,3e,2se,3e,se,8e,2s,se,e,ne,2e(small sign),10s,
e,se,s,2se,w,s,2w,sw,s`,
    `(guardhouse)2e,se,e,se,2e(small sign),2s,se,5s,5se,2s,
4se,2s,se,2s,2e,se,3s,sw,8s,5se,e`,
    `(top of diamdond)15n(edge of town),30n,10nw,19n,nw,n,2nw,1n(small sign),2n,w,n`,
    `(top of diamdond)15n(edge of town),30n,10nw,19n,nw,n,2nw,n(small sign),
8n,11nw(small sign),w`,
    `(top of diamdond)15n(edge of town),30n,10nw,19n,nw,n,2nw,n(small sign),
nw,2w,n,4nw,w,n,3nw,2n,nw,2n,ne,2n,4nw,w,n,2nw,4n,6nw,4n,2n,5n,2nw,4n,
2nw,n,5nw,8n,ne,3n,nw,2w,2n,nw,2n,nw,2n,4nw,2n,5nw,5n,nw,2n(small sign),
2w,nw,w,nw,2w(guardhouse)`,
    `(top of diamond)3se,s,3e,2s,4e,2s,sw,*purchase 5*,sw,3w,sw,s,
*board ship*,*ready*ne,3s,2e,4s,10e,n(arena)`,
    `(top of diamdond)15n(edge of town),30n,10nw,19n,nw,n,2nw,1n(small sign),
8n,11nw(small sign),6n,w,nw,w,sw,w`,
    `(top of diamdond)15n(edge of town),30n,10nw,19n,nw,n,2nw,1n(small sign),
nw,2w,n,4nw,w,n,3nw,2n,nw,2n,ne,2n,4nw,w,n,2nw,4n,6nw,4n,2n,5n,2nw,4n,
2nw,n,e`,
    `(arena)s,10w,2n,3e,*move leaves*`,
    `(arena)s,10w,4s(hall)`,
    `(arena)s,10w,s,3e,8s,3sw,4w,nw,3n,w,2n,4*climb*,n,*leap to clouds*,
w,u`,
    `(arena)s,10w,s,3e,8s,3sw,s,2se,9e,5n`,
    `(arena)s,10w,2n,w,2nw,4w`,
    `(arena)s,10w,s,3e,8s,3sw,4w,nw,3n,w,n,2nw,*enter opening*`,
    `(arena)s,10w,s,3e,8s,3sw,8w,2nw,2n,*maze*,e,ne,s,e,sw,e,ne,e,
nw,n,sw,*search bushes*`,
    `(arena)s,10w,s,3e,8s,3sw,4w,*enter hole* (to be continued)`,
    `(Main square)6w,sw,nw(small sign),14s,4se,4s,3sw,14s,6se,15s(small tree),19s,11se,6s,w,n`,
    `(Main square)2s,sw,*pry floorboard*,s,e,2se,s,w,7s,2sw,se,s,sw,*wade across lake*,sw,2s`,
    `(Main square)6w,sw,nw(small sign),2n(small sign),4w,nw,w,nw,2w,6n,w`,
    `(Main square)w,s,s,*down the well*,*step on plate*`,
    `(Main square)6n,nw(small sign),n,4ne(small sign),2nw,w,n,ne,e,n,nw,4n,ne,n,e,4ne,u`,
    `(Main square)6n,nw(small sign),n,4ne(small sign),3ne,n,w,nw,n,nw,w,n,e,e,ne,e,s,se,e,s,e,s`,
    `(Main square)6n,nw(small sign),n,4ne(small sign),2nw,w,n,ne,e,ne,3e,2n,2e,2d`,
    `(Main square)6w,sw,nw(small sign),14s,4se,4s,3sw,14s,6se,15s(small tree),13s,w,nw,w,sw,w`,
    `(Main square)6w,sw,nw(small sign),6w,s,2w,sw,s`,
    `(Main square)2s,sw,*pry floorboard*,s,e,2se,s,e`,
    `(Main square)6w,sw,nw,5s,2w,s,w`,
    `(Main square)2s,sw,*pry floorboard*,s`,
    `(Main square)6w,sw,nw(small sign),2n(small sign),4w,nw,w,nw,2w,10n(small sign),
2w,sw,w,nw,2n,8w,nw,3w,2nw,3w,4n,2w,2nww,2nw,
4w(small sign),2s,se,5s,5se,2s,4se,2s,se,2s,2e,se,3s,sw,8s,5se,e`,
  ];
  assert.deepEqual(blocks, expected);
  assert.equal(page.split("diamdond").length - 1, 5);
  assert.equal(page.toLowerCase().includes("catocombs"), false);
  assert.equal(page.includes("samuria"), false);
  assert.equal(page.includes("unaccesible"), false);
  assert.match(page, /Samurai Village is currently inaccessible/);
  assert.match(page, /Missing these areas in Merevia at least: Grasslands, Vampiric Den, Dark Seal, and Phantom Forest/);
  assert.match(page, /<h3 id="d4">D4 — Threshold to Catacombs<\/h3>/);
  for (const id of ["a1", "a8", "b1", "b6", "c1", "c8", "d1", "d13"]) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
});

test("walking directions is linked from wiki navigation and the old URL redirects", async () => {
  const href = "/wiki/world/directions.html";
  const nav = await read("public/wiki/wiki.js");
  const areas = await read("public/wiki/world/areas.html");
  const old = await read("public/wiki/reference/walking-directions.html");
  assert.match(nav, new RegExp(href.replaceAll("/", "\\/")));
  assert.match(areas, new RegExp(href.replaceAll("/", "\\/")));
  assert.match(old, /http-equiv="refresh" content="0;url=\/wiki\/world\/directions"/);
});
