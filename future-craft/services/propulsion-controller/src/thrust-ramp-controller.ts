/**
 * Thrust Ramp Controller — soft-start intensity interpolation.
 *
 * Provides a time-based linear interpolation (lerp) from a minimum safe
 * intensity to a target intensity over a configurable ramp duration.  This
 * prevents instant high-throttle application during the first real-world lift
 * attempt.
 *
 * Safety contract:
 *   - Intensity is always clamped to [minIntensity, targetIntensity].
 *   - A ramp duration ≤ 0 immediately returns targetIntensity.
 *   - The ramp is pure and deterministic — no internal state is mutated.
 *   - NaN inputs are treated as zero (safe fallback).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Configuration for a single ramp profile. */
export type RampConfig = {
  /**
   * Starting intensity (% of full scale, 0–100).
   * For SAFE_LIFT_MODE this should be 10 (i.e. 10 %).
   */
  minIntensity: number;
  /**
   * Target intensity once the ramp completes (% of full scale, 0–100).
   * For SAFE_LIFT_MODE this should be ≤ 35 (safe-band upper limit).
   */
  targetIntensity: number;
  /**
   * Time taken to travel from minIntensity to targetIntensity (milliseconds).
   * Recommended range: 2 000 – 5 000 ms.
   */
  rampDurationMs: number;
};

/** Defaults for SAFE_LIFT_MODE — conservative values for first lift. */
export const SAFE_LIFT_RAMP_DEFAULTS: RampConfig = {
  minIntensity: 10,
  targetIntensity: 35,
  rampDurationMs: 3000,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Linear interpolation between `a` and `b` by factor `t` (clamped to [0, 1]).
 *
 * lerp(10, 35, 0)   → 10
 * lerp(10, 35, 0.5) → 22.5
 * lerp(10, 35, 1)   → 35
 */
export function lerp(a: number, b: number, t: number): number {
  const tc = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const av = Number.isFinite(a) ? a : 0;
  const bv = Number.isFinite(b) ? b : 0;
  return av + (bv - av) * tc;
}

/**
 * Compute the ramped intensity for the current moment in time.
 *
 * @param rampStartMs  Epoch millisecond timestamp when the ramp was started.
 * @param nowMs        Current epoch millisecond timestamp.
 * @param config       Ramp profile (min, target, duration).
 * @returns            Intensity in [minIntensity, targetIntensity].
 */
export function computeRampedIntensity(
  rampStartMs: number,
  nowMs: number,
  config: RampConfig,
): number {
  const { minIntensity, targetIntensity, rampDurationMs } = config;

  // Immediately return target for degenerate duration.
  if (rampDurationMs <= 0) {
    return clamp(targetIntensity, minIntensity, targetIntensity);
  }

  const elapsed = Math.max(0, nowMs - rampStartMs);
  const t = elapsed / rampDurationMs;
  const raw = lerp(minIntensity, targetIntensity, t);
  return clamp(raw, minIntensity, targetIntensity);
}

/**
 * Returns true when the ramp has completed (elapsed ≥ rampDurationMs).
 *
 * @param rampStartMs  Epoch millisecond timestamp when the ramp was started.
 * @param nowMs        Current epoch millisecond timestamp.
 * @param config       Ramp profile.
 */
export function isRampComplete(
  rampStartMs: number,
  nowMs: number,
  config: RampConfig,
): boolean {
  if (config.rampDurationMs <= 0) return true;
  return nowMs - rampStartMs >= config.rampDurationMs;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
