import assert from "node:assert/strict";
import test from "node:test";
import type { CommsEntry } from "../game/commsLogIngest.js";
import { WorldMap } from "../mapper/WorldMap.js";
import type { BrowserMapStore } from "./mapStore.js";
import { ClientRuntime } from "./runtime.js";

function runtime(): ClientRuntime {
  const store = { map: WorldMap.empty("powermud"), schedule() {}, async flush() {} };
  return new ClientRuntime(store as unknown as BrowserMapStore);
}

test("tells reach comms even when split across network chunks", () => {
  const rt = runtime();
  const seen: CommsEntry[] = [];
  rt.onComms((entry) => entry && seen.push(entry));
  rt.onConnected();
  rt.onMudData("Lorax tells you: hel");
  assert.equal(seen.length, 0);
  rt.onMudData("lo there\r\n");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.kind, "tell");
  assert.equal(seen[0]!.speaker, "Lorax");
  assert.match(seen[0]!.message, /hello there/);
  rt.clearComms();
  assert.deepEqual(rt.commsSnapshot(), []);
});

test("login prompts drive the game phase (password masking)", () => {
  const rt = runtime();
  rt.onConnected();
  rt.onMudData("What is your user name? (Or 'who', 'exit' or '#<character name>') : ");
  rt.onMudData("\r\nPassword: ");
  assert.equal(rt.state.phase, "login-password");
});
