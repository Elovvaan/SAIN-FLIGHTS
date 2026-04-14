/**
 * Tests for lift-detector.ts
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLift,
  DEFAULT_LIFT_DETECTOR_CONFIG,
} from './lift-detector';
import type { LiftDetectorConfig } from './lift-detector';
import type { ImuState } from './field-stabilizer';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeImu(partial: Partial<ImuState> = {}): ImuState {
  return { roll: 0, pitch: 0, yaw: 0, valid: true, ...partial };
}

const cfg: LiftDetectorConfig = DEFAULT_LIFT_DETECTOR_CONFIG;

// ── detectLift ────────────────────────────────────────────────────────────────

describe('detectLift', () => {
  describe('no lift conditions', () => {
    it('returns liftDetected=false for stationary level flight', () => {
      const result = detectLift(makeImu(), makeImu(), 0.05, undefined, cfg);
      assert.strictEqual(result.liftDetected, false);
    });

    it('returns liftDetected=false for invalid IMU', () => {
      const result = detectLift(makeImu({ valid: false }), makeImu(), 0.05, undefined, cfg);
      assert.strictEqual(result.liftDetected, false);
    });

    it('returns liftDetected=false when altitude has not risen enough', () => {
      const imu = makeImu({ altitude: 1.0 });
      const result = detectLift(imu, makeImu(), 0.05, 0.99, cfg);
      // rise = 0.01 < 0.05 threshold
      assert.strictEqual(result.liftDetected, false);
    });
  });

  describe('altitude rise detection (secondary)', () => {
    it('detects lift when altitude rises above threshold', () => {
      const imu = makeImu({ altitude: 0.1 });
      const result = detectLift(imu, makeImu(), 0.05, 0.0, cfg);
      assert.strictEqual(result.liftDetected, true);
      assert.strictEqual(result.method, 'altitude_rise');
    });

    it('detects lift at exactly the altitude threshold', () => {
      const imu = makeImu({ altitude: 0.05 });
      const result = detectLift(imu, makeImu(), 0.05, 0.0, cfg);
      assert.strictEqual(result.liftDetected, true);
      assert.strictEqual(result.method, 'altitude_rise');
    });

    it('altitude_rise takes priority over acceleration_spike', () => {
      // Both altitude and angular rate indicate lift.
      const prev = makeImu({ roll: 0, altitude: 0.0 });
      const curr = makeImu({ roll: 0.01, altitude: 0.1 });
      const result = detectLift(curr, prev, 0.05, 0.0, cfg);
      assert.strictEqual(result.liftDetected, true);
      assert.strictEqual(result.method, 'altitude_rise');
    });

    it('does not use altitude when refAltitudeM is undefined', () => {
      const imu = makeImu({ altitude: 0.1 });
      const result = detectLift(imu, makeImu(), 0.05, undefined, cfg);
      // No altitude reference → fall through to angular check
      assert.strictEqual(result.liftDetected, false); // no angular motion either
    });
  });

  describe('angular acceleration spike detection (primary)', () => {
    it('detects lift when angular rate exceeds threshold', () => {
      // dt=0.05s, dRoll=0.01 → rate=0.2 rad/s > 0.05 threshold
      const prev = makeImu({ roll: 0 });
      const curr = makeImu({ roll: 0.01 });
      const result = detectLift(curr, prev, 0.05, undefined, cfg);
      assert.strictEqual(result.liftDetected, true);
      assert.strictEqual(result.method, 'acceleration_spike');
    });

    it('does not detect lift below angular rate threshold', () => {
      // dt=1s, dRoll=0.001 → rate=0.001 rad/s < 0.05 threshold
      const prev = makeImu({ roll: 0 });
      const curr = makeImu({ roll: 0.001 });
      const result = detectLift(curr, prev, 1.0, undefined, cfg);
      assert.strictEqual(result.liftDetected, false);
    });

    it('uses combined roll + pitch rate in magnitude', () => {
      // Each small but combined they cross the threshold.
      // dt=0.05, dRoll=0.002, dPitch=0.002 → magnitude=sqrt(0.002²+0.002²)/0.05 ≈ 0.057 > 0.05
      const prev = makeImu({ roll: 0, pitch: 0 });
      const curr = makeImu({ roll: 0.002, pitch: 0.002 });
      const result = detectLift(curr, prev, 0.05, undefined, cfg);
      assert.strictEqual(result.liftDetected, true);
    });

    it('does not check angular rate when dt=0', () => {
      const prev = makeImu({ roll: 0 });
      const curr = makeImu({ roll: 0.1 });
      const result = detectLift(curr, prev, 0, undefined, cfg);
      assert.strictEqual(result.liftDetected, false);
    });

    it('does not check angular rate when prev IMU is invalid', () => {
      const prev = makeImu({ valid: false, roll: 0 });
      const curr = makeImu({ roll: 0.01 });
      const result = detectLift(curr, prev, 0.05, undefined, cfg);
      assert.strictEqual(result.liftDetected, false);
    });
  });

  describe('DEFAULT_LIFT_DETECTOR_CONFIG values', () => {
    it('accelSpikeThresholdRadS is 0.05', () => {
      assert.strictEqual(cfg.accelSpikeThresholdRadS, 0.05);
    });

    it('altRiseThresholdM is 0.05', () => {
      assert.strictEqual(cfg.altRiseThresholdM, 0.05);
    });
  });
});
