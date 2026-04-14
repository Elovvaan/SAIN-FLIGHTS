/**
 * Tests for actuator-router.ts and bench-test.ts — execution-layer adapter.
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeActuatorOutputs,
  validatePassthroughConditions,
  buildActuatorRouteLog,
} from './actuator-router';
import type { ActuatorRouterConfig, MotorChannelMap, MotorInversionMap } from './actuator-router';
import {
  generateBenchSequence,
  BENCH_MOTOR_LEVEL,
  PHASE_SWEEP_STEPS,
} from './bench-test';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeConfig(
  partial: Partial<ActuatorRouterConfig> = {},
): ActuatorRouterConfig {
  return {
    outputMode: 'passthrough',
    channelMap: { A: 0, B: 1, C: 2, D: 3 },
    inversionMap: { A: false, B: false, C: false, D: false },
    outputScale: 1,
    ...partial,
  };
}

function identityMap(): MotorChannelMap {
  return { A: 0, B: 1, C: 2, D: 3 };
}

function noInversion(): MotorInversionMap {
  return { A: false, B: false, C: false, D: false };
}

// ── routeActuatorOutputs ──────────────────────────────────────────────────────

describe('actuator-router: routeActuatorOutputs', () => {
  // ── Identity routing ─────────────────────────────────────────────────────────

  describe('identity routing (straight-through channel map)', () => {
    it('passes values unchanged with identity map and no inversion', () => {
      const solved: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
      const cfg = makeConfig({ channelMap: identityMap(), inversionMap: noInversion(), outputScale: 1 });
      const result = routeActuatorOutputs(solved, cfg);
      assert.deepStrictEqual(result.physical, solved);
    });

    it('preserves solved tuple in result.solved', () => {
      const solved: [number, number, number, number] = [0.25, 0.5, 0.75, 1.0];
      const cfg = makeConfig();
      const result = routeActuatorOutputs(solved, cfg);
      assert.deepStrictEqual(result.solved, solved);
    });

    it('copies channelMap into result', () => {
      const cfg = makeConfig({ channelMap: { A: 0, B: 1, C: 2, D: 3 } });
      const result = routeActuatorOutputs([0.5, 0.5, 0.5, 0.5], cfg);
      assert.deepStrictEqual(result.channelMap, cfg.channelMap);
    });

    it('copies inversionMap into result', () => {
      const cfg = makeConfig({ inversionMap: { A: false, B: true, C: false, D: true } });
      const result = routeActuatorOutputs([0.5, 0.5, 0.5, 0.5], cfg);
      assert.deepStrictEqual(result.inversionMap, cfg.inversionMap);
    });
  });

  // ── Channel remapping ─────────────────────────────────────────────────────────

  describe('channel remapping (passthrough mode)', () => {
    it('routes motor A output to a non-default physical channel', () => {
      // Motor A → channel 2; A value should appear at physical[2]
      const solved: [number, number, number, number] = [0.8, 0, 0, 0];
      const cfg = makeConfig({ channelMap: { A: 2, B: 0, C: 3, D: 1 } });
      const result = routeActuatorOutputs(solved, cfg);
      assert.strictEqual(result.physical[2], 0.8);
    });

    it('swapped channel map routes all four motors correctly', () => {
      // A→ch1, B→ch0, C→ch3, D→ch2
      const solved: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
      const cfg = makeConfig({ channelMap: { A: 1, B: 0, C: 3, D: 2 }, outputScale: 1 });
      const result = routeActuatorOutputs(solved, cfg);
      assert.strictEqual(result.physical[1], 0.1); // A → ch1
      assert.strictEqual(result.physical[0], 0.2); // B → ch0
      assert.strictEqual(result.physical[3], 0.3); // C → ch3
      assert.strictEqual(result.physical[2], 0.4); // D → ch2
    });

    it('reversed channel map [D,C,B,A] → [0,1,2,3]', () => {
      const solved: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
      const cfg = makeConfig({ channelMap: { A: 3, B: 2, C: 1, D: 0 }, outputScale: 1 });
      const result = routeActuatorOutputs(solved, cfg);
      assert.strictEqual(result.physical[3], 0.1); // A → ch3
      assert.strictEqual(result.physical[2], 0.2); // B → ch2
      assert.strictEqual(result.physical[1], 0.3); // C → ch1
      assert.strictEqual(result.physical[0], 0.4); // D → ch0
    });
  });

  // ── Mixer mode routing ────────────────────────────────────────────────────────

  describe('mixer mode: enforces identity channel map', () => {
    it('ignores non-identity channelMap in mixer mode — output is always identity-mapped', () => {
      // Even with a swapped channel map, mixer mode must produce identity output
      // so the FC mixer receives values in software motor order (A=ch0, B=ch1, etc.)
      const solved: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
      const cfg = makeConfig({ outputMode: 'mixer', channelMap: { A: 1, B: 0, C: 3, D: 2 } });
      const result = routeActuatorOutputs(solved, cfg);
      assert.strictEqual(result.physical[0], 0.1); // A → ch0 (identity)
      assert.strictEqual(result.physical[1], 0.2); // B → ch1 (identity)
      assert.strictEqual(result.physical[2], 0.3); // C → ch2 (identity)
      assert.strictEqual(result.physical[3], 0.4); // D → ch3 (identity)
    });

    it('mixer mode with identity channelMap produces same output as passthrough mode', () => {
      const solved: [number, number, number, number] = [0.2, 0.4, 0.6, 0.8];
      const mixer = makeConfig({ outputMode: 'mixer', channelMap: identityMap() });
      const passthrough = makeConfig({ outputMode: 'passthrough', channelMap: identityMap() });
      const mixerResult = routeActuatorOutputs(solved, mixer);
      const passthroughResult = routeActuatorOutputs(solved, passthrough);
      assert.deepStrictEqual(mixerResult.physical, passthroughResult.physical);
    });

    it('mixer mode result.channelMap reflects identity map (not the configured map)', () => {
      const cfg = makeConfig({ outputMode: 'mixer', channelMap: { A: 3, B: 2, C: 1, D: 0 } });
      const result = routeActuatorOutputs([0.5, 0.5, 0.5, 0.5], cfg);
      assert.deepStrictEqual(result.channelMap, { A: 0, B: 1, C: 2, D: 3 });
    });

    it('mixer mode still applies scale', () => {
      const solved: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
      const cfg = makeConfig({ outputMode: 'mixer', outputScale: 0.8 });
      const result = routeActuatorOutputs(solved, cfg);
      for (const v of result.physical) {
        assert.ok(Math.abs(v - 0.4) < 1e-9, `expected 0.4, got ${v}`);
      }
    });

    it('mixer mode still applies inversion', () => {
      const solved: [number, number, number, number] = [0.3, 0, 0, 0];
      const cfg = makeConfig({
        outputMode: 'mixer',
        inversionMap: { A: true, B: false, C: false, D: false },
        channelMap: { A: 3, B: 2, C: 1, D: 0 }, // remapping must be ignored
      });
      const result = routeActuatorOutputs(solved, cfg);
      // A is at identity ch0 (not ch3), inverted: 1 - 0.3 = 0.7
      assert.ok(Math.abs(result.physical[0] - 0.7) < 1e-9,
        `expected 0.7 at ch0, got ${result.physical[0]}`);
    });

    it('mixer mode still clamps outputs to [0, 1]', () => {
      const solved: [number, number, number, number] = [1.5, -0.5, Number.NaN, 0.5];
      const cfg = makeConfig({ outputMode: 'mixer' });
      const result = routeActuatorOutputs(solved, cfg);
      assert.strictEqual(result.physical[0], 1);
      assert.strictEqual(result.physical[1], 0);
      assert.strictEqual(result.physical[2], 0);
      assert.ok(Math.abs(result.physical[3] - 0.5) < 1e-9);
    });
  });

  // ── Inversion ─────────────────────────────────────────────────────────────────

  describe('motor inversion', () => {
    it('inverts a single motor value: 0.3 → 0.7', () => {
      const solved: [number, number, number, number] = [0.3, 0, 0, 0];
      const cfg = makeConfig({ inversionMap: { A: true, B: false, C: false, D: false } });
      const result = routeActuatorOutputs(solved, cfg);
      assert.ok(
        Math.abs(result.physical[0] - 0.7) < 1e-9,
        `expected 0.7, got ${result.physical[0]}`,
      );
    });

    it('inverts motor B independently without affecting others', () => {
      const solved: [number, number, number, number] = [0.2, 0.4, 0.6, 0.8];
      const cfg = makeConfig({ inversionMap: { A: false, B: true, C: false, D: false } });
      const result = routeActuatorOutputs(solved, cfg);
      assert.ok(Math.abs(result.physical[0] - 0.2) < 1e-9); // A unchanged
      assert.ok(Math.abs(result.physical[1] - 0.6) < 1e-9); // B inverted: 1 - 0.4 = 0.6
      assert.ok(Math.abs(result.physical[2] - 0.6) < 1e-9); // C unchanged
      assert.ok(Math.abs(result.physical[3] - 0.8) < 1e-9); // D unchanged
    });

    it('inversion of 0 produces 1', () => {
      const solved: [number, number, number, number] = [0, 0, 0, 0];
      const cfg = makeConfig({ inversionMap: { A: true, B: true, C: true, D: true } });
      const result = routeActuatorOutputs(solved, cfg);
      for (const v of result.physical) {
        assert.ok(Math.abs(v - 1) < 1e-9, `expected 1, got ${v}`);
      }
    });

    it('inversion of 1 produces 0', () => {
      const solved: [number, number, number, number] = [1, 1, 1, 1];
      const cfg = makeConfig({ inversionMap: { A: true, B: true, C: true, D: true } });
      const result = routeActuatorOutputs(solved, cfg);
      for (const v of result.physical) {
        assert.ok(Math.abs(v - 0) < 1e-9, `expected 0, got ${v}`);
      }
    });

    it('double inversion is identity (inversion then re-inversion)', () => {
      const solved: [number, number, number, number] = [0.35, 0.6, 0.1, 0.9];
      const cfgInv = makeConfig({ inversionMap: { A: true, B: true, C: true, D: true } });
      const cfgNone = makeConfig({ inversionMap: noInversion() });
      const inv = routeActuatorOutputs(solved, cfgInv);
      const re = routeActuatorOutputs(inv.physical, cfgInv);
      const direct = routeActuatorOutputs(solved, cfgNone);
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(re.physical[i] - direct.physical[i]) < 1e-9,
          `double inversion mismatch at ch${i}`);
      }
    });
  });

  // ── Output scale ─────────────────────────────────────────────────────────────

  describe('output scale', () => {
    it('scales output by outputScale', () => {
      const solved: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
      const cfg = makeConfig({ outputScale: 0.8 });
      const result = routeActuatorOutputs(solved, cfg);
      for (const v of result.physical) {
        assert.ok(Math.abs(v - 0.4) < 1e-9, `expected 0.4, got ${v}`);
      }
    });

    it('zero scale produces zero outputs', () => {
      const solved: [number, number, number, number] = [0.9, 0.8, 0.7, 0.6];
      const cfg = makeConfig({ outputScale: 0 });
      const result = routeActuatorOutputs(solved, cfg);
      for (const v of result.physical) {
        assert.strictEqual(v, 0);
      }
    });
  });

  // ── Clamping ──────────────────────────────────────────────────────────────────

  describe('output clamping', () => {
    it('clamps values above 1 to 1', () => {
      const solved: [number, number, number, number] = [1.5, 1.5, 1.5, 1.5];
      const cfg = makeConfig({ outputScale: 1 });
      const result = routeActuatorOutputs(solved, cfg);
      for (const v of result.physical) {
        assert.strictEqual(v, 1);
      }
    });

    it('clamps values below 0 to 0', () => {
      const solved: [number, number, number, number] = [-0.5, -0.1, -1, -0.001];
      const cfg = makeConfig({ outputScale: 1 });
      const result = routeActuatorOutputs(solved, cfg);
      for (const v of result.physical) {
        assert.strictEqual(v, 0);
      }
    });

    it('NaN input is clamped to 0', () => {
      const solved: [number, number, number, number] = [Number.NaN, 0.5, 0.5, 0.5];
      const cfg = makeConfig();
      const result = routeActuatorOutputs(solved, cfg);
      assert.strictEqual(result.physical[0], 0);
    });

    it('all physical outputs are in [0, 1] for any valid solved input', () => {
      const cases: Array<[number, number, number, number]> = [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0.5, 0.5, 0.5, 0.5],
        [0.1, 0.9, 0.3, 0.7],
      ];
      const cfg = makeConfig({ outputScale: 1.5 }); // intentionally > 1 to test clamping
      for (const solved of cases) {
        const result = routeActuatorOutputs(solved, cfg);
        for (let i = 0; i < 4; i++) {
          assert.ok(
            result.physical[i] >= 0 && result.physical[i] <= 1,
            `physical[${i}]=${result.physical[i]} is outside [0, 1]`,
          );
        }
      }
    });

    it('never produces NaN in physical outputs', () => {
      const solved: [number, number, number, number] = [
        Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5,
      ];
      const cfg = makeConfig();
      const result = routeActuatorOutputs(solved, cfg);
      for (let i = 0; i < 4; i++) {
        assert.ok(Number.isFinite(result.physical[i]), `physical[${i}] is not finite`);
      }
    });
  });
});

// ── validatePassthroughConditions ────────────────────────────────────────────

describe('actuator-router: validatePassthroughConditions', () => {
  // ── Happy path ───────────────────────────────────────────────────────────────

  describe('valid passthrough config', () => {
    it('returns valid=true for correct passthrough config in mavlink mode', () => {
      const cfg = makeConfig({ outputScale: 0.8 });
      const result = validatePassthroughConditions(cfg, true, 'mavlink');
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('returns valid=true for correct passthrough config in sim mode (bench testing)', () => {
      const cfg = makeConfig({ outputScale: 1 });
      const result = validatePassthroughConditions(cfg, true, 'sim');
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('includes advisory warning for sim mode', () => {
      const cfg = makeConfig();
      const result = validatePassthroughConditions(cfg, true, 'sim');
      assert.ok(result.warnings.some((w) => w.includes('sim')));
    });

    it('includes FC config advisory warning for mavlink mode', () => {
      const cfg = makeConfig();
      const result = validatePassthroughConditions(cfg, true, 'mavlink');
      assert.ok(result.warnings.some((w) => w.toLowerCase().includes('ardupilot')));
    });
  });

  // ── Field mode disabled ───────────────────────────────────────────────────────

  describe('field mode disabled blocks passthrough', () => {
    it('returns valid=false when fieldModeEnabled=false', () => {
      const cfg = makeConfig();
      const result = validatePassthroughConditions(cfg, false, 'mavlink');
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('FIELD_MODE_ENABLED')));
    });
  });

  // ── Duplicate channel map ─────────────────────────────────────────────────────

  describe('duplicate channel map blocks passthrough', () => {
    it('returns valid=false for duplicate channel assignments', () => {
      const cfg = makeConfig({ channelMap: { A: 0, B: 0, C: 2, D: 3 } }); // A and B both → ch0
      const result = validatePassthroughConditions(cfg, true, 'mavlink');
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('duplicate')));
    });

    it('returns valid=false when all motors share the same channel', () => {
      const cfg = makeConfig({ channelMap: { A: 1, B: 1, C: 1, D: 1 } });
      const result = validatePassthroughConditions(cfg, true, 'mavlink');
      assert.strictEqual(result.valid, false);
    });
  });

  // ── Invalid output scale ──────────────────────────────────────────────────────

  describe('invalid output scale blocks passthrough', () => {
    it('returns valid=false for zero output scale', () => {
      const cfg = makeConfig({ outputScale: 0 });
      const result = validatePassthroughConditions(cfg, true, 'mavlink');
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('FIELD_OUTPUT_SCALE')));
    });

    it('returns valid=false for negative output scale', () => {
      const cfg = makeConfig({ outputScale: -0.5 });
      const result = validatePassthroughConditions(cfg, true, 'mavlink');
      assert.strictEqual(result.valid, false);
    });

    it('returns valid=false for NaN output scale', () => {
      const cfg = makeConfig({ outputScale: Number.NaN });
      const result = validatePassthroughConditions(cfg, true, 'mavlink');
      assert.strictEqual(result.valid, false);
    });
  });

  // ── Multiple errors accumulate ────────────────────────────────────────────────

  describe('multiple validation errors accumulate', () => {
    it('reports both field-mode and channel-map errors', () => {
      const cfg = makeConfig({ channelMap: { A: 0, B: 0, C: 2, D: 3 } }); // duplicate
      const result = validatePassthroughConditions(cfg, false /* field mode off */, 'mavlink');
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length >= 2);
    });
  });
});

// ── buildActuatorRouteLog ─────────────────────────────────────────────────────

describe('actuator-router: buildActuatorRouteLog', () => {
  it('includes outputMode, solved, channelMap, inversionMap, physical', () => {
    const solved: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    const cfg = makeConfig();
    const routed = routeActuatorOutputs(solved, cfg);
    const log = buildActuatorRouteLog(routed, 'passthrough');
    assert.ok('outputMode' in log);
    assert.ok('solved' in log);
    assert.ok('channelMap' in log);
    assert.ok('inversionMap' in log);
    assert.ok('physical' in log);
    assert.strictEqual(log.outputMode, 'passthrough');
  });

  it('solved values in log match input', () => {
    const solved: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    const cfg = makeConfig();
    const routed = routeActuatorOutputs(solved, cfg);
    const log = buildActuatorRouteLog(routed, 'mixer') as { solved: Record<string, number> };
    assert.ok(Math.abs(log.solved.A - 0.1) < 1e-9);
    assert.ok(Math.abs(log.solved.B - 0.2) < 1e-9);
    assert.ok(Math.abs(log.solved.C - 0.3) < 1e-9);
    assert.ok(Math.abs(log.solved.D - 0.4) < 1e-9);
  });
});

// ── generateBenchSequence ─────────────────────────────────────────────────────

describe('bench-test: generateBenchSequence', () => {
  // ── Sequence structure ────────────────────────────────────────────────────────

  describe('sequence structure', () => {
    it('generates the expected total number of steps', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      // 4 single-motor + 2 pair + PHASE_SWEEP_STEPS
      assert.strictEqual(steps.length, 6 + PHASE_SWEEP_STEPS);
    });

    it('starts with A_ONLY step', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      assert.strictEqual(steps[0].label, 'A_ONLY');
    });

    it('includes all four single-motor steps in order', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const labels = steps.slice(0, 4).map((s) => s.label);
      assert.deepStrictEqual(labels, ['A_ONLY', 'B_ONLY', 'C_ONLY', 'D_ONLY']);
    });

    it('includes A_AND_C and B_AND_D pair steps', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const pairLabels = steps.slice(4, 6).map((s) => s.label);
      assert.deepStrictEqual(pairLabels, ['A_AND_C', 'B_AND_D']);
    });

    it('includes PHASE_SWEEP steps', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const sweepSteps = steps.slice(6);
      assert.strictEqual(sweepSteps.length, PHASE_SWEEP_STEPS);
      for (let i = 0; i < PHASE_SWEEP_STEPS; i++) {
        assert.strictEqual(sweepSteps[i].label, `PHASE_SWEEP_${i}`);
      }
    });
  });

  // ── Single-motor isolation ────────────────────────────────────────────────────

  describe('single-motor isolation steps', () => {
    it('A_ONLY step activates only motor A (other motors at 0)', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const aOnly = steps.find((s) => s.label === 'A_ONLY')!;
      assert.strictEqual(aOnly.logical[0], BENCH_MOTOR_LEVEL); // A
      assert.strictEqual(aOnly.logical[1], 0);                  // B
      assert.strictEqual(aOnly.logical[2], 0);                  // C
      assert.strictEqual(aOnly.logical[3], 0);                  // D
    });

    it('B_ONLY step activates only motor B', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const bOnly = steps.find((s) => s.label === 'B_ONLY')!;
      assert.strictEqual(bOnly.logical[1], BENCH_MOTOR_LEVEL);
      assert.strictEqual(bOnly.logical[0], 0);
      assert.strictEqual(bOnly.logical[2], 0);
      assert.strictEqual(bOnly.logical[3], 0);
    });

    it('A_ONLY physical channel matches channel map', () => {
      // With A→ch2, the A value should appear at physical[2]
      const cfg = makeConfig({ channelMap: { A: 2, B: 0, C: 3, D: 1 } });
      const steps = generateBenchSequence(cfg);
      const aOnly = steps.find((s) => s.label === 'A_ONLY')!;
      assert.ok(aOnly.routed.physical[2] > 0, 'A_ONLY should activate physical channel 2');
      assert.strictEqual(aOnly.routed.physical[0], 0);
      assert.strictEqual(aOnly.routed.physical[3], 0);
      assert.strictEqual(aOnly.routed.physical[1], 0);
    });
  });

  // ── Diagonal pair steps ───────────────────────────────────────────────────────

  describe('diagonal pair steps', () => {
    it('A_AND_C activates A and C, leaves B and D at 0', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const ac = steps.find((s) => s.label === 'A_AND_C')!;
      assert.strictEqual(ac.logical[0], BENCH_MOTOR_LEVEL); // A
      assert.strictEqual(ac.logical[1], 0);                  // B
      assert.strictEqual(ac.logical[2], BENCH_MOTOR_LEVEL); // C
      assert.strictEqual(ac.logical[3], 0);                  // D
    });

    it('B_AND_D activates B and D, leaves A and C at 0', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const bd = steps.find((s) => s.label === 'B_AND_D')!;
      assert.strictEqual(bd.logical[0], 0);
      assert.strictEqual(bd.logical[1], BENCH_MOTOR_LEVEL);
      assert.strictEqual(bd.logical[2], 0);
      assert.strictEqual(bd.logical[3], BENCH_MOTOR_LEVEL);
    });
  });

  // ── Phase sweep ───────────────────────────────────────────────────────────────

  describe('phase sweep steps', () => {
    it('each sweep step has all four motors with non-zero output', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const sweep = steps.filter((s) => s.label.startsWith('PHASE_SWEEP_'));
      for (const step of sweep) {
        // Base output (SWEEP_BASE=0.12) guarantees all motors run > 0
        for (const v of step.logical) {
          assert.ok(v > 0, `sweep step ${step.label}: logical value ${v} should be > 0`);
        }
      }
    });

    it('sweep step outputs rotate (adjacent steps differ)', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      const sweep = steps.filter((s) => s.label.startsWith('PHASE_SWEEP_'));
      const first = sweep[0].logical;
      const second = sweep[1].logical;
      const differ = first.some((v, i) => Math.abs(v - second[i]) > 1e-6);
      assert.ok(differ, 'consecutive phase sweep steps should produce different outputs');
    });
  });

  // ── No NaN / no out-of-range ───────────────────────────────────────────────────

  describe('no NaN or out-of-range values', () => {
    it('all logical values are in [0, 1]', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      for (const step of steps) {
        for (const v of step.logical) {
          assert.ok(v >= 0 && v <= 1, `step ${step.label}: logical ${v} out of range`);
        }
      }
    });

    it('all physical values are in [0, 1]', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      for (const step of steps) {
        for (const v of step.routed.physical) {
          assert.ok(v >= 0 && v <= 1, `step ${step.label}: physical ${v} out of range`);
        }
      }
    });

    it('no NaN in logical values', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      for (const step of steps) {
        for (const v of step.logical) {
          assert.ok(!Number.isNaN(v), `step ${step.label}: NaN in logical`);
        }
      }
    });

    it('no NaN in physical values', () => {
      const cfg = makeConfig();
      const steps = generateBenchSequence(cfg);
      for (const step of steps) {
        for (const v of step.routed.physical) {
          assert.ok(!Number.isNaN(v), `step ${step.label}: NaN in physical`);
        }
      }
    });

    it('bench sequence with remapped and inverted channels still produces valid outputs', () => {
      const cfg = makeConfig({
        channelMap: { A: 3, B: 2, C: 1, D: 0 },
        inversionMap: { A: true, B: false, C: true, D: false },
        outputScale: 0.9,
      });
      const steps = generateBenchSequence(cfg);
      for (const step of steps) {
        for (const v of step.routed.physical) {
          assert.ok(
            Number.isFinite(v) && v >= 0 && v <= 1,
            `step ${step.label}: physical ${v} is invalid`,
          );
        }
      }
    });
  });
});
