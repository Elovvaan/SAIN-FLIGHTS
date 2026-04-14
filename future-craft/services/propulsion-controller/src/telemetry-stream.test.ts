/**
 * Tests for telemetry-stream.ts
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitTelemetry } from './telemetry-stream';
import type { TelemetryFrame } from './telemetry-stream';
import type { FieldState } from './field-solver';
import type { ImuState } from './field-stabilizer';
import type { FlightPhase } from './flight-state-machine';
import type { Logger } from 'pino';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeFieldState(partial: Partial<FieldState> = {}): FieldState {
  return {
    intensity: 25,
    phase: 1.57,
    phaseVelocity: Math.PI,
    spin: 1,
    bias: 0.1,
    enabled: true,
    velocityX: 0,
    velocityY: 0,
    ...partial,
  };
}

function makeImu(partial: Partial<ImuState> = {}): ImuState {
  return { roll: 0.01, pitch: -0.02, yaw: 0.5, valid: true, ...partial };
}

/** Capture what was logged by emitTelemetry by duck-typing a minimal logger. */
function makeCapturingLogger(): { getFrame: () => TelemetryFrame; logger: Logger } {
  let captured: unknown = null;
  const logger = {
    info: (frame: unknown, _msg?: string) => { captured = frame; },
  } as unknown as Logger;
  return {
    logger,
    getFrame: () => {
      assert.ok(captured !== null, 'no frame was emitted');
      return captured as TelemetryFrame;
    },
  };
}

// ── emitTelemetry ─────────────────────────────────────────────────────────────

describe('emitTelemetry', () => {
  describe('frame structure', () => {
    it('emits a frame with type=telemetry_tick', () => {
      const { logger, getFrame } = makeCapturingLogger();
      emitTelemetry('RAMPING', makeFieldState(), [0.1, 0.2, 0.3, 0.4], makeImu(), 0.1, logger);
      assert.strictEqual(getFrame().type, 'telemetry_tick');
    });

    it('frame contains all required fields', () => {
      const { logger, getFrame } = makeCapturingLogger();
      emitTelemetry('STABILIZING', makeFieldState(), [0.1, 0.2, 0.3, 0.4], makeImu(), 0.05, logger);
      const f = getFrame();
      assert.ok('flightPhase' in f);
      assert.ok('phase' in f);
      assert.ok('bias' in f);
      assert.ok('intensity' in f);
      assert.ok('outputs' in f);
      assert.ok('imu' in f);
      assert.ok('stabilityScore' in f);
      assert.ok('timestamp' in f);
    });

    it('reflects flightPhase correctly', () => {
      const phases: FlightPhase[] = ['IDLE', 'ARMED', 'RAMPING', 'LIFT_DETECTED', 'STABILIZING', 'ABORT'];
      for (const phase of phases) {
        const { logger, getFrame } = makeCapturingLogger();
        emitTelemetry(phase, makeFieldState(), [0, 0, 0, 0], makeImu(), 0, logger);
        assert.strictEqual(getFrame().flightPhase, phase);
      }
    });

    it('outputs array has 4 elements', () => {
      const { logger, getFrame } = makeCapturingLogger();
      emitTelemetry('IDLE', makeFieldState(), [0.1, 0.2, 0.3, 0.4], makeImu(), 0, logger);
      assert.strictEqual(getFrame().outputs.length, 4);
    });

    it('imu contains pitch, roll, yaw', () => {
      const { logger, getFrame } = makeCapturingLogger();
      const imu = makeImu({ roll: 0.05, pitch: -0.03, yaw: 1.2 });
      emitTelemetry('IDLE', makeFieldState(), [0, 0, 0, 0], imu, 0, logger);
      const f = getFrame();
      assert.ok('roll' in f.imu);
      assert.ok('pitch' in f.imu);
      assert.ok('yaw' in f.imu);
    });

    it('imu includes altitude when present', () => {
      const { logger, getFrame } = makeCapturingLogger();
      const imu = makeImu({ altitude: 1.5 });
      emitTelemetry('IDLE', makeFieldState(), [0, 0, 0, 0], imu, 0, logger);
      assert.strictEqual(getFrame().imu.altitude, 1.5);
    });

    it('imu does not include altitude when absent', () => {
      const { logger, getFrame } = makeCapturingLogger();
      const imu = makeImu();
      emitTelemetry('IDLE', makeFieldState(), [0, 0, 0, 0], imu, 0, logger);
      assert.strictEqual(getFrame().imu.altitude, undefined);
    });
  });

  describe('numeric rounding', () => {
    it('rounds values to at most 4 decimal places', () => {
      const { logger, getFrame } = makeCapturingLogger();
      const fieldState = makeFieldState({ phase: Math.PI }); // 3.14159265...
      emitTelemetry('IDLE', fieldState, [0, 0, 0, 0], makeImu(), 0, logger);
      const str = String(getFrame().phase);
      const decimals = str.includes('.') ? str.split('.')[1].length : 0;
      assert.ok(decimals <= 4, `Expected ≤4 decimal places, got ${decimals} for ${getFrame().phase}`);
    });

    it('handles NaN inputs gracefully (emits 0)', () => {
      const { logger, getFrame } = makeCapturingLogger();
      emitTelemetry('IDLE', makeFieldState({ intensity: NaN }), [NaN, 0, 0, 0], makeImu(), NaN, logger);
      const f = getFrame();
      assert.strictEqual(f.intensity, 0);
      assert.strictEqual(f.outputs[0], 0);
      assert.strictEqual(f.stabilityScore, 0);
    });
  });

  describe('timestamp', () => {
    it('timestamp is a valid ISO-8601 string', () => {
      const { logger, getFrame } = makeCapturingLogger();
      emitTelemetry('IDLE', makeFieldState(), [0, 0, 0, 0], makeImu(), 0, logger);
      assert.ok(!isNaN(Date.parse(getFrame().timestamp)));
    });
  });
});
