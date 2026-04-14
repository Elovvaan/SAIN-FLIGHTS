/**
 * Tests for field-solver.ts — Version-1 tangential-field control model.
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { solveField, advancePhase } from './field-solver';
import type { FieldState } from './field-solver';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeState(partial: Partial<FieldState> = {}): FieldState {
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

// ── Test suites ───────────────────────────────────────────────────────────────

describe('field-solver', () => {
  // ── Output shape ────────────────────────────────────────────────────────────
  describe('output shape', () => {
    it('returns a 4-element tuple', () => {
      const out = solveField(makeState());
      assert.strictEqual(out.length, 4);
    });

    it('all outputs are finite numbers', () => {
      const out = solveField(makeState());
      for (const v of out) {
        assert.ok(Number.isFinite(v), `expected finite number, got ${v}`);
      }
    });
  });

  // ── Normalisation / clamping ─────────────────────────────────────────────────
  describe('normalisation and clamping', () => {
    it('clamps outputs to [0, 1] for nominal inputs', () => {
      const out = solveField(makeState({ intensity: 100, bias: 1, phase: Math.PI / 4 }));
      for (const v of out) {
        assert.ok(v >= 0 && v <= 1, `output ${v} is outside [0, 1]`);
      }
    });

    it('clamps outputs when intensity is out of range (> 100)', () => {
      const out = solveField(makeState({ intensity: 200, bias: 0 }));
      for (const v of out) {
        assert.ok(v >= 0 && v <= 1, `output ${v} is outside [0, 1]`);
      }
    });

    it('clamps outputs when intensity is out of range (< 0)', () => {
      const out = solveField(makeState({ intensity: -50, bias: 0 }));
      for (const v of out) {
        assert.ok(v >= 0 && v <= 1, `output ${v} is outside [0, 1]`);
      }
    });

    it('clamps bias exceeding +1', () => {
      const out = solveField(makeState({ intensity: 50, bias: 99 }));
      for (const v of out) {
        assert.ok(v >= 0 && v <= 1, `output ${v} is outside [0, 1]`);
      }
    });

    it('clamps bias below -1', () => {
      const out = solveField(makeState({ intensity: 50, bias: -99 }));
      for (const v of out) {
        assert.ok(v >= 0 && v <= 1, `output ${v} is outside [0, 1]`);
      }
    });
  });

  // ── Phase progression ────────────────────────────────────────────────────────
  describe('clockwise vs counter-clockwise phase progression', () => {
    it('CW (spin=1): advancePhase increases the phase angle', () => {
      const s = makeState({ phase: 0, spin: 1, phaseVelocity: 1 });
      const advanced = advancePhase(s, 1);
      assert.ok(advanced.phase > s.phase, 'CW phase should increase after advance');
    });

    it('CCW (spin=-1): advancePhase decreases the phase angle', () => {
      const s = makeState({ phase: 0, spin: -1, phaseVelocity: 1 });
      const advanced = advancePhase(s, 1);
      assert.ok(advanced.phase < s.phase, 'CCW phase should decrease after advance');
    });

    it('CW and CCW advance by equal magnitude in opposite directions', () => {
      const base = makeState({ phase: 0, phaseVelocity: 2 });
      const cw = advancePhase({ ...base, spin: 1 }, 0.5);
      const ccw = advancePhase({ ...base, spin: -1 }, 0.5);
      assert.ok(
        Math.abs(cw.phase + ccw.phase) < 1e-12,
        'CW and CCW phases should be equal in magnitude and opposite in sign',
      );
    });

    it('advancing phase changes motor differential outputs (CW)', () => {
      const s0 = makeState({ intensity: 50, phase: 0, spin: 1 });
      const s1 = advancePhase(s0, 1);
      const out0 = solveField(s0);
      const out1 = solveField(s1);
      assert.ok(
        out0.some((v, i) => Math.abs(v - out1[i]) > 1e-9),
        'expected outputs to differ after phase advance',
      );
    });
  });

  // ── Equal-output / phase-neutral behavior ─────────────────────────────────
  describe('stable equal-output behavior when phase modulation is neutralized', () => {
    it('disabled field returns identical outputs for all motors regardless of phase', () => {
      for (const phase of [0, 1.23, Math.PI, 4.5]) {
        const s = makeState({ intensity: 60, phase, bias: 0, enabled: false });
        const [a, b, c, d] = solveField(s);
        assert.strictEqual(a, b, `motors A and B differ at phase=${phase}`);
        assert.strictEqual(b, c, `motors B and C differ at phase=${phase}`);
        assert.strictEqual(c, d, `motors C and D differ at phase=${phase}`);
      }
    });

    it('zero intensity with no bias produces zero outputs', () => {
      const out = solveField(makeState({ intensity: 0, bias: 0 }));
      assert.deepStrictEqual(out, [0, 0, 0, 0]);
    });

    it('average of 4 outputs equals the bias-adjusted base for any phase', () => {
      // The four motor offsets are evenly spaced at 90° → their sine values
      // always sum to zero, so the mean output equals the adjusted base.
      const intensity = 70;
      const expected = intensity / 100; // 0.7
      for (const phase of [0, 0.5, 1.0, Math.PI, 4.7]) {
        const s = makeState({ intensity, phase, bias: 0 });
        const out = solveField(s);
        const avg = (out[0] + out[1] + out[2] + out[3]) / 4;
        assert.ok(
          Math.abs(avg - expected) < 1e-9,
          `expected avg ≈ ${expected}, got ${avg} at phase=${phase}`,
        );
      }
    });
  });

  // ── Safety: no unsafe output values ─────────────────────────────────────────
  describe('no unsafe output values', () => {
    it('never produces NaN', () => {
      const states: FieldState[] = [
        makeState({ intensity: 0, bias: 0, phase: 0 }),
        makeState({ intensity: 100, bias: 1, phase: Math.PI }),
        makeState({ intensity: 50, phase: 7.89, phaseVelocity: 100, spin: -1 }),
        makeState({ intensity: 50, enabled: false }),
      ];
      for (const s of states) {
        const out = solveField(s);
        for (const v of out) {
          assert.ok(!Number.isNaN(v), `NaN output for state: ${JSON.stringify(s)}`);
        }
      }
    });

    it('never produces values below 0', () => {
      const states: FieldState[] = [
        makeState({ intensity: 1, bias: -0.9, phase: 1.5 }),
        makeState({ intensity: 100, bias: 1, phase: Math.PI / 4 }),
        makeState({ intensity: 0, bias: -1 }),
      ];
      for (const s of states) {
        for (const v of solveField(s)) {
          assert.ok(v >= 0, `output ${v} is below 0`);
        }
      }
    });

    it('never produces values above 1', () => {
      const states: FieldState[] = [
        makeState({ intensity: 99, bias: 0.9, phase: 3 }),
        makeState({ intensity: 100, bias: 1, phase: 0 }),
        makeState({ intensity: 200, bias: 2 }), // intentionally invalid input
      ];
      for (const s of states) {
        for (const v of solveField(s)) {
          assert.ok(v <= 1, `output ${v} exceeds 1`);
        }
      }
    });
  });

  // ── Bias effect ──────────────────────────────────────────────────────────────
  describe('bias effect on collective', () => {
    it('positive bias raises average output relative to zero bias', () => {
      const base = makeState({ intensity: 50, phase: 0 });
      const avgBase = solveField(base).reduce((s, v) => s + v, 0) / 4;
      const avgExpanded = solveField({ ...base, bias: 1 }).reduce((s, v) => s + v, 0) / 4;
      assert.ok(avgExpanded > avgBase, 'positive bias should raise average output');
    });

    it('negative bias lowers average output relative to zero bias', () => {
      const base = makeState({ intensity: 50, phase: 0 });
      const avgBase = solveField(base).reduce((s, v) => s + v, 0) / 4;
      const avgContracted = solveField({ ...base, bias: -1 }).reduce((s, v) => s + v, 0) / 4;
      assert.ok(avgContracted < avgBase, 'negative bias should lower average output');
    });
  });
});
