/**
 * Tests for hardware-validator.ts — pre-flight hardware truth validation layer.
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from 'pino';
import {
  validateMotorMapping,
  validateSpinDirection,
  detectMixerInterference,
  validateEscLinearity,
  validatePhaseResponse,
  buildHardwareValidationReport,
  enforceArmingGate,
  emitHardwareValidationTelemetry,
  EXPECTED_MOTOR_CHANNELS,
  EXPECTED_SPIN_DIRECTIONS,
  MIXER_INTERFERENCE_TOLERANCE,
  ESC_LINEARITY_TOLERANCE,
  PHASE_ASYMMETRY_TOLERANCE,
} from './hardware-validator';
import type {
  MotorMappingMeasurement,
  SpinDirectionMeasurement,
  MixerProbeMeasurement,
  EscRampMeasurement,
  PhaseSweepStepMeasurement,
  ValidationCheckResult,
  HardwareValidationReport,
  HardwareValidationTelemetry,
} from './hardware-validator';

// ── Test helpers ──────────────────────────────────────────────────────────────

/** All four motors confirmed via manual confirmation. */
function allMotorMappingConfirmed(): MotorMappingMeasurement[] {
  return [
    { motorLabel: 'A', manualConfirm: true },
    { motorLabel: 'B', manualConfirm: true },
    { motorLabel: 'C', manualConfirm: true },
    { motorLabel: 'D', manualConfirm: true },
  ];
}

/** All four motors confirmed via IMU vibration. */
function allMotorMappingViaImu(): MotorMappingMeasurement[] {
  return [
    { motorLabel: 'A', imuVibrationDetected: true },
    { motorLabel: 'B', imuVibrationDetected: true },
    { motorLabel: 'C', imuVibrationDetected: true },
    { motorLabel: 'D', imuVibrationDetected: true },
  ];
}

/** All four motors with correct spin direction via manual confirmation. */
function allSpinDirectionConfirmed(): SpinDirectionMeasurement[] {
  return [
    { motorLabel: 'A', manualConfirm: true },
    { motorLabel: 'B', manualConfirm: true },
    { motorLabel: 'C', manualConfirm: true },
    { motorLabel: 'D', manualConfirm: true },
  ];
}

/**
 * All four motors with correct spin direction via IMU yaw-rate delta.
 * CCW motors (A, C) produce positive yaw-rate delta.
 * CW  motors (B, D) produce negative yaw-rate delta.
 */
function allSpinDirectionViaImu(): SpinDirectionMeasurement[] {
  return [
    { motorLabel: 'A', imuYawRateDelta: +0.05 },  // CCW → positive
    { motorLabel: 'B', imuYawRateDelta: -0.05 },  // CW  → negative
    { motorLabel: 'C', imuYawRateDelta: +0.05 },  // CCW → positive
    { motorLabel: 'D', imuYawRateDelta: -0.05 },  // CW  → negative
  ];
}

/** Probe measurement where FC passes outputs unchanged. */
function passThroughProbe(): MixerProbeMeasurement {
  return {
    commanded: [0.3, 0.1, 0.1, 0.1],
    observed: [0.3, 0.1, 0.1, 0.1],
  };
}

/** Linear ESC ramp measurements for all four motors. */
function allEscLinearRamps(): EscRampMeasurement[] {
  return ['A', 'B', 'C', 'D'].map((label) => ({
    motorLabel: label as 'A' | 'B' | 'C' | 'D',
    levels: [0.1, 0.3, 0.5] as const,
    // Vibrations scale proportionally: 0.1→1.0, 0.3→3.0, 0.5→5.0
    vibrations: [1.0, 3.0, 5.0] as const,
  }));
}

/** Symmetric phase sweep measurements (8 steps, all equal total vibration). */
function symmetricPhaseSweep(): PhaseSweepStepMeasurement[] {
  return Array.from({ length: 8 }, (_, i) => ({
    stepIndex: i,
    phaseAngle: (2 * Math.PI * i) / 8,
    vibrationMagnitudes: [0.1, 0.1, 0.1, 0.1] as [number, number, number, number],
  }));
}

/** A passing ValidationCheckResult. */
function passing(): ValidationCheckResult { return { valid: true }; }

/** A failing ValidationCheckResult with a specific error message. */
function failing(error: string): ValidationCheckResult { return { valid: false, error }; }

/** Build a minimal GO report from all-passing results. */
function goReport(): HardwareValidationReport {
  return buildHardwareValidationReport(
    passing(), passing(), passing(), passing(), passing(),
  );
}

/** Minimal capturing pino-like logger. */
type CapturedLog = { level: 'info' | 'error'; obj: Record<string, unknown>; msg: string };
function makeCapturingLogger(): { getLogs: () => CapturedLog[]; logger: Logger } {
  const logs: CapturedLog[] = [];
  const logger = {
    info: (obj: Record<string, unknown>, msg: string) => { logs.push({ level: 'info', obj, msg }); },
    error: (obj: Record<string, unknown>, msg: string) => { logs.push({ level: 'error', obj, msg }); },
  } as unknown as Logger;
  return { getLogs: () => logs, logger };
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('hardware-validator: constants', () => {
  it('EXPECTED_MOTOR_CHANNELS has correct default channels', () => {
    assert.strictEqual(EXPECTED_MOTOR_CHANNELS.A, 0);
    assert.strictEqual(EXPECTED_MOTOR_CHANNELS.B, 1);
    assert.strictEqual(EXPECTED_MOTOR_CHANNELS.C, 2);
    assert.strictEqual(EXPECTED_MOTOR_CHANNELS.D, 3);
  });

  it('EXPECTED_SPIN_DIRECTIONS matches standard X-quad convention', () => {
    assert.strictEqual(EXPECTED_SPIN_DIRECTIONS.A, 'CCW');
    assert.strictEqual(EXPECTED_SPIN_DIRECTIONS.B, 'CW');
    assert.strictEqual(EXPECTED_SPIN_DIRECTIONS.C, 'CCW');
    assert.strictEqual(EXPECTED_SPIN_DIRECTIONS.D, 'CW');
  });

  it('MIXER_INTERFERENCE_TOLERANCE is a small positive number', () => {
    assert.ok(MIXER_INTERFERENCE_TOLERANCE > 0);
    assert.ok(MIXER_INTERFERENCE_TOLERANCE < 0.1);
  });

  it('ESC_LINEARITY_TOLERANCE is between 0 and 1', () => {
    assert.ok(ESC_LINEARITY_TOLERANCE > 0);
    assert.ok(ESC_LINEARITY_TOLERANCE <= 1);
  });

  it('PHASE_ASYMMETRY_TOLERANCE is between 0 and 1', () => {
    assert.ok(PHASE_ASYMMETRY_TOLERANCE > 0);
    assert.ok(PHASE_ASYMMETRY_TOLERANCE < 1);
  });
});

// ── validateMotorMapping ──────────────────────────────────────────────────────

describe('hardware-validator: validateMotorMapping', () => {
  describe('valid cases', () => {
    it('passes when all motors confirmed via manualConfirm=true', () => {
      const result = validateMotorMapping(allMotorMappingConfirmed());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('passes when all motors confirmed via imuVibrationDetected=true', () => {
      const result = validateMotorMapping(allMotorMappingViaImu());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('passes when motors use mixed confirmation sources', () => {
      const measurements: MotorMappingMeasurement[] = [
        { motorLabel: 'A', imuVibrationDetected: true },
        { motorLabel: 'B', manualConfirm: true },
        { motorLabel: 'C', imuVibrationDetected: true, manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      assert.strictEqual(validateMotorMapping(measurements).valid, true);
    });
  });

  describe('failure cases', () => {
    it('fails when no measurements are provided', () => {
      const result = validateMotorMapping([]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
      assert.ok(result.error?.includes('Motor B'));
      assert.ok(result.error?.includes('Motor C'));
      assert.ok(result.error?.includes('Motor D'));
    });

    it('fails when a motor entry is missing', () => {
      const measurements = allMotorMappingConfirmed().filter((m) => m.motorLabel !== 'C');
      const result = validateMotorMapping(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor C'));
    });

    it('fails with CONFIG_INVALID when imuVibrationDetected=false', () => {
      const measurements: MotorMappingMeasurement[] = [
        { motorLabel: 'A', imuVibrationDetected: false },
        { motorLabel: 'B', manualConfirm: true },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateMotorMapping(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
      assert.ok(result.error?.includes('MISMATCH'));
    });

    it('fails with CONFIG_INVALID when manualConfirm=false', () => {
      const measurements: MotorMappingMeasurement[] = [
        { motorLabel: 'A', manualConfirm: true },
        { motorLabel: 'B', manualConfirm: false },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateMotorMapping(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor B'));
      assert.ok(result.error?.includes('MISMATCH'));
    });

    it('fails with UNCONFIRMED when neither source is provided', () => {
      const measurements: MotorMappingMeasurement[] = [
        { motorLabel: 'A', manualConfirm: true },
        { motorLabel: 'B' },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateMotorMapping(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor B'));
      assert.ok(result.error?.includes('UNCONFIRMED'));
    });

    it('reports all failing motors in a single error string', () => {
      const measurements: MotorMappingMeasurement[] = [
        { motorLabel: 'A', imuVibrationDetected: false },
        { motorLabel: 'B', manualConfirm: false },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateMotorMapping(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
      assert.ok(result.error?.includes('Motor B'));
    });

    it('includes physical position description in error', () => {
      const measurements = [{ motorLabel: 'A' as const }];
      const result = validateMotorMapping(measurements);
      assert.ok(result.error?.includes('front-right'));
    });
  });
});

// ── validateSpinDirection ─────────────────────────────────────────────────────

describe('hardware-validator: validateSpinDirection', () => {
  describe('valid cases', () => {
    it('passes when all motors confirmed via manualConfirm=true', () => {
      const result = validateSpinDirection(allSpinDirectionConfirmed());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('passes with correct IMU yaw-rate deltas (CCW>0, CW<0)', () => {
      const result = validateSpinDirection(allSpinDirectionViaImu());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('passes for motor A with positive yaw-rate delta (CCW)', () => {
      const measurements: SpinDirectionMeasurement[] = [
        { motorLabel: 'A', imuYawRateDelta: +0.1 },
        ...allSpinDirectionConfirmed().filter((m) => m.motorLabel !== 'A'),
      ];
      assert.strictEqual(validateSpinDirection(measurements).valid, true);
    });

    it('passes for motor B with negative yaw-rate delta (CW)', () => {
      const measurements: SpinDirectionMeasurement[] = [
        { motorLabel: 'B', imuYawRateDelta: -0.1 },
        ...allSpinDirectionConfirmed().filter((m) => m.motorLabel !== 'B'),
      ];
      assert.strictEqual(validateSpinDirection(measurements).valid, true);
    });
  });

  describe('failure cases', () => {
    it('fails when no measurements are provided', () => {
      const result = validateSpinDirection([]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
    });

    it('fails when a motor entry is missing', () => {
      const measurements = allSpinDirectionConfirmed().filter((m) => m.motorLabel !== 'D');
      const result = validateSpinDirection(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor D'));
    });

    it('fails with MOTOR_DIRECTION_INVALID when manualConfirm=false', () => {
      const measurements: SpinDirectionMeasurement[] = [
        { motorLabel: 'A', manualConfirm: false },
        { motorLabel: 'B', manualConfirm: true },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateSpinDirection(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
      assert.ok(result.error?.includes('MOTOR_DIRECTION_INVALID'));
    });

    it('fails when CCW motor (A) has negative yaw-rate delta', () => {
      const measurements: SpinDirectionMeasurement[] = [
        { motorLabel: 'A', imuYawRateDelta: -0.05 },  // wrong: A is CCW, needs +
        { motorLabel: 'B', manualConfirm: true },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateSpinDirection(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
      assert.ok(result.error?.includes('MOTOR_DIRECTION_INVALID'));
    });

    it('fails when CW motor (B) has positive yaw-rate delta', () => {
      const measurements: SpinDirectionMeasurement[] = [
        { motorLabel: 'A', manualConfirm: true },
        { motorLabel: 'B', imuYawRateDelta: +0.05 },  // wrong: B is CW, needs -
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateSpinDirection(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor B'));
    });

    it('fails when imuYawRateDelta is non-finite', () => {
      const measurements: SpinDirectionMeasurement[] = [
        { motorLabel: 'A', imuYawRateDelta: NaN },
        { motorLabel: 'B', manualConfirm: true },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateSpinDirection(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
    });

    it('fails with UNCONFIRMED when neither IMU nor manual is provided', () => {
      const measurements: SpinDirectionMeasurement[] = [
        { motorLabel: 'A' },
        { motorLabel: 'B', manualConfirm: true },
        { motorLabel: 'C', manualConfirm: true },
        { motorLabel: 'D', manualConfirm: true },
      ];
      const result = validateSpinDirection(measurements);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
      assert.ok(result.error?.includes('MOTOR_DIRECTION_INVALID'));
    });
  });
});

// ── detectMixerInterference ───────────────────────────────────────────────────

describe('hardware-validator: detectMixerInterference', () => {
  describe('valid cases (mixer OFF)', () => {
    it('passes when commanded equals observed exactly', () => {
      const result = detectMixerInterference(passThroughProbe());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('passes when deviation is within tolerance', () => {
      const half = MIXER_INTERFERENCE_TOLERANCE / 2;
      const result = detectMixerInterference({
        commanded: [0.3, 0.1, 0.1, 0.1],
        observed: [0.3 + half, 0.1, 0.1, 0.1],
      });
      assert.strictEqual(result.valid, true);
    });

    it('passes with all-equal outputs (no asymmetry)', () => {
      const result = detectMixerInterference({
        commanded: [0.25, 0.25, 0.25, 0.25],
        observed: [0.25, 0.25, 0.25, 0.25],
      });
      assert.strictEqual(result.valid, true);
    });
  });

  describe('failure cases (mixer ON)', () => {
    it('fails when FC redistributes outputs', () => {
      const result = detectMixerInterference({
        commanded: [0.3, 0.1, 0.1, 0.1],
        observed: [0.15, 0.15, 0.15, 0.15],
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('FC_MIXER_ACTIVE'));
    });

    it('fails when deviation exceeds tolerance on any channel', () => {
      const over = MIXER_INTERFERENCE_TOLERANCE * 2;
      const result = detectMixerInterference({
        commanded: [0.3, 0.1, 0.1, 0.1],
        observed: [0.3 + over, 0.1, 0.1, 0.1],
      });
      assert.strictEqual(result.valid, false);
    });

    it('error message includes commanded and observed values', () => {
      const result = detectMixerInterference({
        commanded: [0.3, 0.1, 0.1, 0.1],
        observed: [0.2, 0.2, 0.1, 0.1],
      });
      assert.ok(result.error?.includes('Commanded'));
      assert.ok(result.error?.includes('Observed'));
    });

    it('error message includes FC_OUTPUT_MODE=passthrough hint', () => {
      const result = detectMixerInterference({
        commanded: [0.3, 0.1, 0.1, 0.1],
        observed: [0.2, 0.2, 0.1, 0.1],
      });
      assert.ok(result.error?.includes('passthrough'));
    });
  });
});

// ── validateEscLinearity ──────────────────────────────────────────────────────

describe('hardware-validator: validateEscLinearity', () => {
  describe('valid cases', () => {
    it('passes with perfectly linear proportional ramp', () => {
      const result = validateEscLinearity(allEscLinearRamps());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('passes with vibrations that slightly exceed linear', () => {
      const result = validateEscLinearity([
        { motorLabel: 'A', levels: [0.1, 0.3, 0.5], vibrations: [1.0, 4.0, 7.0] },
        ...allEscLinearRamps().filter((m) => m.motorLabel !== 'A'),
      ]);
      assert.strictEqual(result.valid, true);
    });

    it('passes with two-step ramp instead of three', () => {
      const result = validateEscLinearity(
        (['A', 'B', 'C', 'D'] as const).map((label) => ({
          motorLabel: label,
          levels: [0.1, 0.5],
          vibrations: [1.0, 5.0],
        })),
      );
      assert.strictEqual(result.valid, true);
    });
  });

  describe('failure cases', () => {
    it('fails when no measurements are provided', () => {
      const result = validateEscLinearity([]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
    });

    it('fails when a motor entry is missing', () => {
      const result = validateEscLinearity(
        allEscLinearRamps().filter((m) => m.motorLabel !== 'B'),
      );
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor B'));
    });

    it('fails with ESC_CALIBRATION_REQUIRED when levels < 2', () => {
      const result = validateEscLinearity([
        { motorLabel: 'A', levels: [0.1], vibrations: [1.0] },
        ...allEscLinearRamps().filter((m) => m.motorLabel !== 'A'),
      ]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('ESC_CALIBRATION_REQUIRED'));
      assert.ok(result.error?.includes('Motor A'));
    });

    it('fails when levels and vibrations length mismatch', () => {
      const result = validateEscLinearity([
        { motorLabel: 'A', levels: [0.1, 0.3, 0.5], vibrations: [1.0, 3.0] },
        ...allEscLinearRamps().filter((m) => m.motorLabel !== 'A'),
      ]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
    });

    it('fails when vibration does not increase with throttle', () => {
      const result = validateEscLinearity([
        { motorLabel: 'A', levels: [0.1, 0.3, 0.5], vibrations: [1.0, 0.8, 2.0] },
        ...allEscLinearRamps().filter((m) => m.motorLabel !== 'A'),
      ]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Motor A'));
      assert.ok(result.error?.includes('ESC_CALIBRATION_REQUIRED'));
      assert.ok(result.error?.includes('did not increase'));
    });

    it('fails when vibration ratio is below linearity threshold', () => {
      // throttleRatio = 3; vibrationRatio = 1.1; minAcceptable = 3 * 0.5 = 1.5
      const result = validateEscLinearity([
        { motorLabel: 'A', levels: [0.1, 0.3], vibrations: [1.0, 1.1] },
        ...allEscLinearRamps().filter((m) => m.motorLabel !== 'A'),
      ]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('nonlinear jump'));
    });
  });
});

// ── validatePhaseResponse ─────────────────────────────────────────────────────

describe('hardware-validator: validatePhaseResponse', () => {
  describe('valid cases', () => {
    it('passes with perfectly symmetric sweep', () => {
      const result = validatePhaseResponse(symmetricPhaseSweep());
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });

    it('passes with small asymmetry within tolerance', () => {
      const steps: PhaseSweepStepMeasurement[] = symmetricPhaseSweep().map(
        (s, i) => ({
          ...s,
          // Vary by 10% (< 20% tolerance)
          vibrationMagnitudes: [0.1 + (i % 2) * 0.01, 0.1, 0.1, 0.1] as [number, number, number, number],
        }),
      );
      assert.strictEqual(validatePhaseResponse(steps).valid, true);
    });

    it('passes with exactly 2 steps', () => {
      const steps: PhaseSweepStepMeasurement[] = [
        { stepIndex: 0, phaseAngle: 0,     vibrationMagnitudes: [0.1, 0.1, 0.1, 0.1] },
        { stepIndex: 1, phaseAngle: Math.PI, vibrationMagnitudes: [0.1, 0.1, 0.1, 0.1] },
      ];
      assert.strictEqual(validatePhaseResponse(steps).valid, true);
    });
  });

  describe('failure cases', () => {
    it('fails with fewer than 2 steps', () => {
      const result = validatePhaseResponse([
        { stepIndex: 0, phaseAngle: 0, vibrationMagnitudes: [0.1, 0.1, 0.1, 0.1] },
      ]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('PHASE_RESPONSE_INVALID'));
    });

    it('fails with empty step array', () => {
      const result = validatePhaseResponse([]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('PHASE_RESPONSE_INVALID'));
    });

    it('fails when vibration is zero across all steps', () => {
      const steps = symmetricPhaseSweep().map((s) => ({
        ...s,
        vibrationMagnitudes: [0, 0, 0, 0] as [number, number, number, number],
      }));
      const result = validatePhaseResponse(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('zero vibration'));
    });

    it('fails when one step has strongly asymmetric vibration', () => {
      const steps = symmetricPhaseSweep();
      // Inflate step 0 total to 10× the others
      steps[0] = {
        ...steps[0],
        vibrationMagnitudes: [1.0, 1.0, 1.0, 1.0],
      };
      const result = validatePhaseResponse(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('PHASE_RESPONSE_INVALID'));
    });

    it('includes number of asymmetric steps in error message', () => {
      const steps = symmetricPhaseSweep().map((s, i) => ({
        ...s,
        // All steps deviate wildly
        vibrationMagnitudes: [i % 2 === 0 ? 1.0 : 0.01, 0.05, 0.05, 0.05] as [number, number, number, number],
      }));
      const result = validatePhaseResponse(steps);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('steps'));
    });
  });
});

// ── buildHardwareValidationReport ────────────────────────────────────────────

describe('hardware-validator: buildHardwareValidationReport', () => {
  describe('GO report', () => {
    it('produces GO when all checks pass', () => {
      const report = goReport();
      assert.strictEqual(report.overall, 'GO');
      assert.strictEqual(report.motorMapping, 'VALID');
      assert.strictEqual(report.spinDirection, 'VALID');
      assert.strictEqual(report.fcMixer, 'OFF');
      assert.strictEqual(report.escLinear, 'VALID');
      assert.strictEqual(report.phaseResponse, 'VALID');
      assert.deepStrictEqual(report.failureReasons, []);
    });
  });

  describe('NO_GO report', () => {
    it('produces NO_GO when motor mapping fails', () => {
      const report = buildHardwareValidationReport(
        failing('mapping error'), passing(), passing(), passing(), passing(),
      );
      assert.strictEqual(report.overall, 'NO_GO');
      assert.strictEqual(report.motorMapping, 'INVALID');
      assert.ok(report.failureReasons.some((r) => r.includes('CONFIG_INVALID')));
    });

    it('produces NO_GO when spin direction fails', () => {
      const report = buildHardwareValidationReport(
        passing(), failing('direction error'), passing(), passing(), passing(),
      );
      assert.strictEqual(report.overall, 'NO_GO');
      assert.strictEqual(report.spinDirection, 'INVALID');
      assert.ok(report.failureReasons.some((r) => r.includes('MOTOR_DIRECTION_INVALID')));
    });

    it('produces NO_GO and fcMixer=ON when mixer fails', () => {
      const report = buildHardwareValidationReport(
        passing(), passing(), failing('mixer active'), passing(), passing(),
      );
      assert.strictEqual(report.overall, 'NO_GO');
      assert.strictEqual(report.fcMixer, 'ON');
      assert.ok(report.failureReasons.some((r) => r.includes('FC_MIXER_ACTIVE')));
    });

    it('produces NO_GO when ESC linearity fails', () => {
      const report = buildHardwareValidationReport(
        passing(), passing(), passing(), failing('esc nonlinear'), passing(),
      );
      assert.strictEqual(report.overall, 'NO_GO');
      assert.strictEqual(report.escLinear, 'INVALID');
      assert.ok(report.failureReasons.some((r) => r.includes('ESC_CALIBRATION_REQUIRED')));
    });

    it('produces NO_GO when phase response fails', () => {
      const report = buildHardwareValidationReport(
        passing(), passing(), passing(), passing(), failing('phase asymmetric'),
      );
      assert.strictEqual(report.overall, 'NO_GO');
      assert.strictEqual(report.phaseResponse, 'INVALID');
      assert.ok(report.failureReasons.some((r) => r.includes('PHASE_RESPONSE_INVALID')));
    });

    it('collects multiple failure reasons when multiple checks fail', () => {
      const report = buildHardwareValidationReport(
        failing('motor error'),
        failing('direction error'),
        failing('mixer error'),
        failing('esc error'),
        failing('phase error'),
      );
      assert.strictEqual(report.overall, 'NO_GO');
      assert.strictEqual(report.failureReasons.length, 5);
    });
  });
});

// ── enforceArmingGate ─────────────────────────────────────────────────────────

describe('hardware-validator: enforceArmingGate', () => {
  it('returns true and emits info log for GO report', () => {
    const { getLogs, logger } = makeCapturingLogger();
    const allowed = enforceArmingGate(goReport(), logger);
    assert.strictEqual(allowed, true);
    const logs = getLogs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].level, 'info');
    assert.ok(logs[0].msg.includes('GO'));
  });

  it('returns false and emits error log for NO_GO report', () => {
    const { getLogs, logger } = makeCapturingLogger();
    const report = buildHardwareValidationReport(
      failing('motor mismatch'), passing(), passing(), passing(), passing(),
    );
    const allowed = enforceArmingGate(report, logger);
    assert.strictEqual(allowed, false);
    const logs = getLogs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].level, 'error');
    assert.ok(logs[0].msg.includes('NO_GO'));
  });

  it('error log includes each failure reason', () => {
    const { getLogs, logger } = makeCapturingLogger();
    const report = buildHardwareValidationReport(
      failing('motor mapping error'),
      failing('spin direction error'),
      passing(),
      passing(),
      passing(),
    );
    enforceArmingGate(report, logger);
    const log = getLogs()[0];
    assert.ok(log.msg.includes('motor mapping error'));
    assert.ok(log.msg.includes('spin direction error'));
  });

  it('log object carries hardware_validation_gate type', () => {
    const { getLogs, logger } = makeCapturingLogger();
    enforceArmingGate(goReport(), logger);
    assert.strictEqual((getLogs()[0].obj as { type: string }).type, 'hardware_validation_gate');
  });

  it('log object includes the full report', () => {
    const { getLogs, logger } = makeCapturingLogger();
    const report = goReport();
    enforceArmingGate(report, logger);
    const obj = getLogs()[0].obj as { report: HardwareValidationReport };
    assert.deepStrictEqual(obj.report, report);
  });
});

// ── emitHardwareValidationTelemetry ──────────────────────────────────────────

describe('hardware-validator: emitHardwareValidationTelemetry', () => {
  it('emits a hardware_validation telemetry frame', () => {
    const { getLogs, logger } = makeCapturingLogger();
    emitHardwareValidationTelemetry('motor_mapping', 'PASS', { motorLabel: 'A' }, logger);
    const logs = getLogs();
    assert.strictEqual(logs.length, 1);
    const frame = logs[0].obj as HardwareValidationTelemetry;
    assert.strictEqual(frame.type, 'hardware_validation');
    assert.strictEqual(frame.step, 'motor_mapping');
    assert.strictEqual(frame.result, 'PASS');
    assert.deepStrictEqual(frame.details, { motorLabel: 'A' });
  });

  it('emits FAIL result', () => {
    const { getLogs, logger } = makeCapturingLogger();
    emitHardwareValidationTelemetry('esc_linearity', 'FAIL', { motor: 'B' }, logger);
    const frame = getLogs()[0].obj as HardwareValidationTelemetry;
    assert.strictEqual(frame.result, 'FAIL');
  });

  it('emits WARN result', () => {
    const { getLogs, logger } = makeCapturingLogger();
    emitHardwareValidationTelemetry('phase_response', 'WARN', {}, logger);
    const frame = getLogs()[0].obj as HardwareValidationTelemetry;
    assert.strictEqual(frame.result, 'WARN');
  });

  it('message includes step name and result', () => {
    const { getLogs, logger } = makeCapturingLogger();
    emitHardwareValidationTelemetry('spin_direction', 'PASS', {}, logger);
    assert.ok(getLogs()[0].msg.includes('spin_direction'));
    assert.ok(getLogs()[0].msg.includes('PASS'));
  });

  it('details object is included in the emitted frame', () => {
    const { getLogs, logger } = makeCapturingLogger();
    const details = { channel: 2, expected: 0.3, observed: 0.15 };
    emitHardwareValidationTelemetry('mixer_probe', 'FAIL', details, logger);
    const frame = getLogs()[0].obj as HardwareValidationTelemetry;
    assert.deepStrictEqual(frame.details, details);
  });
});

// ── Integration: end-to-end validation flow ───────────────────────────────────

describe('hardware-validator: end-to-end validation flow', () => {
  it('produces GO report when all measurements are valid', () => {
    const motorMapping = validateMotorMapping(allMotorMappingConfirmed());
    const spinDirection = validateSpinDirection(allSpinDirectionViaImu());
    const mixerResult = detectMixerInterference(passThroughProbe());
    const escLinearity = validateEscLinearity(allEscLinearRamps());
    const phaseResponse = validatePhaseResponse(symmetricPhaseSweep());
    const report = buildHardwareValidationReport(
      motorMapping, spinDirection, mixerResult, escLinearity, phaseResponse,
    );
    assert.strictEqual(report.overall, 'GO');
    assert.deepStrictEqual(report.failureReasons, []);
  });

  it('produces NO_GO report when mixer is active', () => {
    const motorMapping = validateMotorMapping(allMotorMappingConfirmed());
    const spinDirection = validateSpinDirection(allSpinDirectionViaImu());
    const mixerResult = detectMixerInterference({
      commanded: [0.3, 0.1, 0.1, 0.1],
      observed: [0.15, 0.15, 0.15, 0.15],
    });
    const escLinearity = validateEscLinearity(allEscLinearRamps());
    const phaseResponse = validatePhaseResponse(symmetricPhaseSweep());
    const report = buildHardwareValidationReport(
      motorMapping, spinDirection, mixerResult, escLinearity, phaseResponse,
    );
    assert.strictEqual(report.overall, 'NO_GO');
    assert.strictEqual(report.fcMixer, 'ON');
  });

  it('arming gate blocks when report is NO_GO', () => {
    const { logger } = makeCapturingLogger();
    const report = buildHardwareValidationReport(
      failing('test error'), passing(), passing(), passing(), passing(),
    );
    assert.strictEqual(enforceArmingGate(report, logger), false);
  });

  it('arming gate allows when report is GO', () => {
    const { logger } = makeCapturingLogger();
    assert.strictEqual(enforceArmingGate(goReport(), logger), true);
  });
});
