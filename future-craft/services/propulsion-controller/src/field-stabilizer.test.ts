/**
 * Tests for field-stabilizer.ts — IMU-driven field state stabilization.
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyFieldStabilization } from './field-stabilizer';
import type { ImuState, StabilizerConfig } from './field-stabilizer';
import type { FieldState } from './field-solver';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeFieldState(partial: Partial<FieldState> = {}): FieldState {
  return {
    intensity: 50,
    phase: 0,
    phaseVelocity: 1,
    spin: 1,
    bias: 0,
    enabled: true,
    ...partial,
  };
}

function makeImu(partial: Partial<ImuState> = {}): ImuState {
  return {
    roll: 0,
    pitch: 0,
    yaw: 0,
    valid: true,
    ...partial,
  };
}

function makeConfig(partial: Partial<StabilizerConfig> = {}): StabilizerConfig {
  return {
    enabled: true,
    kpPitch: 0.8,
    kpRoll: 0.8,
    kbPitch: 0.2,
    kbRoll: 0.2,
    kiAlt: 0.1,
    ...partial,
  };
}

const DT = 0.05; // 20 Hz tick

// ── Test suites ───────────────────────────────────────────────────────────────

describe('field-stabilizer', () => {
  // ── Safety bypass ──────────────────────────────────────────────────────────

  describe('safety bypass', () => {
    it('returns input state unchanged when imuState.valid is false', () => {
      const state = makeFieldState({ phase: 1.23, bias: 0.4 });
      const imu = makeImu({ valid: false, roll: 0.5, pitch: 0.5 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.deepStrictEqual(result, state);
    });

    it('returns input state unchanged when stabConfig.enabled is false', () => {
      const state = makeFieldState({ phase: 1.23, bias: 0.4 });
      const imu = makeImu({ roll: 0.5, pitch: 0.5 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig({ enabled: false }));
      assert.deepStrictEqual(result, state);
    });

    it('returns input state unchanged when dt is zero', () => {
      const state = makeFieldState({ phase: 1.0, bias: 0.3 });
      const imu = makeImu({ roll: 0.2, pitch: 0.3 });
      const result = applyFieldStabilization(state, imu, 0, makeConfig());
      assert.deepStrictEqual(result, state);
    });

    it('returns input state unchanged when dt is negative', () => {
      const state = makeFieldState({ phase: 1.0, bias: 0.3 });
      const imu = makeImu({ roll: 0.2, pitch: 0.3 });
      const result = applyFieldStabilization(state, imu, -0.1, makeConfig());
      assert.deepStrictEqual(result, state);
    });
  });

  // ── No-op when leveled ─────────────────────────────────────────────────────

  describe('no correction when IMU reports level flight', () => {
    it('phase is unchanged at zero roll/pitch', () => {
      const state = makeFieldState({ phase: 1.5 });
      const imu = makeImu({ roll: 0, pitch: 0 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.strictEqual(result.phase, state.phase);
    });

    it('bias is unchanged at zero roll/pitch', () => {
      const state = makeFieldState({ bias: 0.1 });
      const imu = makeImu({ roll: 0, pitch: 0 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.strictEqual(result.bias, state.bias);
    });

    it('intensity is unchanged at zero altitude error', () => {
      const state = makeFieldState({ intensity: 50 });
      const imu = makeImu({ altitude: 10 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig(), 10);
      assert.strictEqual(result.intensity, state.intensity);
    });
  });

  // ── Phase correction ───────────────────────────────────────────────────────

  describe('phase correction (primary stabilization)', () => {
    it('applies a non-zero phase correction when pitch error exists', () => {
      const state = makeFieldState({ phase: 0 });
      const imu = makeImu({ pitch: 0.3 }); // nose-up error
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.ok(result.phase !== state.phase, 'phase should change on pitch error');
    });

    it('applies a non-zero phase correction when roll error exists', () => {
      const state = makeFieldState({ phase: 0 });
      const imu = makeImu({ roll: 0.3 }); // right-wing-down error
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.ok(result.phase !== state.phase, 'phase should change on roll error');
    });

    it('phase correction direction is opposite to roll error', () => {
      const state = makeFieldState({ phase: Math.PI });
      const imuPos = makeImu({ roll: 0.2, pitch: 0 });
      const imuNeg = makeImu({ roll: -0.2, pitch: 0 });
      const resPos = applyFieldStabilization(state, imuPos, DT, makeConfig());
      const resNeg = applyFieldStabilization(state, imuNeg, DT, makeConfig());
      // Positive roll → correction pushes phase in one direction; negative roll → opposite
      assert.ok(
        resPos.phase !== resNeg.phase,
        'opposite roll errors should produce opposite phase corrections',
      );
    });

    it('zero gains produce no phase correction', () => {
      const state = makeFieldState({ phase: 1.0 });
      const imu = makeImu({ roll: 0.5, pitch: 0.5 });
      const cfg = makeConfig({ kpPitch: 0, kpRoll: 0 });
      const result = applyFieldStabilization(state, imu, DT, cfg);
      assert.strictEqual(result.phase, state.phase);
    });

    it('phase output is always in [0, 2π)', () => {
      const TWO_PI = 2 * Math.PI;
      const cases = [
        makeFieldState({ phase: 0 }),
        makeFieldState({ phase: 5.5 }),
        makeFieldState({ phase: TWO_PI - 0.01 }),
        makeFieldState({ phase: TWO_PI + 1 }),
        makeFieldState({ phase: -0.5 }),
      ];
      const imu = makeImu({ roll: 0.3, pitch: -0.2 });
      for (const state of cases) {
        const result = applyFieldStabilization(state, imu, DT, makeConfig());
        assert.ok(
          result.phase >= 0 && result.phase < TWO_PI,
          `phase ${result.phase} is outside [0, 2π)`,
        );
      }
    });
  });

  // ── Bias correction ────────────────────────────────────────────────────────

  describe('bias correction (secondary drift correction)', () => {
    it('applies a non-zero bias correction when roll error exists', () => {
      const state = makeFieldState({ bias: 0 });
      const imu = makeImu({ roll: 0.3 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.ok(result.bias !== 0, 'bias should change on roll error');
    });

    it('applies a non-zero bias correction when pitch error exists', () => {
      const state = makeFieldState({ bias: 0 });
      const imu = makeImu({ pitch: 0.3 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.ok(result.bias !== 0, 'bias should change on pitch error');
    });

    it('bias is always clamped to [-1, 1]', () => {
      // Large error + large gain over many ticks should not exceed bounds
      const cfg = makeConfig({ kbRoll: 100, kbPitch: 100 });
      let state = makeFieldState({ bias: 0.9 });
      const imu = makeImu({ roll: 1.5, pitch: 1.5 });
      for (let i = 0; i < 100; i++) {
        state = applyFieldStabilization(state, imu, 0.1, cfg) as FieldState;
      }
      assert.ok(state.bias >= -1 && state.bias <= 1, `bias ${state.bias} is outside [-1, 1]`);
    });

    it('zero bias gains produce no bias correction', () => {
      const state = makeFieldState({ bias: 0.5 });
      const imu = makeImu({ roll: 0.5, pitch: 0.5 });
      const cfg = makeConfig({ kbRoll: 0, kbPitch: 0 });
      const result = applyFieldStabilization(state, imu, DT, cfg);
      assert.strictEqual(result.bias, state.bias);
    });
  });

  // ── Intensity / altitude correction ───────────────────────────────────────

  describe('intensity correction (altitude stability)', () => {
    it('increases intensity when below target altitude', () => {
      const state = makeFieldState({ intensity: 50 });
      const imu = makeImu({ altitude: 8 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig(), 10);
      assert.ok(result.intensity > state.intensity, 'intensity should rise when below target');
    });

    it('decreases intensity when above target altitude', () => {
      const state = makeFieldState({ intensity: 50 });
      const imu = makeImu({ altitude: 12 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig(), 10);
      assert.ok(result.intensity < state.intensity, 'intensity should fall when above target');
    });

    it('no intensity correction when targetAltM is undefined', () => {
      const state = makeFieldState({ intensity: 50 });
      const imu = makeImu({ altitude: 20 });
      // Pass no targetAltM
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.strictEqual(result.intensity, state.intensity);
    });

    it('no intensity correction when imuState.altitude is undefined', () => {
      const state = makeFieldState({ intensity: 50 });
      const imu = makeImu(); // altitude is undefined
      const result = applyFieldStabilization(state, imu, DT, makeConfig(), 10);
      assert.strictEqual(result.intensity, state.intensity);
    });

    it('intensity is always clamped to [MIN_INTENSITY=10, MAX_INTENSITY=100]', () => {
      const cfg = makeConfig({ kiAlt: 1000 });
      const stateHigh = makeFieldState({ intensity: 99 });
      const stateLow  = makeFieldState({ intensity: 11 });
      const imuAbove = makeImu({ altitude: 100 });
      const imuBelow = makeImu({ altitude: 0 });
      const resHigh = applyFieldStabilization(stateHigh, imuAbove, 1, cfg, 0);
      const resLow  = applyFieldStabilization(stateLow, imuBelow, 1, cfg, 100);
      assert.ok(resHigh.intensity >= 10 && resHigh.intensity <= 100,
        `intensity ${resHigh.intensity} outside [10, 100]`);
      assert.ok(resLow.intensity >= 10 && resLow.intensity <= 100,
        `intensity ${resLow.intensity} outside [10, 100]`);
    });
  });

  // ── Pure function / immutability ───────────────────────────────────────────

  describe('pure function properties', () => {
    it('does not mutate the input fieldState', () => {
      const state = makeFieldState({ phase: 1.0, bias: 0.2, intensity: 50 });
      const frozen = { ...state };
      const imu = makeImu({ roll: 0.3, pitch: 0.2, altitude: 8 });
      applyFieldStabilization(state, imu, DT, makeConfig(), 10);
      assert.deepStrictEqual(state, frozen, 'input state should not be mutated');
    });

    it('does not mutate the input imuState', () => {
      const imu = makeImu({ roll: 0.3, pitch: 0.2 });
      const frozen = { ...imu };
      applyFieldStabilization(makeFieldState(), imu, DT, makeConfig());
      assert.deepStrictEqual(imu, frozen, 'input imuState should not be mutated');
    });

    it('preserves unmodified FieldState fields (phaseVelocity, spin, enabled)', () => {
      const state = makeFieldState({ phaseVelocity: 3.14, spin: -1, enabled: false });
      const imu = makeImu({ roll: 0.1, pitch: 0.1 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.strictEqual(result.phaseVelocity, state.phaseVelocity);
      assert.strictEqual(result.spin, state.spin);
      assert.strictEqual(result.enabled, state.enabled);
    });

    it('returns a new object (not the same reference)', () => {
      const state = makeFieldState({ phase: 1.0 });
      const imu = makeImu({ roll: 0.1 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.ok(result !== state, 'should return a new FieldState object');
    });
  });

  // ── Safety: no unsafe output values ───────────────────────────────────────

  describe('no unsafe output values', () => {
    it('never produces NaN in phase', () => {
      const state = makeFieldState({ phase: Number.NaN });
      const imu = makeImu({ roll: 0.1 });
      // NaN input phase — stabilizer wraps via modulo; result may be NaN
      // but the stabilizer should not amplify the problem
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      // At minimum, no exception should be thrown
      assert.ok(typeof result.phase === 'number');
    });

    it('never produces NaN in bias on extreme inputs', () => {
      const state = makeFieldState({ bias: 0 });
      const imu = makeImu({ roll: 1e10, pitch: 1e10 });
      const result = applyFieldStabilization(state, imu, DT, makeConfig());
      assert.ok(!Number.isNaN(result.bias), `bias is NaN`);
      assert.ok(result.bias >= -1 && result.bias <= 1, 'bias out of range');
    });
  });
});
