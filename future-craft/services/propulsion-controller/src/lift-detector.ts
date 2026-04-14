/**
 * Lift Detector — determines whether the craft has left the ground.
 *
 * Uses consecutive IMU attitude snapshots to estimate angular motion from
 * roll/pitch deltas, plus optional altitude rise when available.
 * No hardware-specific sensors are required beyond the standard IMU state
 * that is already available in the field-stabilizer pipeline.
 *
 * Detection algorithm:
 *   Primary   — angular-motion spike:
 *     The magnitude of the combined roll+pitch change between two consecutive
 *     ticks is converted to an estimated angular-rate magnitude. If that
 *     estimate exceeds a threshold, lift is reported.
 *
 *   Secondary — altitude rise:
 *     When altitude data is available, a rise of ≥ ALT_RISE_THRESHOLD_M above
 *     the reference altitude confirms lift.
 *
 * Safety contract:
 *   - Returns { liftDetected: false } when IMU is invalid.
 *   - Pure function; no internal state mutated.
 *   - If both primary and secondary detect lift, "altitude_rise" is the reported method.
 */

import type { ImuState } from './field-stabilizer';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Result returned by detectLift(). */
export type LiftDetectionResult = {
  /** True when lift has been confirmed. */
  liftDetected: boolean;
  /** Detection method used (for telemetry / log context). */
  method?: 'acceleration_spike' | 'altitude_rise';
};

/** Thresholds for lift detection. */
export type LiftDetectorConfig = {
  /**
   * Minimum angular-rate magnitude (rad/s, estimated from consecutive
   * roll/pitch snapshots) that indicates sufficient motion to classify as lift.
   * Default: 0.05 rad/s (very small motion indicating leave of ground).
   */
  accelSpikeThresholdRadS: number;
  /**
   * Minimum altitude rise (metres) above the reference altitude to confirm lift
   * when altitude data is available.
   * Default: 0.05 m (5 cm).
   */
  altRiseThresholdM: number;
};

/** Default thresholds for safe-lift first-flight lift detection. */
export const DEFAULT_LIFT_DETECTOR_CONFIG: LiftDetectorConfig = {
  accelSpikeThresholdRadS: 0.05,
  altRiseThresholdM: 0.05,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect whether the craft has lifted off based on consecutive IMU snapshots.
 *
 * @param imuState       Current IMU reading.
 * @param prevImuState   Previous IMU reading (used for rate estimation).
 * @param dtSeconds      Time delta between readings (seconds).
 * @param refAltitudeM   Ground-reference altitude (metres); used only when
 *                       imuState.altitude is present.
 * @param config         Detection thresholds.
 * @returns              LiftDetectionResult.
 */
export function detectLift(
  imuState: ImuState,
  prevImuState: ImuState,
  dtSeconds: number,
  refAltitudeM?: number,
  config: LiftDetectorConfig = DEFAULT_LIFT_DETECTOR_CONFIG,
): LiftDetectionResult {
  if (!imuState.valid) {
    return { liftDetected: false };
  }

  // ── Secondary: altitude rise confirmation ──────────────────────────────────
  if (
    refAltitudeM !== undefined &&
    imuState.altitude !== undefined &&
    Number.isFinite(imuState.altitude)
  ) {
    const rise = imuState.altitude - refAltitudeM;
    if (rise >= config.altRiseThresholdM) {
      return { liftDetected: true, method: 'altitude_rise' };
    }
  }

  // ── Primary: angular acceleration spike ───────────────────────────────────
  if (prevImuState.valid && dtSeconds > 0) {
    const dRoll  = imuState.roll  - prevImuState.roll;
    const dPitch = imuState.pitch - prevImuState.pitch;
    const rateEstimate = Math.sqrt(dRoll * dRoll + dPitch * dPitch) / dtSeconds;
    if (rateEstimate >= config.accelSpikeThresholdRadS) {
      return { liftDetected: true, method: 'acceleration_spike' };
    }
  }

  return { liftDetected: false };
}
