import assert from "node:assert/strict";
import test from "node:test";
import {
  applyClientConfigToLocalStorage,
  buildClientConfig,
  collectPlaypowermudLocalStorage,
  parseClientConfig,
} from "./clientConfig.js";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

test("collectPlaypowermudLocalStorage keeps only playpowermud keys", () => {
  const s = memoryStorage({
    "playpowermud-skin": "dark",
    "playpowermud-aliases": "{}",
    other: "x",
  });
  assert.deepEqual(collectPlaypowermudLocalStorage(s), {
    "playpowermud-skin": "dark",
    "playpowermud-aliases": "{}",
  });
});

test("parseClientConfig validates kind and localStorage values", () => {
  const doc = buildClientConfig({
    exportedAt: "2026-11-02T00:00:00.000Z",
    localStorage: { "playpowermud-aliases": "{\"a\":\"look\"}" },
  });
  assert.deepEqual(parseClientConfig(doc).localStorage, doc.localStorage);
  assert.throws(() => parseClientConfig({ kind: "other" }), /Expected kind/);
  assert.throws(
    () =>
      parseClientConfig({
        kind: "playpowermud-client-config",
        version: 1,
        exportedAt: "x",
        localStorage: { "playpowermud-skin": 1 },
      }),
    /must be a string/,
  );
});

test("applyClientConfigToLocalStorage replaces playpowermud keys by default", () => {
  const s = memoryStorage({
    "playpowermud-skin": "light",
    "playpowermud-aliases": "{}",
    keep: "yes",
  });
  applyClientConfigToLocalStorage(
    buildClientConfig({
      exportedAt: "2026-11-02T00:00:00.000Z",
      localStorage: { "playpowermud-skin": "dark", "playpowermud-comms:Zim": "[]" },
    }),
    s,
  );
  assert.equal(s.getItem("playpowermud-skin"), "dark");
  assert.equal(s.getItem("playpowermud-aliases"), null);
  assert.equal(s.getItem("playpowermud-comms:Zim"), "[]");
  assert.equal(s.getItem("keep"), "yes");
});
