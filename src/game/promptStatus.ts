/**
 * Powermud status prompt (`prompt doh`), shared by the stream parser, GameState and the bots:
 *
 *   [HP: 620(620(100%)) SP: 50(50(100%)) XP: 20400(1600(80%)) Cash: 20617(29297)]
 *
 * HP/SP/PP = current(max(pct%)), XP = total exp(exp to next gain(pct%)),
 * Cash = drakaan carried(drakaan in the bank). The plain `[HP:90 SP:50]` prompt still parses
 * (vitals only). Set it once per character with `prompt doh`.
 */
import type { CharacterStatus } from "./types.js";

export const POWERMUD_STATUS_PROMPT_COMMAND = "prompt doh";

/** Fields the status prompt carries beyond vitals. */
export type PromptStatus = { exp?: number; expToNext?: number; coinValue?: number; bank?: number };

/** Fresh-enough window for trusting prompt exp/drakaan instead of sending `score`. */
export const PROMPT_STATUS_FRESH_MS = 60_000;

/**
 * Status fields from a prompt regex match (groups 7..10 of `POWERMUD_PROFILE.promptPrefix`).
 * Returns undefined for a plain HP/SP prompt.
 */
export function promptStatusFromMatch(m: RegExpMatchArray): PromptStatus | undefined {
  const out: PromptStatus = {};
  if (m[7] !== undefined) out.exp = Number(m[7]);
  if (m[8] !== undefined) out.expToNext = Number(m[8]);
  if (m[9] !== undefined) out.coinValue = Number(m[9]);
  if (m[10] !== undefined) out.bank = Number(m[10]);
  return Object.keys(out).length ? out : undefined;
}

/** True when exp/drakaan came from a status prompt within `maxAgeMs`. */
export function promptStatusFresh(status: CharacterStatus | null | undefined, now = Date.now(), maxAgeMs = PROMPT_STATUS_FRESH_MS): boolean {
  const at = status?.promptStatusAt;
  return typeof at === "number" && now - at <= maxAgeMs && typeof status?.exp === "number";
}
