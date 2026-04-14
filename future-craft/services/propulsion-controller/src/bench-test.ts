/**
 * Bench-test sequence generator for motor routing verification.
 *
 * Generates a deterministic sequence of actuator output vectors that can be
 * used to verify software-to-hardware motor mapping WITHOUT free flight.
 *
 * Sequence (in order):
 *   1. A only           — confirm motor A (front-right) routing
 *   2. B only           — confirm motor B (rear-right) routing
 *   3. C only           — confirm motor C (rear-left) routing
 *   4. D only           — confirm motor D (front-left) routing
 *   5. A + C            — confirm front-right / rear-left diagonal pair
 *   6. B + D            — confirm rear-right / front-left diagonal pair
 *   7–14. Phase sweep   — 8-step low-amplitude rotating phase (45° increments)
 *                         to confirm differential routing across all motors
 *
 * All logical outputs are in [0, 1] and pass through the ActuatorRouter so
 * every log entry captures both the logical [A,B,C,D] vector and the resolved
 * physical channel values.  No motors run above BENCH_MOTOR_LEVEL during steps
 * 1–6, making the sequence safe to run on a benched, propeller-free vehicle.
 *
 * Usage:
 *   import { generateBenchSequence } from './bench-test';
 *   const steps = generateBenchSequence(routerConfig);
 *   for (const step of steps) {
 *     logger.info({ step: step.label, ...buildActuatorRouteLog(step.routed, outputMode) });
 *     await flightCtrl.setActuatorOutputs(step.routed.physical);
 *   }
 */

import type { ActuatorRouterConfig, RoutedActuatorOutputs } from './actuator-router';
import { routeActuatorOutputs } from './actuator-router';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Throttle level used for single-motor and pair steps (low power for bench testing). */
export const BENCH_MOTOR_LEVEL = 0.15;

/** Number of phase steps in the rotating phase sweep. */
export const PHASE_SWEEP_STEPS = 8;

/** Base output fraction for the phase-sweep step. */
const SWEEP_BASE = 0.12;

/** Modulation amplitude for the phase sweep. */
const SWEEP_AMPLITUDE = 0.05;

// ── Types ─────────────────────────────────────────────────────────────────────

export type BenchStepLabel =
  | 'A_ONLY'
  | 'B_ONLY'
  | 'C_ONLY'
  | 'D_ONLY'
  | 'A_AND_C'
  | 'B_AND_D'
  | `PHASE_SWEEP_${number}`;

export type BenchStep = {
  /** Human-readable step identifier. */
  label: BenchStepLabel;
  /** Logical [A, B, C, D] command in software motor space. */
  logical: [number, number, number, number];
  /** Routed result including physical channel values and diagnostics. */
  routed: RoutedActuatorOutputs;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Compute a single-step rotating-phase output for SWEEP steps.
 * Uses the same 90° motor-phase offsets as field-solver.ts.
 */
function sweepOutputs(
  step: number,
  totalSteps: number,
): [number, number, number, number] {
  const phase = (2 * Math.PI * step) / totalSteps;
  const offsets = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] as const;
  return offsets.map((o) =>
    clamp01(SWEEP_BASE + SWEEP_AMPLITUDE * Math.sin(phase + o)),
  ) as [number, number, number, number];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate the complete bench-test step sequence.
 *
 * @param routerConfig  Active ActuatorRouterConfig — outputs are routed
 *                      through this config so the resolved physical channels
 *                      reflect the real hardware mapping.
 * @returns             Ordered array of BenchStep objects.
 */
export function generateBenchSequence(
  routerConfig: ActuatorRouterConfig,
): BenchStep[] {
  const steps: BenchStep[] = [];

  // ── Phase 1: single-motor isolation ─────────────────────────────────────────
  const singleMotorSteps: Array<{
    label: BenchStepLabel;
    logical: [number, number, number, number];
  }> = [
    { label: 'A_ONLY', logical: [BENCH_MOTOR_LEVEL, 0, 0, 0] },
    { label: 'B_ONLY', logical: [0, BENCH_MOTOR_LEVEL, 0, 0] },
    { label: 'C_ONLY', logical: [0, 0, BENCH_MOTOR_LEVEL, 0] },
    { label: 'D_ONLY', logical: [0, 0, 0, BENCH_MOTOR_LEVEL] },
  ];

  // ── Phase 2: diagonal pair verification ──────────────────────────────────────
  const pairSteps: Array<{
    label: BenchStepLabel;
    logical: [number, number, number, number];
  }> = [
    { label: 'A_AND_C', logical: [BENCH_MOTOR_LEVEL, 0, BENCH_MOTOR_LEVEL, 0] },
    { label: 'B_AND_D', logical: [0, BENCH_MOTOR_LEVEL, 0, BENCH_MOTOR_LEVEL] },
  ];

  for (const { label, logical } of [...singleMotorSteps, ...pairSteps]) {
    steps.push({
      label,
      logical,
      routed: routeActuatorOutputs(logical, routerConfig),
    });
  }

  // ── Phase 3: rotating phase sweep ────────────────────────────────────────────
  for (let i = 0; i < PHASE_SWEEP_STEPS; i++) {
    const label = `PHASE_SWEEP_${i}` as BenchStepLabel;
    const logical = sweepOutputs(i, PHASE_SWEEP_STEPS);
    steps.push({
      label,
      logical,
      routed: routeActuatorOutputs(logical, routerConfig),
    });
  }

  return steps;
}
