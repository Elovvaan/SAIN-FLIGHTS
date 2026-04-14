/**
 * Field Stabilizer — IMU-driven orientation stabilization via field state.
 *
 * Injects orientation-error corrections into FieldState (phase, bias, intensity)
 * WITHOUT touching motor outputs directly.  All corrections flow through the
 * existing field-solver → actuator pipeline.
 *
 * Control hierarchy:
 *   phase     — PRIMARY   — counteracts pitch / roll error
 *   bias      — SECONDARY — corrects persistent leveling drift
 *   intensity — OPTIONAL  — corrects altitude error when a target is provided
 *
 * Safety contract:
 *   - If imuState.valid is false the input state is returned unchanged.
 *   - If stabConfig.enabled is false the input state is returned unchanged.
 *   - Phase is wrapped to [0, 2π).
 *   - Bias is clamped to [−1, 1].
 *   - Intensity is clamped to [MIN_INTENSITY, MAX_INTENSITY].
 *   - dt ≤ 0 produces a no-op (no corrections applied).
 */

import type { FieldState } from './field-solver';

// ── Constants ─────────────────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI;

/** Minimum intensity when altitude stabilization is active. */
const MIN_INTENSITY = 10;

/** Maximum intensity allowed (matches field-solver's 0–100 scale). */
const MAX_INTENSITY = 100;

/**
 * Per-tick smoothing factor applied to all corrections (0 < α ≤ 1).
 * Limits the magnitude of each incremental correction to prevent oscillation.
 * At 0.3 each tick contributes at most 30 % of the raw correction.
 */
const CORRECTION_SMOOTHING = 0.3;

// ── Types ─────────────────────────────────────────────────────────────────────

/** IMU orientation and altitude snapshot passed to the stabilizer. */
export type ImuState = {
  /** Roll angle in radians (positive = right wing down). */
  roll: number;
  /** Pitch angle in radians (positive = nose up). */
  pitch: number;
  /** Yaw angle in radians. */
  yaw: number;
  /** Altitude in metres (optional; used for intensity / altitude correction). */
  altitude?: number;
  /** Whether this snapshot contains trustworthy sensor data. */
  valid: boolean;
};

/** Gain configuration and enable flag for the field stabilizer. */
export type StabilizerConfig = {
  /** Master switch — when false the stabilizer is a no-op. */
  enabled: boolean;
  /** Phase-correction proportional gain for pitch error (rad/s per rad). */
  kpPitch: number;
  /** Phase-correction proportional gain for roll error (rad/s per rad). */
  kpRoll: number;
  /** Bias-correction gain for pitch error (bias-units/s per rad). */
  kbPitch: number;
  /** Bias-correction gain for roll error (bias-units/s per rad). */
  kbRoll: number;
  /** Intensity-correction gain for altitude error (%/s per metre). */
  kiAlt: number;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply IMU-driven stabilization corrections to a FieldState.
 *
 * Returns a new FieldState with phase, bias, and (optionally) intensity
 * adjusted to counteract orientation and altitude errors.  The input is
 * NOT mutated.
 *
 * @param fieldState  Current field state (before field solver).
 * @param imuState    Latest IMU reading.
 * @param dt          Time delta in seconds since the last update.
 * @param stabConfig  Gain configuration and enable flag.
 * @param targetAltM  Optional hover-altitude target in metres.
 * @returns           Stabilized copy of fieldState.
 */
export function applyFieldStabilization(
  fieldState: FieldState,
  imuState: ImuState,
  dt: number,
  stabConfig: StabilizerConfig,
  targetAltM?: number,
): FieldState {
  // Bypass: stabilization disabled or IMU data is untrustworthy.
  if (!stabConfig.enabled || !imuState.valid) {
    return fieldState;
  }

  // Guard against non-positive dt (first tick, paused loop, clock skew).
  if (dt <= 0) {
    return fieldState;
  }

  // ── Orientation error (target = 0 rad for level hover) ───────────────────

  const rollError  = -imuState.roll;
  const pitchError = -imuState.pitch;

  // ── Phase correction (PRIMARY stabilization) ──────────────────────────────
  //
  // By shifting the field phase we rotate the effective force differential
  // vector to oppose the observed tilt — stabilization without touching motor
  // outputs.  Scaling by dt converts the gains from rad/s to per-tick deltas,
  // and CORRECTION_SMOOTHING limits per-frame magnitude to suppress oscillation.
  //
  // The pitch and roll contributions are combined additively.  This is valid
  // for the 4-node geometry (motors at 0°/90°/180°/270°) because the phase
  // offset between adjacent motors is exactly 90°, meaning pitch and roll
  // corrections are orthogonal in phase space — they do not cross-couple when
  // summed, and the combined phase shift correctly maps to the 2-D orientation
  // error vector.

  const phaseCorrection =
    (pitchError * stabConfig.kpPitch + rollError * stabConfig.kpRoll) *
    dt *
    CORRECTION_SMOOTHING;

  const newPhase = wrapPhase(fieldState.phase + phaseCorrection);

  // ── Bias correction (SECONDARY — drift / balance) ─────────────────────────
  //
  // The bias shifts the adjusted collective base, nudging the vehicle back
  // toward level flight without changing the differential phase pattern.
  // Roll and pitch are summed additively; for the symmetric 4-node layout
  // each axis contributes independently to the scalar collective offset.

  const biasCorrection =
    (rollError * stabConfig.kbRoll + pitchError * stabConfig.kbPitch) *
    dt *
    CORRECTION_SMOOTHING;

  const newBias = clamp(fieldState.bias + biasCorrection, -1, 1);

  // ── Intensity correction (OPTIONAL — altitude stability) ──────────────────

  let newIntensity = fieldState.intensity;
  if (targetAltM !== undefined && imuState.altitude !== undefined) {
    const altError = targetAltM - imuState.altitude;
    const intensityCorrection =
      altError * stabConfig.kiAlt * dt * CORRECTION_SMOOTHING;
    newIntensity = clamp(
      fieldState.intensity + intensityCorrection,
      MIN_INTENSITY,
      MAX_INTENSITY,
    );
  }

  return {
    ...fieldState,
    phase: newPhase,
    bias: newBias,
    intensity: newIntensity,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp v to [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Wrap a phase angle to [0, 2π). */
function wrapPhase(phase: number): number {
  const wrapped = phase % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}
