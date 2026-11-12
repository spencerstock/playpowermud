/** Durations at or above this are returned unchanged. */
export const VARIABLE_TIME_MAX_MS = 10_000;

/** Max random offset as a fraction of the base duration (±50%). */
export const VARIABLE_TIME_JITTER = 0.5;

/**
 * Humanize short waits: for base durations under {@link VARIABLE_TIME_MAX_MS}, return a value
 * uniformly distributed in `[base * (1 - jitter), base * (1 + jitter)]`.
 */
export function variableTime(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return ms;
  if (ms >= VARIABLE_TIME_MAX_MS) return ms;
  const spread = ms * VARIABLE_TIME_JITTER;
  return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * spread));
}
