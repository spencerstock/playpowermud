import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_SESSION_LS,
  applyClientConfigToLocalStorage,
  buildClientConfig,
  buildMapFile,
  collectPlaypowermudLocalStorage,
  parseClientConfig,
  parseMapImport,
} from "./clientConfig.js";
import { emptyWorldGraph } from "../mapper/WorldMap.js";

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
    "playpowermud-active-session": "abc",
    "playpowermud-world-graph": "{}",
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

test("applyClientConfigToLocalStorage leaves the active session pointer alone", () => {
  const s = memoryStorage({
    [ACTIVE_SESSION_LS]: "session-1",
    "playpowermud-skin": "light",
  });
  applyClientConfigToLocalStorage(
    buildClientConfig({
      exportedAt: "2026-11-02T00:00:00.000Z",
      localStorage: { "playpowermud-skin": "dark" },
    }),
    s,
  );
  assert.equal(s.getItem(ACTIVE_SESSION_LS), "session-1");
  assert.equal(s.getItem("playpowermud-skin"), "dark");
});

test("parseMapImport reads a map file, a raw graph, or a config's map", () => {
  const doc = emptyWorldGraph("powermud");
  const block = { baseUpdatedAt: doc.updatedAt, doc };
  assert.equal(parseMapImport(buildMapFile(block, "2026-11-02T00:00:00.000Z")).doc.mud, "powermud");
  assert.equal(parseMapImport(doc).doc.mud, "powermud");
  const config = buildClientConfig({
    exportedAt: "2026-11-02T00:00:00.000Z",
    name: "Alt",
    localStorage: {},
    map: block,
  });
  assert.equal(parseClientConfig(config).name, "Alt");
  assert.equal(parseMapImport(config).baseUpdatedAt, doc.updatedAt);
  assert.throws(() => parseMapImport(buildClientConfig({ exportedAt: "2026-11-02T00:00:00.000Z", localStorage: {} })), /no map/);
});
