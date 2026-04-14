/**
 * Field Translator — velocity-driven directional translation via field state.
 *
 * Converts velocityX / velocityY commands into phase and bias offsets that
 * shift the field center, producing directional movement WITHOUT tilting the
 * craft.  All corrections flow through the existing field-solver → actuator
 * pipeline.
 *
 * Concept:
 *   Movement = FIELD OFFSET (not orientation change)
 *   velocityX / velocityY shift the field phase / bias — the craft translates
 *   without motor imbalance or orientation change.
 *
 * Safety contract:
 *   - If translatorConfig.enabled is false the input state is returned unchanged.
 *   - Phase is wrapped to [0, 2π).
 *   - Bias is clamped to [−1, 1].
 *   - dt ≤ 0 produces a no-op (no corrections applied).
 *   - velocityX / velocityY are treated as 0 when absent from state.
 */

import type { FieldState } from './field-solver';

// ── Constants ─────────────────────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Gain configuration and enable flag for the field translator. */
export type TranslatorConfig = {
  /** Master switch — when false the translator is a no-op. */
  enabled: boolean;
  /**
   * Gain applied to the translation phase offset.
   * Converts unit velocity into phase radians per second.
   */
  translationGain: number;
  /**
   * Gain applied to the lateral bias assist.
   * Converts unit velocity into bias-units per second.
   */
  biasGain: number;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply velocity-driven field translation to a FieldState.
 *
 * Projects the XY velocity vector onto the current field phase axis and adds
 * the resulting offset to the phase.  A small bias assist is also applied to
 * provide a lateral push without changing orientation.
 *
 * Must be called AFTER applyFieldStabilization() and BEFORE solveField() so
 * that orientation corrections are preserved and translation is layered on top.
 *
 * @param fieldState        Current field state (after stabilization).
 * @param dt                Time delta in seconds since the last update.
 * @param translatorConfig  Gain configuration and enable flag.
 * @returns                 Translated copy of fieldState (input is not mutated).
 */
export function translateField(
  fieldState: FieldState,
  dt: number,
  translatorConfig: TranslatorConfig,
): FieldState {
  // Bypass: translation disabled.
  if (!translatorConfig.enabled) {
    return fieldState;
  }

  // Guard against non-positive dt (first tick, paused loop, clock skew).
  if (dt <= 0) {
    return fieldState;
  }

  const velocityX = fieldState.velocityX ?? 0;
  const velocityY = fieldState.velocityY ?? 0;

  // Short-circuit: no velocity, no translation.
  if (velocityX === 0 && velocityY === 0) {
    return fieldState;
  }

  // ── Phase offset (converts XY velocity into directional field shift) ──────
  //
  // Project the velocity vector onto the rotating field phase axis:
  //   translationPhase = (velocityX × cos(phase)) + (velocityY × sin(phase))
  //
  // This rotates the effective field center in the XY plane, driving the craft
  // in the requested direction without changing the craft's orientation.

  const translationPhase =
    velocityX * Math.cos(fieldState.phase) +
    velocityY * Math.sin(fieldState.phase);

  const newPhase = wrapPhase(
    fieldState.phase + translationPhase * translatorConfig.translationGain * dt,
  );

  // ── Bias assist (lateral collective push) ────────────────────────────────
  //
  // A small collective bias supplement nudges the vehicle in the combined
  // translation direction.  Clamped to [−1, 1] to stay within field-solver
  // limits.

  const biasAssist =
    (velocityX + velocityY) * translatorConfig.biasGain * dt;

  const newBias = clamp(fieldState.bias + biasAssist, -1, 1);

  return {
    ...fieldState,
    phase: newPhase,
    bias: newBias,
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
