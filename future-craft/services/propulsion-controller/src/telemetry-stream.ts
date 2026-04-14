/**
 * Telemetry Stream — per-tick structured telemetry emitter.
 *
 * Emits a lightweight, human-readable telemetry frame on every field-loop tick.
 * The frame captures the full field state, actuator outputs, IMU snapshot, and
 * computed stability score.
 *
 * Frame format (per tick):
 * {
 *   type:           'telemetry_tick',
 *   flightPhase:    FlightPhase,
 *   phase:          number,         // field phase angle (rad)
 *   bias:           number,         // field bias (−1..1)
 *   intensity:      number,         // field intensity (0–100)
 *   outputs:        [A, B, C, D],   // solved motor outputs [0..1]
 *   imu:            { pitch, roll, yaw, altitude? },
 *   stabilityScore: number,         // 0 = stable, 1 = at limit
 *   timestamp:      ISO-8601 string
 * }
 *
 * The frame is emitted as a pino INFO log so it appears inline in the existing
 * structured log stream.  All numeric values are rounded to 4 decimal places
 * to keep logs compact.
 */

import type { Logger } from 'pino';
import type { FieldState } from './field-solver';
import type { ImuState } from './field-stabilizer';
import type { FlightPhase } from './flight-state-machine';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single telemetry frame emitted per field-loop tick. */
export type TelemetryFrame = {
  type: 'telemetry_tick';
  flightPhase: FlightPhase;
  phase: number;
  bias: number;
  intensity: number;
  outputs: [number, number, number, number];
  imu: {
    pitch: number;
    roll: number;
    yaw: number;
    altitude?: number;
  };
  stabilityScore: number;
  timestamp: string;
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build and emit a telemetry frame for the current tick.
 *
 * @param flightPhase     Current flight-state-machine phase.
 * @param fieldState      Current field state (after all corrections).
 * @param solvedOutputs   Solved [A, B, C, D] motor outputs from field-solver.
 * @param imuState        Latest IMU snapshot.
 * @param stabilityScore  Scalar [0, 1] stability score (from instability-detector).
 * @param logger          Pino logger instance to emit on.
 */
export function emitTelemetry(
  flightPhase: FlightPhase,
  fieldState: FieldState,
  solvedOutputs: [number, number, number, number],
  imuState: ImuState,
  stabilityScore: number,
  logger: Logger,
): void {
  const frame: TelemetryFrame = {
    type: 'telemetry_tick',
    flightPhase,
    phase: r4(fieldState.phase),
    bias: r4(fieldState.bias),
    intensity: r4(fieldState.intensity),
    outputs: [
      r4(solvedOutputs[0]),
      r4(solvedOutputs[1]),
      r4(solvedOutputs[2]),
      r4(solvedOutputs[3]),
    ],
    imu: {
      pitch: r4(imuState.pitch),
      roll: r4(imuState.roll),
      yaw: r4(imuState.yaw),
      ...(imuState.altitude !== undefined
        ? { altitude: r4(imuState.altitude) }
        : {}),
    },
    stabilityScore: r4(stabilityScore),
    timestamp: new Date().toISOString(),
  };

  logger.info(frame, 'telemetry');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Round to 4 decimal places for compact log output. */
function r4(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10000) / 10000;
}
