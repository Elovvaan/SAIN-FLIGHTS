/**
 * Field solver — Version-1 tangential-field control model.
 *
 * Converts a FieldState into 4 per-motor output values for a quad-rotor
 * with motors at 90° spacing (A = front-right, B = rear-right,
 * C = rear-left, D = front-left).
 *
 * Base model:
 *   Motor A = base + amplitude × sin(phase + 0°)
 *   Motor B = base + amplitude × sin(phase + 90°)
 *   Motor C = base + amplitude × sin(phase + 180°)
 *   Motor D = base + amplitude × sin(phase + 270°)
 *
 * All outputs are clamped to [0, 1] and are always motor-safe (never NaN).
 * Both functions are pure — no side effects, fully deterministic, testable.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Phase offsets for motors A / B / C / D at 90° increments (radians). */
const MOTOR_PHASE_OFFSETS: readonly [number, number, number, number] = [
  0,
  Math.PI / 2,
  Math.PI,
  (3 * Math.PI) / 2,
];

/**
 * Sine-modulation depth as a fraction of the adjusted base output.
 * At 0.3 the modulation envelope is at most 30 % of the base thrust,
 * ensuring outputs remain in [0, 1] without hard clipping under normal
 * operating conditions.
 */
const MODULATION_FRACTION = 0.3;

/**
 * Maximum base-output shift produced by a unit of bias (±1).
 * 0.2 allows the collective to be nudged ±20 % of full output range.
 */
const BIAS_SCALE = 0.2;

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldState = {
  /** Master lift / energy level, normalised 0–100. */
  intensity: number;
  /** Current phase angle in radians. */
  phase: number;
  /** Phase advance rate in radians per second. */
  phaseVelocity: number;
  /** Rotation direction: 1 = clockwise, −1 = counter-clockwise. */
  spin: 1 | -1;
  /**
   * Contraction / expansion bias in the range −1 to +1.
   * Positive = expansion (higher collective), negative = contraction.
   */
  bias: number;
  /**
   * When false, solveField() returns equal base outputs for all motors
   * (field modulation is bypassed — equivalent to avgLift mode).
   */
  enabled: boolean;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Advance the phase of a FieldState by `dtSeconds`.
 * Returns a new FieldState — input is not mutated.
 */
export function advancePhase(state: FieldState, dtSeconds: number): FieldState {
  return {
    ...state,
    phase: state.phase + state.phaseVelocity * state.spin * dtSeconds,
  };
}

/**
 * Compute per-motor outputs from a FieldState.
 *
 * When `state.enabled` is false, all four outputs equal the bias-adjusted
 * base (no differential — equivalent to equal-throttle mode).
 *
 * @returns Tuple [A, B, C, D], each clamped to [0, 1].
 */
export function solveField(
  state: FieldState,
): [number, number, number, number] {
  // Clamp inputs before any computation.
  const intensity = Math.max(0, Math.min(100, state.intensity));
  const bias = Math.max(-1, Math.min(1, state.bias));

  // Normalised base lift (0..1).
  const base = intensity / 100;

  // Bias shifts the collective.
  const adjustedBase = Math.max(0, Math.min(1, base + bias * BIAS_SCALE));

  if (!state.enabled) {
    // Field mode disabled: all motors receive identical base output.
    return [adjustedBase, adjustedBase, adjustedBase, adjustedBase];
  }

  // Amplitude is proportional to the adjusted base so the modulation envelope
  // scales naturally with collective and cannot produce negative thrust on its
  // own (amplitude ≤ adjustedBase × 0.3 ≤ adjustedBase).
  const amplitude = adjustedBase * MODULATION_FRACTION;

  // Spin direction is applied by negating the phase for CCW rotation.
  const effectivePhase = state.phase * state.spin;

  return [
    clamp01(adjustedBase + amplitude * Math.sin(effectivePhase + MOTOR_PHASE_OFFSETS[0])),
    clamp01(adjustedBase + amplitude * Math.sin(effectivePhase + MOTOR_PHASE_OFFSETS[1])),
    clamp01(adjustedBase + amplitude * Math.sin(effectivePhase + MOTOR_PHASE_OFFSETS[2])),
    clamp01(adjustedBase + amplitude * Math.sin(effectivePhase + MOTOR_PHASE_OFFSETS[3])),
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
