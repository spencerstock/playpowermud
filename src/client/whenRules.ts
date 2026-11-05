import { WhenEngine } from "../when/engine.js";
import type { WhenRule } from "../when/types.js";

const WHEN_LS = "playpowermud-when";
const MAX_MATCH_LEN = 500;
const MAX_COMMAND_LEN = 2000;

export type WhenStorage = Pick<Storage, "getItem" | "setItem">;

/** Client `/when` rules in localStorage; list order is `/unwhen NUMBER`. */
export class WhenRulesStore {
  private rules: WhenRule[] = [];
  private readonly engine = new WhenEngine([]);

  constructor(private readonly storage: WhenStorage | null = safeLocalStorage()) {
    this.load();
  }

  private load(): void {
    this.rules = [];
    try {
      const raw = this.storage?.getItem(WHEN_LS);
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
    this.engine.setRules(this.rules);
  }

  private save(): void {
    this.engine.setRules(this.rules);
    try {
      this.storage?.setItem(WHEN_LS, JSON.stringify(this.rules));
    } catch {
      /* rules still work for this tab */
    }
  }

  all(): readonly WhenRule[] {
    return this.rules;
  }

  add(match: string, command: string): { ok: true } | { ok: false; reason: string } {
    const trigger = match.trim();
    const cmd = command.trim();
    if (!trigger) return { ok: false, reason: "missing trigger" };
    if (!cmd) return { ok: false, reason: "missing command" };
    if (trigger.length > MAX_MATCH_LEN) return { ok: false, reason: `trigger exceeds ${MAX_MATCH_LEN} characters` };
    if (cmd.length > MAX_COMMAND_LEN) return { ok: false, reason: `command exceeds ${MAX_COMMAND_LEN} characters` };
    for (const r of this.rules) {
      if (r.match === trigger && r.command === cmd) {
        return { ok: false, reason: "that when command already exists" };
      }
    }
    this.rules.push({ match: trigger, command: cmd });
    this.save();
    return { ok: true };
  }

  /** `index` is 1-based, as shown by `/when`. */
  removeAt(index: number): boolean {
    const i = index - 1;
    if (i < 0 || i >= this.rules.length) return false;
    this.rules.splice(i, 1);
    this.save();
    return true;
  }

  commandsForOutput(chunk: string, opts?: { now?: number }): string[] {
    return this.engine.commandsForOutput(chunk, opts);
  }
}

function normalizeRule(item: unknown): WhenRule | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const match = typeof o.match === "string" ? o.match.trim() : "";
  const command = typeof o.command === "string" ? o.command.trim() : "";
  if (!match || !command) return null;
  return { match, command };
}

function safeLocalStorage(): WhenStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
