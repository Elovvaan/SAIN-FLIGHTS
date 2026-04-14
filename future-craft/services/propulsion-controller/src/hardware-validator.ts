/**
 * Hardware Validator — pre-flight hardware truth validation layer.
 *
 * Implements MOTOR TRUTH VALIDATION, SPIN DIRECTION VALIDATION,
 * FC MIXER DETECTION, ESC LINEARITY CHECK, and PHASE RESPONSE VALIDATION
 * before first tethered lift.
 *
 * Constraints:
 *   - Does NOT modify field-solver, stabilizer, or translator.
 *   - Only validates and enforces execution correctness.
 *   - Any uncertainty = BLOCK ARMING (NO_GO).
 *
 * All validation functions are pure and side-effect-free.
 * Results feed into the ARMING GATE which blocks arming on any failure.
 *
 * Motor layout (software convention):
 *   A = front-right  (physical channel 0 by default)
 *   B = rear-right   (physical channel 1 by default)
 *   C = rear-left    (physical channel 2 by default)
 *   D = front-left   (physical channel 3 by default)
 *
 * Spin directions (when viewed from above):
 *   A (front-right): CCW — produces positive yaw-rate delta on craft
 *   B (rear-right):  CW  — produces negative yaw-rate delta on craft
 *   C (rear-left):   CCW — produces positive yaw-rate delta on craft
 *   D (front-left):  CW  — produces negative yaw-rate delta on craft
 */

import type { Logger } from 'pino';
import type { MotorLabel } from './actuator-router';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Expected physical channel index for each logical motor label (default wiring). */
export const EXPECTED_MOTOR_CHANNELS: Record<MotorLabel, number> = {
  A: 0, // front-right
  B: 1, // rear-right
  C: 2, // rear-left
  D: 3, // front-left
};

/**
 * Expected spin direction for each motor (when viewed from above).
 * CCW motors react with positive yaw-rate torque on the craft.
 * CW  motors react with negative yaw-rate torque on the craft.
 */
export const EXPECTED_SPIN_DIRECTIONS: Record<MotorLabel, 'CW' | 'CCW'> = {
  A: 'CCW', // front-right
  B: 'CW',  // rear-right
  C: 'CCW', // rear-left
  D: 'CW',  // front-left
};

/**
 * Tolerance for mixer interference detection.
 * If any channel deviates from commanded by more than this fraction, the
 * FC mixer is considered ACTIVE.
 */
export const MIXER_INTERFERENCE_TOLERANCE = 0.01;

/**
 * Minimum vibration-to-throttle ratio expected across a ramp step.
 * vibration[i] / vibration[i-1] must be >= throttle[i] / throttle[i-1] * this.
 * Values below this indicate a nonlinear (sticky/stalled) ESC response.
 */
export const ESC_LINEARITY_TOLERANCE = 0.5;

/**
 * Maximum fractional deviation of any phase-step's total vibration from the
 * mean across all steps.  Values above this indicate directional bias in the
 * phase response.
 */
export const PHASE_ASYMMETRY_TOLERANCE = 0.2;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Measurement for a single-motor isolation step.
 *
 * Evidence source must be at least one of imuVibrationDetected or manualConfirm.
 * If neither is provided the step is treated as UNCONFIRMED → NO_GO.
 */
export type MotorMappingMeasurement = {
  /** Which logical motor was activated in isolation. */
  motorLabel: MotorLabel;
  /**
   * True when the IMU micro-vibration signature confirms the correct physical
   * motor spun; false when IMU confirms the wrong motor; undefined when no
   * IMU measurement was collected.
   */
  imuVibrationDetected?: boolean;
  /**
   * True when the operator manually confirmed the correct physical motor spun;
   * false when the operator confirmed a mismatch; undefined when not checked.
   */
  manualConfirm?: boolean;
};

/**
 * Measurement for spin-direction validation of a single motor.
 *
 * Evidence source must be at least one of imuYawRateDelta or manualConfirm.
 */
export type SpinDirectionMeasurement = {
  /** Which motor was tested. */
  motorLabel: MotorLabel;
  /**
   * IMU yaw-rate delta (rad/s) observed while this motor spun in isolation.
   *   Positive → craft torques CW  (motor reaction = CCW).
   *   Negative → craft torques CCW (motor reaction = CW).
   * Undefined when no IMU measurement was collected.
   */
  imuYawRateDelta?: number;
  /**
   * True when the operator confirmed the spin direction is correct;
   * false when the operator confirmed a mismatch; undefined when not checked.
   */
  manualConfirm?: boolean;
};

/**
 * Measurement for FC mixer interference detection.
 *
 * Method: send asymmetric [0.3, 0.1, 0.1, 0.1] and compare commanded vs observed.
 */
export type MixerProbeMeasurement = {
  /** The asymmetric output commanded to the FC: e.g. [0.3, 0.1, 0.1, 0.1]. */
  commanded: [number, number, number, number];
  /** What was actually applied at the ESC level after the FC processed it. */
  observed: [number, number, number, number];
};

/**
 * Measurement for ESC linearity check on a single motor.
 *
 * The ramp sequence must contain at least 2 ascending throttle levels with a
 * corresponding vibration magnitude (IMU proxy for RPM) at each level.
 */
export type EscRampMeasurement = {
  /** Which motor was ramped. */
  motorLabel: MotorLabel;
  /** Throttle levels applied in ascending sequence, e.g. [0.1, 0.3, 0.5]. */
  levels: readonly number[];
  /** IMU vibration magnitudes measured at each throttle level. */
  vibrations: readonly number[];
};

/**
 * Measurement for a single step of the phase-response sweep (0 → 2π).
 */
export type PhaseSweepStepMeasurement = {
  /** Step index (0-based). */
  stepIndex: number;
  /** Phase angle for this step in radians. */
  phaseAngle: number;
  /** Vibration magnitudes observed at each of the 4 motor positions. */
  vibrationMagnitudes: [number, number, number, number];
};

/** Result of a single validation check. */
export type ValidationCheckResult = {
  /** True only when the check passed. */
  valid: boolean;
  /** Human-readable failure description (undefined when valid). */
  error?: string;
};

/**
 * Final hardware validation report.
 *
 * overall = GO only when every check passes.  Any single failure → NO_GO.
 */
export type HardwareValidationReport = {
  /** Whether all logical motors map to the expected physical channels. */
  motorMapping: 'VALID' | 'INVALID';
  /** Whether all motors spin in the expected direction. */
  spinDirection: 'VALID' | 'INVALID';
  /** Whether the FC mixer is interfering with actuator outputs. */
  fcMixer: 'OFF' | 'ON';
  /** Whether ESC throttle-to-RPM response is linear. */
  escLinear: 'VALID' | 'INVALID';
  /** Whether the phase-sweep vibration pattern is symmetric. */
  phaseResponse: 'VALID' | 'INVALID';
  /** GO = all checks passed; NO_GO = at least one check failed. */
  overall: 'GO' | 'NO_GO';
  /** Exact failure reasons when overall is NO_GO. Empty when GO. */
  failureReasons: string[];
};

/** Structured telemetry event emitted for each hardware validation step. */
export type HardwareValidationTelemetry = {
  type: 'hardware_validation';
  step: string;
  result: 'PASS' | 'FAIL' | 'WARN';
  details: Record<string, unknown>;
};

// ── 1. Motor Mapping Validation ───────────────────────────────────────────────

/**
 * Validate that each logical motor label maps to the correct physical motor.
 *
 * For each label the check requires at least one positive evidence source:
 *   - imuVibrationDetected === true  (IMU micro-vibration confirms correct motor)
 *   - manualConfirm === true         (operator confirmed correct motor spun)
 *
 * A negative evidence (false) marks the motor as MISMATCH → CONFIG_INVALID.
 * No evidence marks the motor as UNCONFIRMED → CONFIG_INVALID.
 *
 * @param measurements  One entry per motor label (A, B, C, D required).
 */
export function validateMotorMapping(
  measurements: MotorMappingMeasurement[],
): ValidationCheckResult {
  const labels: MotorLabel[] = ['A', 'B', 'C', 'D'];
  const errors: string[] = [];

  for (const label of labels) {
    const m = measurements.find((x) => x.motorLabel === label);
    if (!m) {
      errors.push(
        `Motor ${label} (${motorPosition(label)}): no measurement provided — ` +
        'CONFIG_INVALID: mapping cannot be confirmed.',
      );
      continue;
    }

    const confirmed = m.imuVibrationDetected === true || m.manualConfirm === true;
    const denied =
      m.imuVibrationDetected === false || m.manualConfirm === false;

    if (!confirmed) {
      if (denied) {
        errors.push(
          `Motor ${label} (${motorPosition(label)}): CONFIG_INVALID — ` +
          'mapping MISMATCH: vibration/confirmation indicates wrong physical motor spun.',
        );
      } else {
        errors.push(
          `Motor ${label} (${motorPosition(label)}): CONFIG_INVALID — ` +
          'mapping UNCONFIRMED: no vibration detected and no manual confirmation provided.',
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  };
}

// ── 2. Spin Direction Validation ──────────────────────────────────────────────

/**
 * Validate that each motor spins in the expected direction.
 *
 * Expected directions (see EXPECTED_SPIN_DIRECTIONS):
 *   A (front-right): CCW → positive imuYawRateDelta on the craft
 *   B (rear-right):  CW  → negative imuYawRateDelta on the craft
 *   C (rear-left):   CCW → positive imuYawRateDelta on the craft
 *   D (front-left):  CW  → negative imuYawRateDelta on the craft
 *
 * Manual confirmation bypasses the IMU check.
 *
 * @param measurements  One entry per motor label (A, B, C, D required).
 */
export function validateSpinDirection(
  measurements: SpinDirectionMeasurement[],
): ValidationCheckResult {
  const labels: MotorLabel[] = ['A', 'B', 'C', 'D'];
  const errors: string[] = [];

  for (const label of labels) {
    const m = measurements.find((x) => x.motorLabel === label);
    if (!m) {
      errors.push(
        `Motor ${label}: no spin-direction measurement provided — ` +
        'MOTOR_DIRECTION_INVALID.',
      );
      continue;
    }

    const expectedDir = EXPECTED_SPIN_DIRECTIONS[label];

    // Manual confirmation takes priority.
    if (m.manualConfirm === true) continue;
    if (m.manualConfirm === false) {
      errors.push(
        `Motor ${label} (${motorPosition(label)}): MOTOR_DIRECTION_INVALID — ` +
        `manually confirmed as INCORRECT (expected ${expectedDir}).`,
      );
      continue;
    }

    // Use IMU yaw-rate delta when provided.
    if (m.imuYawRateDelta !== undefined) {
      if (!Number.isFinite(m.imuYawRateDelta)) {
        errors.push(
          `Motor ${label}: MOTOR_DIRECTION_INVALID — ` +
          `non-finite imuYawRateDelta (${m.imuYawRateDelta}).`,
        );
        continue;
      }
      // CCW motor → craft torques CW → positive yaw-rate delta.
      // CW  motor → craft torques CCW → negative yaw-rate delta.
      const expectedPositive = expectedDir === 'CCW';
      const observedPositive = m.imuYawRateDelta > 0;
      if (expectedPositive !== observedPositive) {
        errors.push(
          `Motor ${label} (${motorPosition(label)}): MOTOR_DIRECTION_INVALID — ` +
          `expected ${expectedDir} (yaw delta ${expectedPositive ? '> 0' : '< 0'}) ` +
          `but observed yaw delta ${m.imuYawRateDelta.toFixed(4)}.`,
        );
      }
    } else {
      errors.push(
        `Motor ${label}: MOTOR_DIRECTION_INVALID — ` +
        'no IMU yaw-rate delta and no manual confirmation provided.',
      );
    }
  }

  return {
    valid: errors.length === 0,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  };
}

// ── 3. FC Mixer Interference Detection ───────────────────────────────────────

/**
 * Detect FC mixer interference by comparing commanded vs observed outputs.
 *
 * Method: send asymmetric [0.3, 0.1, 0.1, 0.1] to the FC and observe what
 * actually reaches the ESCs.  If any channel deviates from commanded by more
 * than MIXER_INTERFERENCE_TOLERANCE, the FC mixer is considered ACTIVE.
 *
 * @param measurement  Commanded and observed output vectors.
 */
export function detectMixerInterference(
  measurement: MixerProbeMeasurement,
): ValidationCheckResult {
  const { commanded, observed } = measurement;

  const deviations = commanded.map((v, i) => Math.abs(v - observed[i]));
  const maxDeviation = Math.max(...deviations);
  const mixerActive = maxDeviation > MIXER_INTERFERENCE_TOLERANCE;

  if (mixerActive) {
    return {
      valid: false,
      error:
        `FC_MIXER_ACTIVE — FC modified asymmetric probe outputs ` +
        `(max deviation ${maxDeviation.toFixed(4)} > tolerance ${MIXER_INTERFERENCE_TOLERANCE}). ` +
        `Commanded: [${commanded.map((v) => v.toFixed(3)).join(', ')}]; ` +
        `Observed: [${observed.map((v) => v.toFixed(3)).join(', ')}]. ` +
        'Set FC_OUTPUT_MODE=passthrough and configure the FC for passthrough mode.',
    };
  }

  return { valid: true };
}

// ── 4. ESC Linearity Check ────────────────────────────────────────────────────

/**
 * Validate ESC linearity by checking that IMU vibration magnitudes increase
 * proportionally with throttle across the ramp sequence [0.1 → 0.3 → 0.5].
 *
 * Two failure conditions:
 *   1. Vibration does not increase as throttle increases (non-monotone).
 *   2. Vibration ratio is less than throttle ratio × ESC_LINEARITY_TOLERANCE
 *      (nonlinear jump / stalled ESC).
 *
 * @param measurements  One entry per motor label (A, B, C, D required).
 */
export function validateEscLinearity(
  measurements: EscRampMeasurement[],
): ValidationCheckResult {
  const labels: MotorLabel[] = ['A', 'B', 'C', 'D'];
  const errors: string[] = [];

  for (const label of labels) {
    const m = measurements.find((x) => x.motorLabel === label);
    if (!m) {
      errors.push(
        `Motor ${label}: ESC_CALIBRATION_REQUIRED — no ramp measurement provided.`,
      );
      continue;
    }

    if (m.levels.length < 2 || m.vibrations.length !== m.levels.length) {
      errors.push(
        `Motor ${label}: ESC_CALIBRATION_REQUIRED — insufficient ramp data ` +
        `(${m.levels.length} levels, ${m.vibrations.length} vibrations; need ≥ 2 matched pairs).`,
      );
      continue;
    }

    let motorFailed = false;
    for (let i = 1; i < m.levels.length && !motorFailed; i++) {
      const prevVib = m.vibrations[i - 1];
      const currVib = m.vibrations[i];

      // 1. Vibration must increase.
      if (currVib <= prevVib) {
        errors.push(
          `Motor ${label}: ESC_CALIBRATION_REQUIRED — vibration did not increase ` +
          `at throttle ${m.levels[i].toFixed(2)} ` +
          `(was ${prevVib.toFixed(4)}, got ${currVib.toFixed(4)}).`,
        );
        motorFailed = true;
        continue;
      }

      // 2. Vibration ratio must be proportional to throttle ratio.
      const throttleRatio = m.levels[i] / m.levels[i - 1];
      const vibrationRatio = currVib / Math.max(prevVib, 1e-9);
      const minAcceptableRatio = throttleRatio * ESC_LINEARITY_TOLERANCE;

      if (vibrationRatio < minAcceptableRatio) {
        errors.push(
          `Motor ${label}: ESC_CALIBRATION_REQUIRED — nonlinear jump at ` +
          `throttle step ${m.levels[i - 1].toFixed(2)}→${m.levels[i].toFixed(2)}: ` +
          `vibration ratio ${vibrationRatio.toFixed(3)} < ` +
          `expected ≥ ${minAcceptableRatio.toFixed(3)}.`,
        );
        motorFailed = true;
      }
    }
  }

  return {
    valid: errors.length === 0,
    error: errors.length > 0 ? errors.join(' | ') : undefined,
  };
}

// ── 5. Phase Response Validation ─────────────────────────────────────────────

/**
 * Validate phase-response symmetry across a full 0 → 2π sweep.
 *
 * Computes the total vibration magnitude per step and checks that no step
 * deviates from the mean by more than PHASE_ASYMMETRY_TOLERANCE.
 *
 * Expected: smooth rotational pattern, no directional bias.
 *
 * @param steps  Ordered measurements from all phase-sweep steps.
 */
export function validatePhaseResponse(
  steps: PhaseSweepStepMeasurement[],
): ValidationCheckResult {
  if (steps.length < 2) {
    return {
      valid: false,
      error:
        'PHASE_RESPONSE_INVALID — fewer than 2 phase-sweep steps provided; ' +
        'cannot assess symmetry.',
    };
  }

  const totals = steps.map((s) =>
    s.vibrationMagnitudes.reduce((sum, v) => sum + v, 0),
  );
  const mean = totals.reduce((sum, v) => sum + v, 0) / totals.length;

  if (mean <= 0) {
    return {
      valid: false,
      error:
        'PHASE_RESPONSE_INVALID — zero vibration across all phase steps; ' +
        'motors may not be spinning.',
    };
  }

  const asymmetricSteps = totals
    .map((v, i) => ({ step: steps[i].stepIndex, deviation: Math.abs(v - mean) / mean }))
    .filter(({ deviation }) => deviation > PHASE_ASYMMETRY_TOLERANCE);

  if (asymmetricSteps.length > 0) {
    const details = asymmetricSteps
      .map(({ step, deviation }) => `step ${step}: ${(deviation * 100).toFixed(1)}%`)
      .join(', ');
    return {
      valid: false,
      error:
        `PHASE_RESPONSE_INVALID — ${asymmetricSteps.length} of ${steps.length} steps ` +
        `exceed ${(PHASE_ASYMMETRY_TOLERANCE * 100).toFixed(0)}% asymmetry ` +
        `(mean vibration ${mean.toFixed(4)}): ${details}.`,
    };
  }

  return { valid: true };
}

// ── 6. Hardware Validation Report ────────────────────────────────────────────

/**
 * Build the final hardware validation report from individual check results.
 *
 * overall = GO only when all five checks pass.
 */
export function buildHardwareValidationReport(
  motorMappingResult: ValidationCheckResult,
  spinDirectionResult: ValidationCheckResult,
  mixerResult: ValidationCheckResult,
  escLinearityResult: ValidationCheckResult,
  phaseResponseResult: ValidationCheckResult,
): HardwareValidationReport {
  const failureReasons: string[] = [];

  if (!motorMappingResult.valid && motorMappingResult.error) {
    failureReasons.push(`[CONFIG_INVALID] ${motorMappingResult.error}`);
  }
  if (!spinDirectionResult.valid && spinDirectionResult.error) {
    failureReasons.push(`[MOTOR_DIRECTION_INVALID] ${spinDirectionResult.error}`);
  }
  if (!mixerResult.valid && mixerResult.error) {
    failureReasons.push(`[FC_MIXER_ACTIVE] ${mixerResult.error}`);
  }
  if (!escLinearityResult.valid && escLinearityResult.error) {
    failureReasons.push(`[ESC_CALIBRATION_REQUIRED] ${escLinearityResult.error}`);
  }
  if (!phaseResponseResult.valid && phaseResponseResult.error) {
    failureReasons.push(`[PHASE_RESPONSE_INVALID] ${phaseResponseResult.error}`);
  }

  return {
    motorMapping: motorMappingResult.valid ? 'VALID' : 'INVALID',
    spinDirection: spinDirectionResult.valid ? 'VALID' : 'INVALID',
    fcMixer: mixerResult.valid ? 'OFF' : 'ON',
    escLinear: escLinearityResult.valid ? 'VALID' : 'INVALID',
    phaseResponse: phaseResponseResult.valid ? 'VALID' : 'INVALID',
    overall: failureReasons.length === 0 ? 'GO' : 'NO_GO',
    failureReasons,
  };
}

// ── 7. Arming Gate ────────────────────────────────────────────────────────────

/**
 * Enforce the hardware validation arming gate.
 *
 * Returns true (arming ALLOWED) when overall = GO.
 * Returns false (arming BLOCKED) and logs exact failure reasons when NO_GO.
 *
 * System MUST enforce: IF overall != GO → prevent ARM.
 *
 * @param report  Hardware validation report from buildHardwareValidationReport().
 * @param logger  Pino logger instance.
 */
export function enforceArmingGate(
  report: HardwareValidationReport,
  logger: Logger,
): boolean {
  if (report.overall === 'GO') {
    logger.info(
      { type: 'hardware_validation_gate', result: 'GO', report },
      '✅ HARDWARE VALIDATION: GO — all checks passed, arming allowed.',
    );
    return true;
  }

  logger.error(
    {
      type: 'hardware_validation_gate',
      result: 'NO_GO',
      report,
      failureReasons: report.failureReasons,
    },
    [
      '⛔ ARMING BLOCKED — HARDWARE VALIDATION: NO_GO',
      ...report.failureReasons.map((r) => `  • ${r}`),
    ].join('\n'),
  );
  return false;
}

// ── 8. Telemetry ──────────────────────────────────────────────────────────────

/**
 * Emit a structured hardware_validation telemetry event.
 *
 * Format:
 *   { type: "hardware_validation", step, result, details }
 *
 * @param step     Name of the validation step (e.g. "motor_mapping").
 * @param result   PASS, FAIL, or WARN.
 * @param details  Additional step-specific context.
 * @param logger   Pino logger instance.
 */
export function emitHardwareValidationTelemetry(
  step: string,
  result: 'PASS' | 'FAIL' | 'WARN',
  details: Record<string, unknown>,
  logger: Logger,
): void {
  const event: HardwareValidationTelemetry = {
    type: 'hardware_validation',
    step,
    result,
    details,
  };
  logger.info(event, `hardware_validation: ${step} → ${result}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable physical motor position for a logical label. */
function motorPosition(label: MotorLabel): string {
  const positions: Record<MotorLabel, string> = {
    A: 'front-right',
    B: 'rear-right',
    C: 'rear-left',
    D: 'front-left',
  };
  return positions[label];
}
