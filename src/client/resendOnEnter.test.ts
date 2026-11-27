import assert from "node:assert/strict";
import test from "node:test";
import { RESEND_ON_ENTER_LS, resendOnEnterEnabled, setResendOnEnter } from "./resendOnEnter.js";

function mockStore(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

test("resendOnEnterEnabled defaults on", () => {
  const s = mockStore();
  assert.equal(resendOnEnterEnabled(s), true);
});

test("setResendOnEnter persists off", () => {
  const s = mockStore();
  setResendOnEnter(false, s);
  assert.equal(s.getItem(RESEND_ON_ENTER_LS), "0");
  assert.equal(resendOnEnterEnabled(s), false);
  setResendOnEnter(true, s);
  assert.equal(resendOnEnterEnabled(s), true);
});