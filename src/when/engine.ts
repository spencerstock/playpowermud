import { stripAnsi } from "../session/scrollback.js";
import type { WhenRule } from "./types.js";

const MIN_INTERVAL_MS = 500;

/** Strip prompt prefix; ignore client meta so rules only see MUD lines. */
export function normalizeWhenLine(line: string): string | null {
  let s = stripAnsi(line).trim();
  if (!s) return null;
  if (/^\[playpowermud\]/i.test(s)) return null;
  s = s.replace(/^\[HP:[^\]]*\]/i, "").trim();
  return s || null;
}

function lineMatchesRule(rule: WhenRule, line: string): boolean {
  const normalized = normalizeWhenLine(line);
  if (normalized === null) return false;
  return normalized.toLowerCase().includes(rule.match.toLowerCase());
}

/** Match MUD output chunks against ordered `/when` rules. */
export class WhenEngine {
  private lastFired = new Map<number, number>();

  constructor(private rules: WhenRule[]) {}

  setRules(rules: WhenRule[]): void {
    this.rules = rules;
    this.lastFired.clear();
  }

  /** Commands to send for this output chunk (may be empty). */
  commandsForOutput(chunk: string, opts?: { now?: number }): string[] {
    const now = opts?.now ?? Date.now();
    const out: string[] = [];
    const lines = stripAnsi(chunk).split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      for (let i = 0; i < this.rules.length; i++) {
        const rule = this.rules[i]!;
        if (!lineMatchesRule(rule, line)) continue;
        const last = this.lastFired.get(i);
        if (last !== undefined && now - last < MIN_INTERVAL_MS) continue;
        this.lastFired.set(i, now);
        out.push(rule.command);
      }
    }
    return out;
  }
}
