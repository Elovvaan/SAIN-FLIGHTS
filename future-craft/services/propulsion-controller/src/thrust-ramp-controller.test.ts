/**
 * Tests for thrust-ramp-controller.ts
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerp,
  computeRampedIntensity,
  isRampComplete,
  SAFE_LIFT_RAMP_DEFAULTS,
} from './thrust-ramp-controller';
import type { RampConfig } from './thrust-ramp-controller';

// ── lerp ─────────────────────────────────────────────────────────────────────

describe('lerp', () => {
  it('returns a at t=0', () => {
    assert.strictEqual(lerp(10, 35, 0), 10);
  });

  it('returns b at t=1', () => {
    assert.strictEqual(lerp(10, 35, 1), 35);
  });

  it('returns midpoint at t=0.5', () => {
    assert.strictEqual(lerp(10, 35, 0.5), 22.5);
  });

  it('clamps t below 0 to 0', () => {
    assert.strictEqual(lerp(10, 35, -1), 10);
  });

  it('clamps t above 1 to 1', () => {
    assert.strictEqual(lerp(10, 35, 2), 35);
  });

  it('handles NaN t as 0', () => {
    assert.strictEqual(lerp(10, 35, NaN), 10);
  });

  it('handles NaN a as 0', () => {
    assert.strictEqual(lerp(NaN, 35, 0.5), 17.5);
  });

  it('handles NaN b as 0', () => {
    assert.strictEqual(lerp(10, NaN, 0.5), 5);
  });

  it('lerp(0, 0, any) = 0', () => {
    assert.strictEqual(lerp(0, 0, 0.5), 0);
  });
});

// ── computeRampedIntensity ────────────────────────────────────────────────────

describe('computeRampedIntensity', () => {
  const cfg: RampConfig = { minIntensity: 10, targetIntensity: 35, rampDurationMs: 2000 };

  it('returns minIntensity at t=0 (ramp just started)', () => {
    const now = 1000;
    const result = computeRampedIntensity(now, now, cfg);
    assert.strictEqual(result, 10);
  });

  it('returns targetIntensity at t=1 (ramp complete)', () => {
    const start = 1000;
    const result = computeRampedIntensity(start, start + 2000, cfg);
    assert.strictEqual(result, 35);
  });

  it('returns midpoint at t=0.5', () => {
    const start = 1000;
    const result = computeRampedIntensity(start, start + 1000, cfg);
    assert.strictEqual(result, 22.5);
  });

  it('clamps to targetIntensity beyond ramp duration', () => {
    const start = 0;
    const result = computeRampedIntensity(start, 5000, cfg);
    assert.strictEqual(result, 35);
  });

  it('clamps to minIntensity for negative elapsed (clock skew)', () => {
    const start = 5000;
    const result = computeRampedIntensity(start, 1000, cfg); // nowMs < startMs
    assert.strictEqual(result, 10);
  });

  it('returns targetIntensity immediately when rampDurationMs=0', () => {
    const cfg0: RampConfig = { minIntensity: 10, targetIntensity: 35, rampDurationMs: 0 };
    const result = computeRampedIntensity(0, 0, cfg0);
    assert.strictEqual(result, 35);
  });

  it('result is always in [minIntensity, targetIntensity]', () => {
    const start = 0;
    for (let t = 0; t <= 3000; t += 100) {
      const v = computeRampedIntensity(start, start + t, cfg);
      assert.ok(v >= cfg.minIntensity && v <= cfg.targetIntensity, `intensity ${v} out of range at t=${t}`);
    }
  });
});

// ── isRampComplete ────────────────────────────────────────────────────────────

describe('isRampComplete', () => {
  const cfg: RampConfig = { minIntensity: 10, targetIntensity: 35, rampDurationMs: 2000 };

  it('returns false before ramp duration', () => {
    assert.strictEqual(isRampComplete(0, 1000, cfg), false);
  });

  it('returns true exactly at ramp duration', () => {
    assert.strictEqual(isRampComplete(0, 2000, cfg), true);
  });

  it('returns true after ramp duration', () => {
    assert.strictEqual(isRampComplete(0, 3000, cfg), true);
  });

  it('returns true immediately when rampDurationMs=0', () => {
    const cfg0: RampConfig = { minIntensity: 10, targetIntensity: 35, rampDurationMs: 0 };
    assert.strictEqual(isRampComplete(0, 0, cfg0), true);
  });
});

// ── SAFE_LIFT_RAMP_DEFAULTS ───────────────────────────────────────────────────

describe('SAFE_LIFT_RAMP_DEFAULTS', () => {
  it('minIntensity is 10', () => {
    assert.strictEqual(SAFE_LIFT_RAMP_DEFAULTS.minIntensity, 10);
  });

  it('targetIntensity is 35', () => {
    assert.strictEqual(SAFE_LIFT_RAMP_DEFAULTS.targetIntensity, 35);
  });

  it('rampDurationMs is 3000', () => {
    assert.strictEqual(SAFE_LIFT_RAMP_DEFAULTS.rampDurationMs, 3000);
  });
});
