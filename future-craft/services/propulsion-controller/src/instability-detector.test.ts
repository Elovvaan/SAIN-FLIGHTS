/**
 * Tests for instability-detector.ts
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInstability,
  computeStabilityScore,
  DEFAULT_INSTABILITY_CONFIG,
} from './instability-detector';
import type { InstabilityConfig } from './instability-detector';
import type { ImuState } from './field-stabilizer';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeImu(partial: Partial<ImuState> = {}): ImuState {
  return { roll: 0, pitch: 0, yaw: 0, valid: true, ...partial };
}

const cfg: InstabilityConfig = DEFAULT_INSTABILITY_CONFIG;
const INVALID_IMU = makeImu({ valid: false });

// ── detectInstability ─────────────────────────────────────────────────────────

describe('detectInstability', () => {
  describe('safe baseline', () => {
    it('does not trigger for level flight (roll=0, pitch=0)', () => {
      const result = detectInstability(makeImu(), makeImu(), 0.05, cfg);
      assert.strictEqual(result.triggered, false);
    });

    it('does not trigger when IMU is invalid', () => {
      const result = detectInstability(INVALID_IMU, INVALID_IMU, 0.05, cfg);
      assert.strictEqual(result.triggered, false);
    });
  });

  describe('extreme angle — criterion 1', () => {
    it('triggers when roll exceeds maxAngleRad', () => {
      const result = detectInstability(makeImu({ roll: 0.5 }), makeImu(), 0.05, cfg);
      // 0.5 rad > 0.436 rad
      assert.strictEqual(result.triggered, true);
      assert.ok(result.reason?.includes('roll'));
    });

    it('triggers when pitch exceeds maxAngleRad', () => {
      const result = detectInstability(makeImu({ pitch: 0.5 }), makeImu(), 0.05, cfg);
      assert.strictEqual(result.triggered, true);
      assert.ok(result.reason?.includes('pitch'));
    });

    it('does not trigger just below maxAngleRad', () => {
      // Use same prev and curr to produce zero angular rate (tests angle threshold in isolation).
      const imu = makeImu({ roll: 0.43 });
      const result = detectInstability(imu, imu, 0.05, cfg);
      assert.strictEqual(result.triggered, false);
    });
  });

  describe('NaN guard', () => {
    it('triggers for NaN roll', () => {
      const result = detectInstability(makeImu({ roll: NaN }), makeImu(), 0.05, cfg);
      assert.strictEqual(result.triggered, true);
      assert.ok(result.reason?.includes('NaN'));
    });

    it('triggers for NaN pitch', () => {
      const result = detectInstability(makeImu({ pitch: NaN }), makeImu(), 0.05, cfg);
      assert.strictEqual(result.triggered, true);
    });
  });

  describe('angular rate — criterion 2', () => {
    it('triggers when roll rate exceeds maxRateRadS', () => {
      // dt=0.05s, dRoll=0.1rad → rate=2 rad/s > 1.571
      const prev = makeImu({ roll: 0 });
      const curr = makeImu({ roll: 0.1 });
      const result = detectInstability(curr, prev, 0.05, cfg);
      assert.strictEqual(result.triggered, true);
      assert.ok(result.reason?.includes('roll rate'));
    });

    it('triggers when pitch rate exceeds maxRateRadS', () => {
      const prev = makeImu({ pitch: 0 });
      const curr = makeImu({ pitch: 0.1 });
      const result = detectInstability(curr, prev, 0.05, cfg);
      assert.strictEqual(result.triggered, true);
    });

    it('does not trigger for slow angular rate', () => {
      // dt=0.05s, dRoll=0.01rad → rate=0.2 rad/s < 1.571
      const prev = makeImu({ roll: 0 });
      const curr = makeImu({ roll: 0.01 });
      const result = detectInstability(curr, prev, 0.05, cfg);
      assert.strictEqual(result.triggered, false);
    });

    it('does not use rate check when dt=0', () => {
      const prev = makeImu({ roll: 0 });
      const curr = makeImu({ roll: 0.1 });
      const result = detectInstability(curr, prev, 0, cfg);
      // dt=0 skips rate check; angle 0.1 < 0.436 so no trigger
      assert.strictEqual(result.triggered, false);
    });

    it('does not use rate check when prev IMU is invalid', () => {
      const prev = makeImu({ valid: false });
      const curr = makeImu({ roll: 0.1 });
      const result = detectInstability(curr, prev, 0.05, cfg);
      // angle 0.1 < 0.436, prev invalid so no rate check
      assert.strictEqual(result.triggered, false);
    });
  });

  describe('reason string format', () => {
    it('reason contains "flight_abort_instability"', () => {
      const result = detectInstability(makeImu({ roll: 0.5 }), makeImu(), 0.05, cfg);
      assert.ok(result.reason?.includes('flight_abort_instability'));
    });
  });
});

// ── computeStabilityScore ─────────────────────────────────────────────────────

describe('computeStabilityScore', () => {
  it('returns 0 for level flight', () => {
    assert.strictEqual(computeStabilityScore(makeImu(), cfg), 0);
  });

  it('returns 1 at maxAngleRad', () => {
    const score = computeStabilityScore(makeImu({ roll: cfg.maxAngleRad }), cfg);
    assert.ok(Math.abs(score - 1) < 0.001);
  });

  it('returns 0 for invalid IMU', () => {
    assert.strictEqual(computeStabilityScore(INVALID_IMU, cfg), 0);
  });

  it('returns 0 for NaN values', () => {
    assert.strictEqual(computeStabilityScore(makeImu({ roll: NaN }), cfg), 0);
  });

  it('score is proportional to angle deviation', () => {
    const score = computeStabilityScore(makeImu({ roll: cfg.maxAngleRad / 2 }), cfg);
    assert.ok(Math.abs(score - 0.5) < 0.001);
  });

  it('score is clamped to [0, 1] beyond maxAngleRad', () => {
    const score = computeStabilityScore(makeImu({ roll: cfg.maxAngleRad * 2 }), cfg);
    assert.strictEqual(score, 1);
  });

  it('uses the larger of |roll| and |pitch|', () => {
    const rollScore = computeStabilityScore(makeImu({ roll: cfg.maxAngleRad * 0.3 }), cfg);
    const pitchScore = computeStabilityScore(makeImu({ pitch: cfg.maxAngleRad * 0.7 }), cfg);
    const combined = computeStabilityScore(
      makeImu({ roll: cfg.maxAngleRad * 0.3, pitch: cfg.maxAngleRad * 0.7 }),
      cfg,
    );
    assert.ok(combined > rollScore);
    assert.ok(Math.abs(combined - pitchScore) < 0.001);
  });
});
