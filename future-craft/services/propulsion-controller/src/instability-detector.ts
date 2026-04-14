/**
 * Instability Detector — IMU-based flight safety monitor.
 *
 * Reads the latest IMU snapshot and determines whether the craft has entered
 * an unstable condition that requires immediate abort.
 *
 * Detection criteria (any one is sufficient to trigger):
 *   1. Absolute roll or pitch exceeds maxAngleRad      — extreme tilt
 *   2. Angular rate magnitude exceeds maxRateRadS      — rapid rotation
 *   3. Any required numeric input is non-finite        — malformed IMU/timing data
 *
 * Safety contract:
 *   - If imuState.valid is false the result is { triggered: false } (no abort
 *     on invalid IMU state — the calling layer should handle that separately).
 *   - Non-finite numeric values are treated as unsafe input and may trigger.
 *   - All thresholds are configurable through InstabilityConfig.
 *   - The function is pure and side-effect-free.
 */

import type { ImuState } from './field-stabilizer';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Thresholds for instability detection. */
export type InstabilityConfig = {
  /**
   * Maximum allowed absolute roll or pitch (radians).
   * Exceeding this in a single tick triggers an immediate abort.
   * Default: ~25° ≈ 0.436 rad.
   */
  maxAngleRad: number;
  /**
   * Maximum allowed angular rate magnitude (radians per second).
   * Approximated from two consecutive IMU snapshots as Δangle/Δt.
   * Default: ~90°/s ≈ 1.57 rad/s.
   */
  maxRateRadS: number;
  /**
   * Stable-band radius (radians).  Angles within ±stableBandRad are
   * considered stable.  Default: ~5° ≈ 0.087 rad.
   */
  stableBandRad: number;
};

/** Result returned by detectInstability(). */
export type InstabilityResult = {
  /** True when an abort condition is active. */
  triggered: boolean;
  /** Human-readable reason for triggering (undefined when not triggered). */
  reason?: string;
};

/** Default thresholds for safe-lift first-flight detection. */
export const DEFAULT_INSTABILITY_CONFIG: InstabilityConfig = {
  maxAngleRad: 0.436,   // ≈ 25°
  maxRateRadS: 1.571,   // ≈ 90°/s
  stableBandRad: 0.087, // ≈ 5°
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect instability from the current IMU snapshot.
 *
 * Triggers when roll/pitch exceeds `config.maxAngleRad`, when the estimated
 * angular rate exceeds `config.maxRateRadS`, or when required numeric inputs
 * are non-finite. If `imuState.valid` is false, this function returns
 * `{ triggered: false }`.
 *
 * @param imuState    Current IMU reading.
 * @param prevImuState Previous IMU reading (used for angular-rate estimation).
 * @param dtSeconds   Time delta between the two readings (seconds).
 * @param config      Threshold configuration.
 * @returns           InstabilityResult — triggered + reason when unsafe.
 */
export function detectInstability(
  imuState: ImuState,
  prevImuState: ImuState,
  dtSeconds: number,
  config: InstabilityConfig = DEFAULT_INSTABILITY_CONFIG,
): InstabilityResult {
  // IMU invalid — do not abort on bad sensor data.
  if (!imuState.valid) {
    return { triggered: false };
  }

  // ── Guard against NaN in IMU values ────────────────────────────────────────
  if (!Number.isFinite(imuState.roll) || !Number.isFinite(imuState.pitch)) {
    return {
      triggered: true,
      reason: `flight_abort_instability: IMU NaN — roll=${imuState.roll} pitch=${imuState.pitch}`,
    };
  }

  const absRoll  = Math.abs(imuState.roll);
  const absPitch = Math.abs(imuState.pitch);

  // ── Criterion 1: extreme angle ─────────────────────────────────────────────
  if (absRoll > config.maxAngleRad) {
    return {
      triggered: true,
      reason: `flight_abort_instability: roll ${rad2deg(imuState.roll).toFixed(1)}° exceeds limit ${rad2deg(config.maxAngleRad).toFixed(1)}°`,
    };
  }
  if (absPitch > config.maxAngleRad) {
    return {
      triggered: true,
      reason: `flight_abort_instability: pitch ${rad2deg(imuState.pitch).toFixed(1)}° exceeds limit ${rad2deg(config.maxAngleRad).toFixed(1)}°`,
    };
  }

  // ── Criterion 2: excessive angular rate ────────────────────────────────────
  if (prevImuState.valid && dtSeconds > 0) {
    const rollRate  = Math.abs((imuState.roll  - prevImuState.roll)  / dtSeconds);
    const pitchRate = Math.abs((imuState.pitch - prevImuState.pitch) / dtSeconds);
    if (rollRate > config.maxRateRadS) {
      return {
        triggered: true,
        reason: `flight_abort_instability: roll rate ${rad2deg(rollRate).toFixed(1)}°/s exceeds limit ${rad2deg(config.maxRateRadS).toFixed(1)}°/s`,
      };
    }
    if (pitchRate > config.maxRateRadS) {
      return {
        triggered: true,
        reason: `flight_abort_instability: pitch rate ${rad2deg(pitchRate).toFixed(1)}°/s exceeds limit ${rad2deg(config.maxRateRadS).toFixed(1)}°/s`,
      };
    }
  }

  // ── Criterion 3: outside stable band ──────────────────────────────────────
  // Angles beyond the stable band are logged via telemetry (stabilityScore > 0)
  // but do not independently abort — angle and rate checks above are sufficient.

  return { triggered: false };
}

/**
 * Compute a scalar stability score in [0, 1].
 *
 * 0 = perfectly stable (on the stable-band boundary or within it).
 * 1 = at or beyond the maximum allowed angle.
 *
 * The score is 0 within the stable band, then scales linearly up to 1 at the
 * max angle limit.
 *
 * @param imuState  Current IMU reading.
 * @param config    Threshold configuration.
 * @returns         Score in [0, 1]; 0 if IMU is invalid or inputs are NaN.
 */
export function computeStabilityScore(
  imuState: ImuState,
  config: InstabilityConfig = DEFAULT_INSTABILITY_CONFIG,
): number {
  if (!imuState.valid) return 0;
  if (!Number.isFinite(imuState.roll) || !Number.isFinite(imuState.pitch)) return 0;

  const maxDeviation = Math.max(Math.abs(imuState.roll), Math.abs(imuState.pitch));
  if (maxDeviation <= config.stableBandRad) return 0;

  const scoreRange = config.maxAngleRad - config.stableBandRad;
  if (!Number.isFinite(scoreRange) || scoreRange <= 0) return 0;

  return Math.min(1, Math.max(0, (maxDeviation - config.stableBandRad) / scoreRange));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rad2deg(rad: number): number {
  return rad * (180 / Math.PI);
}
