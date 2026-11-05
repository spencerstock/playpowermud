import { bindingFromStoredKey, eventMatchesBinding, normalizeKeySpec, parseKeyBinding } from "../hotkey/keySpec.js";
import type { HotkeyRule } from "../hotkey/types.js";

const HOTKEY_LS = "playpowermud-hotkey";
const MAX_KEY_LEN = 80;
const MAX_COMMAND_LEN = 2000;

export type HotkeyStorage = Pick<Storage, "getItem" | "setItem">;

/** Client `/hotkey` bindings in localStorage; list order is `/unhotkey NUMBER`. */
export class HotkeyRulesStore {
  private rules: HotkeyRule[] = [];

  constructor(private readonly storage: HotkeyStorage | null = safeLocalStorage()) {
    this.load();
  }

  private load(): void {
    this.rules = [];
    try {
      const raw = this.storage?.getItem(HOTKEY_LS);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(list)) {
        for (const item of list) {
          const norm = normalizeRule(item);
          if (norm) this.rules.push(norm);
        }
      }
    } catch {
      /* corrupt or blocked storage */
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(HOTKEY_LS, JSON.stringify(this.rules));
    } catch {
      /* rules still work for this tab */
    }
  }

  all(): readonly HotkeyRule[] {
    return this.rules;
  }

  add(key: string, command: string): { ok: true } | { ok: false; reason: string } {
    const cmd = command.trim();
    if (!cmd) return { ok: false, reason: "missing command" };
    if (cmd.length > MAX_COMMAND_LEN) return { ok: false, reason: `command exceeds ${MAX_COMMAND_LEN} characters` };
    if (key.length > MAX_KEY_LEN) return { ok: false, reason: `key exceeds ${MAX_KEY_LEN} characters` };

    const normalized = normalizeKeySpec(key);
    if (!normalized.ok) return normalized;

    for (const r of this.rules) {
      if (r.key === normalized.key && r.command === cmd) {
        return { ok: false, reason: "that hotkey already exists" };
      }
    }
    this.rules.push({ key: normalized.key, command: cmd });
    this.save();
    return { ok: true };
  }

  /** `index` is 1-based, as shown by `/hotkey`. */
  removeAt(index: number): boolean {
    const i = index - 1;
    if (i < 0 || i >= this.rules.length) return false;
    this.rules.splice(i, 1);
    this.save();
    return true;
  }

  commandForEvent(e: KeyboardEvent): string | null {
    for (const rule of this.rules) {
      const binding = bindingFromStoredKey(rule.key);
      if (binding && eventMatchesBinding(e, binding)) return rule.command;
    }
    return null;
  }
}

function normalizeRule(item: unknown): HotkeyRule | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const keyRaw = typeof o.key === "string" ? o.key.trim() : "";
  const command = typeof o.command === "string" ? o.command.trim() : "";
  if (!keyRaw || !command) return null;
  const normalized = normalizeKeySpec(keyRaw);
  if (!normalized.ok) {
    const legacy = parseKeyBinding(keyRaw);
    if (!legacy.ok) return null;
    return { key: keyRaw, command };
  }
  return { key: normalized.key, command };
}

function safeLocalStorage(): HotkeyStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
