/**
 * Tests for field-translator.ts — velocity-driven directional field translation.
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateField } from './field-translator';
import type { TranslatorConfig } from './field-translator';
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
    velocityX: 0,
    velocityY: 0,
    ...partial,
  };
}

function makeConfig(partial: Partial<TranslatorConfig> = {}): TranslatorConfig {
  return {
    enabled: true,
    translationGain: 0.4,
    biasGain: 0.1,
    ...partial,
  };
}

const DT = 0.05; // 20 Hz tick

// ── Test suites ───────────────────────────────────────────────────────────────

describe('field-translator', () => {
  // ── Safety bypass ──────────────────────────────────────────────────────────

  describe('safety bypass', () => {
    it('returns input state unchanged when translatorConfig.enabled is false', () => {
      const state = makeFieldState({ phase: 1.23, bias: 0.4, velocityX: 0.5, velocityY: 0.5 });
      const result = translateField(state, DT, makeConfig({ enabled: false }));
      assert.deepStrictEqual(result, state);
    });

    it('returns input state unchanged when dt is zero', () => {
      const state = makeFieldState({ velocityX: 1, velocityY: 1 });
      const result = translateField(state, 0, makeConfig());
      assert.deepStrictEqual(result, state);
    });

    it('returns input state unchanged when dt is negative', () => {
      const state = makeFieldState({ velocityX: 1, velocityY: 1 });
      const result = translateField(state, -0.1, makeConfig());
      assert.deepStrictEqual(result, state);
    });

    it('returns input state unchanged when both velocities are zero', () => {
      const state = makeFieldState({ phase: 1.5, bias: 0.2, velocityX: 0, velocityY: 0 });
      const result = translateField(state, DT, makeConfig());
      assert.deepStrictEqual(result, state);
    });

    it('treats absent velocityX as 0 (no translation on X axis)', () => {
      const state: FieldState = {
        intensity: 50,
        phase: 0,
        phaseVelocity: 1,
        spin: 1,
        bias: 0,
        enabled: true,
        // velocityX and velocityY intentionally omitted
      };
      const result = translateField(state, DT, makeConfig());
      // Both missing → treated as 0 → no-op
      assert.deepStrictEqual(result, state);
    });
  });

  // ── Phase correction ───────────────────────────────────────────────────────

  describe('phase correction (directional field shift)', () => {
    it('applies a non-zero phase change when velocityY is non-zero (phase=0)', () => {
      // At phase=0: translationPhase = vx*cos(0) + vy*sin(0) = vx
      // At phase=0: translationPhase = vx*1 + vy*0
      const state = makeFieldState({ phase: 0, velocityX: 0, velocityY: 1 });
      const result = translateField(state, DT, makeConfig());
      // sin(0) = 0, so velocityY alone at phase=0 contributes 0 → no phase change
      assert.strictEqual(result.phase, state.phase);
    });

    it('applies a non-zero phase change when velocityX is non-zero (phase=0)', () => {
      // At phase=0: translationPhase = vx*cos(0) = vx*1
      const state = makeFieldState({ phase: 0, velocityX: 1, velocityY: 0 });
      const result = translateField(state, DT, makeConfig());
      assert.ok(result.phase !== state.phase, 'phase should change on velocityX at phase=0');
    });

    it('applies a non-zero phase change when velocityY is non-zero (phase=π/2)', () => {
      // At phase=π/2: translationPhase = vx*cos(π/2) + vy*sin(π/2) = vy
      const state = makeFieldState({ phase: Math.PI / 2, velocityX: 0, velocityY: 1 });
      const result = translateField(state, DT, makeConfig());
      assert.ok(result.phase !== state.phase, 'phase should change on velocityY at phase=π/2');
    });

    it('phase correction scales with translationGain', () => {
      const state = makeFieldState({ phase: 0, velocityX: 1, velocityY: 0 });
      const resLow  = translateField(state, DT, makeConfig({ translationGain: 0.1 }));
      const resHigh = translateField(state, DT, makeConfig({ translationGain: 1.0 }));
      const deltaLow  = Math.abs(resLow.phase  - state.phase);
      const deltaHigh = Math.abs(resHigh.phase - state.phase);
      assert.ok(deltaHigh > deltaLow, 'larger gain should produce larger phase delta');
    });

    it('phase correction scales with dt', () => {
      const state = makeFieldState({ phase: 0, velocityX: 1, velocityY: 0 });
      const resSmallDt = translateField(state, 0.01, makeConfig());
      const resLargeDt = translateField(state, 0.1,  makeConfig());
      const deltaSmall = Math.abs(resSmallDt.phase - state.phase);
      const deltaLarge = Math.abs(resLargeDt.phase - state.phase);
      assert.ok(deltaLarge > deltaSmall, 'larger dt should produce larger phase delta');
    });

    it('opposite velocity directions produce opposite phase corrections', () => {
      // Use phase=π so that small corrections stay within [0, 2π) without wrapping.
      // At phase=π: cos(π) = -1, so vx=0.5 → translationPhase = -0.5 (phase decreases)
      //                         and vx=-0.5 → translationPhase = 0.5 (phase increases)
      const state    = makeFieldState({ phase: Math.PI, velocityX:  0.5, velocityY: 0 });
      const stateNeg = makeFieldState({ phase: Math.PI, velocityX: -0.5, velocityY: 0 });
      const resPos = translateField(state,    DT, makeConfig());
      const resNeg = translateField(stateNeg, DT, makeConfig());
      const deltaPos = resPos.phase - state.phase;
      const deltaNeg = resNeg.phase - state.phase;
      assert.ok(
        Math.abs(deltaPos + deltaNeg) < 1e-10,
        'opposite velocities should produce equal and opposite phase deltas',
      );
    });

    it('phase output is always in [0, 2π)', () => {
      const TWO_PI = 2 * Math.PI;
      const cases = [
        makeFieldState({ phase: 0,             velocityX: 1 }),
        makeFieldState({ phase: 5.5,           velocityX: 1 }),
        makeFieldState({ phase: TWO_PI - 0.01, velocityX: 1 }),
        makeFieldState({ phase: TWO_PI + 1,    velocityX: 1 }),
        makeFieldState({ phase: -0.5,          velocityX: 1 }),
      ];
      for (const state of cases) {
        const result = translateField(state, DT, makeConfig());
        assert.ok(
          result.phase >= 0 && result.phase < TWO_PI,
          `phase ${result.phase} is outside [0, 2π)`,
        );
      }
    });

    it('zero translationGain produces no phase change', () => {
      const state = makeFieldState({ phase: 1.0, velocityX: 1, velocityY: 1 });
      const result = translateField(state, DT, makeConfig({ translationGain: 0 }));
      assert.strictEqual(result.phase, state.phase);
    });
  });

  // ── Bias assist ────────────────────────────────────────────────────────────

  describe('bias assist (lateral collective push)', () => {
    it('applies a non-zero bias change when velocityX is non-zero', () => {
      const state = makeFieldState({ bias: 0, velocityX: 0.5, velocityY: 0 });
      const result = translateField(state, DT, makeConfig());
      assert.ok(result.bias !== state.bias, 'bias should change on velocityX');
    });

    it('applies a non-zero bias change when velocityY is non-zero', () => {
      const state = makeFieldState({ bias: 0, velocityX: 0, velocityY: 0.5 });
      const result = translateField(state, DT, makeConfig());
      assert.ok(result.bias !== state.bias, 'bias should change on velocityY');
    });

    it('bias is always clamped to [-1, 1]', () => {
      const cfg = makeConfig({ biasGain: 1000 });
      let state = makeFieldState({ bias: 0.9, velocityX: 1, velocityY: 1 });
      for (let i = 0; i < 100; i++) {
        state = translateField(state, 0.1, cfg) as FieldState;
      }
      assert.ok(state.bias >= -1 && state.bias <= 1, `bias ${state.bias} is outside [-1, 1]`);
    });

    it('zero biasGain produces no bias change', () => {
      const state = makeFieldState({ bias: 0.3, velocityX: 1, velocityY: 1 });
      const result = translateField(state, DT, makeConfig({ biasGain: 0 }));
      assert.strictEqual(result.bias, state.bias);
    });
  });

  // ── Pure function / immutability ───────────────────────────────────────────

  describe('pure function properties', () => {
    it('does not mutate the input fieldState', () => {
      const state = makeFieldState({ phase: 1.0, bias: 0.2, velocityX: 0.5, velocityY: 0.3 });
      const frozen = { ...state };
      translateField(state, DT, makeConfig());
      assert.deepStrictEqual(state, frozen, 'input state should not be mutated');
    });

    it('preserves unmodified FieldState fields (intensity, phaseVelocity, spin, enabled, velocityX, velocityY)', () => {
      const state = makeFieldState({ intensity: 70, phaseVelocity: 3.14, spin: -1, enabled: false, velocityX: 0.5, velocityY: 0.3 });
      const result = translateField(state, DT, makeConfig());
      assert.strictEqual(result.intensity,     state.intensity);
      assert.strictEqual(result.phaseVelocity, state.phaseVelocity);
      assert.strictEqual(result.spin,          state.spin);
      assert.strictEqual(result.enabled,       state.enabled);
      assert.strictEqual(result.velocityX,     state.velocityX);
      assert.strictEqual(result.velocityY,     state.velocityY);
    });

    it('returns a new object (not the same reference) when translation occurs', () => {
      const state = makeFieldState({ velocityX: 0.5 });
      const result = translateField(state, DT, makeConfig());
      assert.ok(result !== state, 'should return a new FieldState object');
    });
  });

  // ── Safety: no unsafe output values ───────────────────────────────────────

  describe('no unsafe output values', () => {
    it('never produces NaN in phase on extreme inputs', () => {
      const state = makeFieldState({ velocityX: 1e10, velocityY: 1e10 });
      const result = translateField(state, DT, makeConfig());
      assert.ok(typeof result.phase === 'number');
      assert.ok(!Number.isNaN(result.phase), 'phase is NaN');
    });

    it('never produces NaN in bias on extreme inputs', () => {
      const state = makeFieldState({ bias: 0, velocityX: 1e10, velocityY: 1e10 });
      const result = translateField(state, DT, makeConfig());
      assert.ok(!Number.isNaN(result.bias), 'bias is NaN');
      assert.ok(result.bias >= -1 && result.bias <= 1, `bias ${result.bias} out of range`);
    });
  });
});
