/**
 * Actuator Router — execution-layer adapter for field-mode hardware output.
 *
 * Responsibility: take the solved [A, B, C, D] motor outputs from the field
 * solver and map them to the configured physical motor channels, applying
 * inversion, scaling, and clamping before they reach the flight controller.
 *
 * This layer exists to close the gap between the software motor ordering
 * (A = front-right, B = rear-right, C = rear-left, D = front-left) and the
 * physical ESC/PWM channel assignment on the actual airframe.
 *
 * Output modes:
 *   mixer       — outputs are passed to the FC as SET_ACTUATOR_CONTROL_TARGET;
 *                 the FC's own mixer matrix is applied before reaching the ESCs.
 *                 Compatible with standard GUIDED mode but NOT guaranteed to
 *                 preserve the software [A,B,C,D] motor ordering.
 *
 *   passthrough — outputs are routed directly to the configured physical
 *                 channels before transmission.  For this to reach the ESCs
 *                 without FC remixing, the FC must be configured for passthrough
 *                 (ArduPilot: SERVO_PASS_THRU or custom motor matrix;
 *                  PX4: actuator direct mode).
 *                 This is the REQUIRED mode for true field-vehicle execution.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp a value to [0, 1]; non-finite inputs become 0. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Logical motor labels in software-space. */
export type MotorLabel = 'A' | 'B' | 'C' | 'D';

/**
 * Maps each logical motor to a physical ESC/PWM channel index (0-based).
 *
 * Default (straight-through):  A→0, B→1, C→2, D→3
 *
 * Override when the airframe wires a motor to a different ESC channel:
 *   e.g. MOTOR_A_CHANNEL=2 if the front-right ESC is wired to channel 2.
 */
export type MotorChannelMap = Record<MotorLabel, number>;

/**
 * Inversion flags.  When true the motor value is inverted: v → (1 − v).
 * Required when an ESC expects a reversed throttle signal.
 */
export type MotorInversionMap = Record<MotorLabel, boolean>;

export type ActuatorRouterConfig = {
  outputMode: 'mixer' | 'passthrough';
  channelMap: MotorChannelMap;
  inversionMap: MotorInversionMap;
  outputScale: number;
};

/** Result of a routing operation — physical vector plus diagnostics. */
export type RoutedActuatorOutputs = {
  /** Physical channel outputs [ch0, ch1, ch2, ch3] ready to send to the FC. */
  physical: [number, number, number, number];
  /** Channel map used for this routing operation (motor label → channel index). */
  channelMap: MotorChannelMap;
  /** Inversion state that was applied. */
  inversionMap: MotorInversionMap;
  /** The input solved values before channel remapping. */
  solved: [number, number, number, number];
};

// ── Validation ────────────────────────────────────────────────────────────────

export type PassthroughValidation = {
  /** True only when all hard conditions are satisfied. */
  valid: boolean;
  /** Errors that BLOCK arming. */
  errors: string[];
  /** Advisory warnings (do not block arming). */
  warnings: string[];
};

/**
 * Validate whether the current configuration satisfies all requirements for
 * passthrough execution.
 *
 * Returns `errors` that BLOCK arming and `warnings` that are advisory only.
 *
 * Hard conditions that must ALL be true:
 *   1. FIELD_MODE_ENABLED=true      — without field mode there are no per-motor
 *                                     outputs to route to specific channels.
 *   2. Channel map is a valid permutation of [0, 1, 2, 3] — no duplicates and
 *                                     each channel index is in [0, 3].
 *   3. outputScale > 0 and finite   — degenerate scale blocks all motor output.
 *
 * Advisory warnings (do not block arming):
 *   - sim mode: passthrough routing is valid for bench testing but NOT for
 *               real field-vehicle flight.
 *   - mavlink mode: FC mixer bypass must be manually configured; this software
 *                   cannot auto-detect FC mixer state.
 */
export function validatePassthroughConditions(
  config: ActuatorRouterConfig,
  fieldModeEnabled: boolean,
  hardwareMode: 'sim' | 'mavlink',
): PassthroughValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Field mode must be active.
  if (!fieldModeEnabled) {
    errors.push(
      'FC_OUTPUT_MODE=passthrough requires FIELD_MODE_ENABLED=true; ' +
      'without field mode there are no per-motor outputs to route.',
    );
  }

  // 2. Channel map must be a valid permutation of [0..3].
  const labels: MotorLabel[] = ['A', 'B', 'C', 'D'];
  const channels = labels.map((m) => config.channelMap[m]);
  const uniqueChannels = new Set(channels);
  if (uniqueChannels.size !== 4) {
    errors.push(
      `Motor channel map contains duplicate channel assignments: ` +
      `A→${config.channelMap.A}, B→${config.channelMap.B}, ` +
      `C→${config.channelMap.C}, D→${config.channelMap.D}. ` +
      'Each motor must map to a unique physical channel (0–3).',
    );
  }
  for (const ch of channels) {
    if (!Number.isInteger(ch) || ch < 0 || ch > 3) {
      errors.push(
        `Motor channel index ${ch} is out of range; ` +
        'all channel indices must be integers in [0, 3].',
      );
      break;
    }
  }

  // 3. Output scale must be positive and finite.
  if (!Number.isFinite(config.outputScale) || config.outputScale <= 0) {
    errors.push(
      `FC_OUTPUT_MODE=passthrough requires a positive finite FIELD_OUTPUT_SCALE; ` +
      `got ${config.outputScale}.`,
    );
  }

  // 4. Advisory: sim mode is only valid for bench testing.
  if (hardwareMode === 'sim') {
    warnings.push(
      'FC_HARDWARE_MODE=sim — passthrough routing is VALID for bench/unit testing ' +
      'but INVALID for real field-vehicle flight. ' +
      'Switch to FC_HARDWARE_MODE=mavlink for actual hardware deployment.',
    );
  }

  // 5. Advisory: FC mixer bypass must be manually configured on real hardware.
  if (hardwareMode === 'mavlink') {
    warnings.push(
      'ArduPilot: ensure SERVO_PASS_THRU is set or a custom motor matrix is ' +
      'loaded so SET_ACTUATOR_CONTROL_TARGET group-0 controls reach ESCs without ' +
      'FC remixing. ' +
      'PX4: ensure actuator direct mode is active. ' +
      'This software cannot auto-detect FC mixer configuration — verify manually.',
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Core routing function ─────────────────────────────────────────────────────

/** Identity channel map — motor index equals physical channel index. */
const IDENTITY_CHANNEL_MAP: MotorChannelMap = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Route solved [A, B, C, D] motor outputs to physical channels.
 *
 * Behaviour differs by `outputMode`:
 *
 *   passthrough — applies the full configured channel map, inversion, scale,
 *                 and clamping.  The physical array slot for each motor is
 *                 determined by `routerConfig.channelMap[motor]`.  This is the
 *                 REQUIRED mode for true per-motor field-vehicle execution.
 *
 *   mixer       — the FC's own mixer matrix handles routing after delivery, so
 *                 applying a custom channel map here would double-remap the
 *                 outputs.  In this mode the function enforces the identity
 *                 channel map (A→0, B→1, C→2, D→3) regardless of the configured
 *                 `channelMap`.  Scale, inversion, and clamping are still applied.
 *                 The returned `channelMap` reflects the identity map actually used.
 *
 * Applied in order for each motor:
 *   1. Scale  — multiply by `outputScale`
 *   2. Invert — apply `(1 − v)` when the motor inversion flag is set
 *   3. Clamp  — clamp to [0, 1] (NaN-safe)
 *   4. Remap  — place the result in the effective physical channel slot
 *
 * @param solved        4-tuple from solveField(), each expected in [0, 1]
 *                      before the router applies its own `outputScale`.
 * @param routerConfig  Channel map, inversion flags, scale, and output mode.
 * @returns             RoutedActuatorOutputs with the physical channel array
 *                      and full diagnostic information.
 */
export function routeActuatorOutputs(
  solved: [number, number, number, number],
  routerConfig: ActuatorRouterConfig,
): RoutedActuatorOutputs {
  const labels: MotorLabel[] = ['A', 'B', 'C', 'D'];
  const physical: [number, number, number, number] = [0, 0, 0, 0];

  // In mixer mode the FC handles channel routing; use identity to avoid
  // double-remapping.  In passthrough mode use the operator-configured map.
  const effectiveChannelMap: MotorChannelMap =
    routerConfig.outputMode === 'passthrough'
      ? routerConfig.channelMap
      : IDENTITY_CHANNEL_MAP;

  for (let i = 0; i < 4; i++) {
    const label = labels[i];
    const channel = effectiveChannelMap[label];

    // Apply scale then inversion.
    let value = solved[i] * routerConfig.outputScale;
    if (routerConfig.inversionMap[label]) {
      value = 1 - value;
    }

    // Guard channel index against out-of-range values.
    const ch =
      Number.isInteger(channel) && channel >= 0 && channel <= 3 ? channel : i;
    physical[ch] = clamp01(value);
  }

  return {
    physical,
    // Return the effective map so logs accurately reflect what was applied.
    channelMap: { ...effectiveChannelMap },
    inversionMap: { ...routerConfig.inversionMap },
    solved: [solved[0], solved[1], solved[2], solved[3]],
  };
}

/**
 * Build a machine-readable log payload for a routed actuator command.
 * Intended for structured JSON logging (pino).
 */
export function buildActuatorRouteLog(
  result: RoutedActuatorOutputs,
  outputMode: 'mixer' | 'passthrough',
): Record<string, unknown> {
  return {
    outputMode,
    solved: {
      A: result.solved[0],
      B: result.solved[1],
      C: result.solved[2],
      D: result.solved[3],
    },
    channelMap: result.channelMap,
    inversionMap: result.inversionMap,
    physical: {
      ch0: result.physical[0],
      ch1: result.physical[1],
      ch2: result.physical[2],
      ch3: result.physical[3],
    },
  };
}
