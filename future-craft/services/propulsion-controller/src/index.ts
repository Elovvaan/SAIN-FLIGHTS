import pino from 'pino';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { createFlightControllerLink } from '@future-craft/flight-controller-link';
import { SimSensorLink } from '@future-craft/sensor-link';
import {
  MotionPlan, StateChangedEvent, PropulsionHealth,
} from '@future-craft/schemas';
import { solveField, advancePhase } from './field-solver';
import type { FieldState } from './field-solver';
import { applyFieldStabilization } from './field-stabilizer';
import type { ImuState, StabilizerConfig } from './field-stabilizer';
import { translateField } from './field-translator';
import type { TranslatorConfig } from './field-translator';
import {
  routeActuatorOutputs,
  validatePassthroughConditions,
  buildActuatorRouteLog,
} from './actuator-router';
import type { ActuatorRouterConfig } from './actuator-router';
import { emitStartupBanner } from './startup-banner';
import { FlightStateMachine } from './flight-state-machine';
import {
  computeRampedIntensity,
  isRampComplete,
} from './thrust-ramp-controller';
import type { RampConfig } from './thrust-ramp-controller';
import {
  detectInstability,
  computeStabilityScore,
} from './instability-detector';
import type { InstabilityConfig } from './instability-detector';
import { detectLift } from './lift-detector';
import { emitTelemetry } from './telemetry-stream';

const logger = pino({ name: 'propulsion-controller', level: config.LOG_LEVEL });
const flightCtrl = createFlightControllerLink(
  config.FC_HARDWARE_MODE,
  config.FC_MAVLINK_HOST,
  config.FC_MAVLINK_PORT,
  config.FC_MAVLINK_TARGET_SYS,
);

// ── Sensor link (IMU / altitude reads for field stabilization) ────────────────

// Use the sim sensor link in sim mode; in hardware (MAVLink) mode no sensor
// link implementation is available yet, so stabilization is safely bypassed
// via imuState.valid = false until hardware IMU integration is added.
const sensorLink: SimSensorLink | null =
  config.FC_HARDWARE_MODE === 'sim' ? new SimSensorLink() : null;

/** Latest IMU snapshot; starts invalid so stabilization is bypassed until the
 *  first successful sensor read. */
let imuState: ImuState = { roll: 0, pitch: 0, yaw: 0, valid: false };

/** Stabilizer gain / enable config derived from environment variables. */
const stabConfig: StabilizerConfig = {
  enabled: config.FIELD_STABILIZATION_ENABLED,
  kpPitch: config.FIELD_KP_PITCH,
  kpRoll: config.FIELD_KP_ROLL,
  kbPitch: config.FIELD_KB_PITCH,
  kbRoll: config.FIELD_KB_ROLL,
  kiAlt: config.FIELD_KI_ALT,
};

// ── Execution-layer router config ─────────────────────────────────────────────

const routerConfig: ActuatorRouterConfig = {
  outputMode: config.FC_OUTPUT_MODE,
  channelMap: {
    A: config.MOTOR_A_CHANNEL,
    B: config.MOTOR_B_CHANNEL,
    C: config.MOTOR_C_CHANNEL,
    D: config.MOTOR_D_CHANNEL,
  },
  inversionMap: {
    A: config.MOTOR_A_INVERTED,
    B: config.MOTOR_B_INVERTED,
    C: config.MOTOR_C_INVERTED,
    D: config.MOTOR_D_INVERTED,
  },
  // Router applies its own scale; the field loop no longer multiplies inline.
  outputScale: config.FIELD_OUTPUT_SCALE,
};

/** Translator gain / enable config derived from environment variables. */
const translatorConfig: TranslatorConfig = {
  enabled: config.FIELD_TRANSLATION_ENABLED,
  translationGain: config.FIELD_TRANSLATION_GAIN,
  biasGain: config.FIELD_BIAS_GAIN,
};

/** Target hover altitude in metres; set when a motion plan carries one. */
let targetAltM: number | undefined;

// ── Hardware validation layer — safe-lift / tether / state machine ────────────

/** Flight state machine — shared across all field-loop ticks. */
const fsm = new FlightStateMachine();

/** Instability detection thresholds. */
const instabilityConfig: InstabilityConfig = {
  maxAngleRad:     config.INSTABILITY_MAX_ANGLE_RAD,
  maxRateRadS:     config.INSTABILITY_MAX_RATE_RAD_S,
  stableBandRad:   config.INSTABILITY_STABLE_BAND_RAD,
};

/** Ramp profile derived from config (used in safe-lift and tether modes). */
const rampConfig: RampConfig = {
  minIntensity:    config.SAFE_LIFT_MIN_INTENSITY,
  targetIntensity: config.SAFE_LIFT_MAX_INTENSITY,
  rampDurationMs:  config.SAFE_LIFT_RAMP_DURATION_MS,
};

/** Timestamp (ms) when the current ramp was started. */
let rampStartMs: number | null = null;

/** Previous IMU snapshot — used for angular-rate estimation and lift detection. */
let prevImuState: ImuState = { roll: 0, pitch: 0, yaw: 0, valid: false };

/** Ground-reference altitude captured at arm time (metres). */
let groundAltM: number | undefined;

// ── Field-mode state ──────────────────────────────────────────────────────────

/** Control loop interval for field-mode phase advancement (20 Hz). */
const FIELD_LOOP_INTERVAL_MS = 50;

/**
 * Bias values for each motion-plan type in field mode.
 *
 * The bias shifts the adjusted base by `bias × BIAS_SCALE` (where BIAS_SCALE
 * is 0.2 in field-solver.ts), so a bias of ±0.2 shifts the collective by ±4 %
 * of full output range.  Positive = expansion (more lift), negative =
 * contraction (less lift).
 */
const FIELD_BIAS_ASCEND = 0.2;
const FIELD_BIAS_FOLLOW = 0.1;
const FIELD_BIAS_DESCEND = -0.2;

let fieldState: FieldState = {
  intensity: 0,
  phase: 0,
  phaseVelocity: config.FIELD_PHASE_VELOCITY,
  spin: config.FIELD_SPIN,
  bias: 0,
  enabled: false,
  velocityX: 0,
  velocityY: 0,
};

let fieldLoopTimer: ReturnType<typeof setInterval> | null = null;
let lastFieldUpdateMs = Date.now();
let fieldLoopRunning = false; // guard against overlapping iterations

function startFieldLoop(): void {
  if (fieldLoopTimer !== null) return; // already running
  lastFieldUpdateMs = Date.now();
  fieldLoopTimer = setInterval(async () => {
    if (fieldLoopRunning) return; // skip if previous iteration is still in-flight
    fieldLoopRunning = true;
    try {
      const now = Date.now();
      const dtSeconds = (now - lastFieldUpdateMs) / 1000;
      lastFieldUpdateMs = now;

      // ── Poll IMU (best-effort; invalid state bypasses stabilization) ────────
      if (sensorLink !== null) {
        try {
          const imu = await sensorLink.readImu();
          const alt = await sensorLink.readAltitudeM();
          prevImuState = imuState; // save before overwrite for rate estimation
          imuState = { ...imu, altitude: alt, valid: true };
        } catch (err) {
          prevImuState = imuState;
          imuState = { ...imuState, valid: false };
          logger.debug({ err }, 'field loop: IMU read failed — stabilization bypassed this tick');
        }
      }

      // ── Hard abort: NaN or invalid outputs guard ────────────────────────────
      const imuHasNaN =
        imuState.valid &&
        (!Number.isFinite(imuState.roll) ||
         !Number.isFinite(imuState.pitch) ||
         !Number.isFinite(imuState.yaw));

      if (imuHasNaN && !fsm.isAborted()) {
        triggerHardAbort('IMU NaN detected in field loop');
      }

      // ── Safe-lift / tether mode: enforce safe-band constraints ──────────────
      // In safe-lift / tether mode, translation is locked (velocityX=0,
      // velocityY=0) and intensity is limited to rampConfig.targetIntensity.
      // FIELD_TRANSLATION_ENABLED is still respected in normal mode.
      const safeLiftActive = config.SAFE_LIFT_MODE || config.TETHER_MODE;
      if (safeLiftActive && fieldState.enabled) {
        // Lock translation.
        fieldState = { ...fieldState, velocityX: 0, velocityY: 0 };

        // Continue ramp progression once started, even if another event moves the
        // FSM out of RAMPING before the duration elapses.
        if (rampStartMs !== null) {
          const ramped = computeRampedIntensity(rampStartMs, now, rampConfig);
          fieldState = { ...fieldState, intensity: ramped };

          // Advance FSM when ramp completes.
          if (isRampComplete(rampStartMs, now, rampConfig) && fsm.phase !== 'STABILIZING') {
            const ok = fsm.requestTransition('STABILIZING', 'ramp_complete');
            if (ok) {
              logger.info(
                { type: 'flight_event', event: 'ramp_complete', flightPhase: fsm.phase },
                'safe-lift: ramp complete — entering STABILIZING',
              );
            }
          }
        } else if (fsm.phase === 'ARMED' || fsm.phase === 'IDLE') {
          // Not yet ramping — hold at minimum intensity.
          fieldState = { ...fieldState, intensity: rampConfig.minIntensity };
        }

        // Clamp intensity to safe band regardless of other corrections.
        fieldState = {
          ...fieldState,
          intensity: Math.max(
            rampConfig.minIntensity,
            Math.min(rampConfig.targetIntensity, fieldState.intensity),
          ),
        };
      }

      // ── If aborted: cut all outputs immediately ─────────────────────────────
      if (fsm.isAborted()) {
        await flightCtrl.setActuatorOutputs([0, 0, 0, 0]);
        return;
      }

      // ── Apply field stabilization BEFORE the field solver ───────────────────
      fieldState = applyFieldStabilization(
        fieldState,
        imuState,
        dtSeconds,
        stabConfig,
        targetAltM,
      );

      // ── Apply field translation (directional movement via field offset) ──────
      fieldState = translateField(fieldState, dtSeconds, translatorConfig);

      // ── Advance phase (natural field rotation) ──────────────────────────────
      fieldState = advancePhase(fieldState, dtSeconds);

      // ── Solve field and route to actuators ──────────────────────────────────
      const solved = solveField(fieldState) as [number, number, number, number];

      // ── Hard abort: output saturation / NaN guard ───────────────────────────
      const outputHasNaN = solved.some((v) => !Number.isFinite(v));
      const outputSaturated = solved.every((v) => v >= 1);
      if ((outputHasNaN || outputSaturated) && !fsm.isAborted()) {
        triggerHardAbort(
          outputHasNaN
            ? 'solver produced NaN outputs'
            : 'output saturation detected — all motors at maximum',
        );
        await flightCtrl.setActuatorOutputs([0, 0, 0, 0]);
        return;
      }

      const routed = routeActuatorOutputs(solved, routerConfig);
      logger.debug(
        buildActuatorRouteLog(routed, routerConfig.outputMode),
        'propulsion-controller: actuator route',
      );
      await flightCtrl.setActuatorOutputs(routed.physical);

      // ── Instability detection (only while flying) ───────────────────────────
      if (fsm.isFlying()) {
        const instability = detectInstability(
          imuState,
          prevImuState,
          dtSeconds,
          instabilityConfig,
        );
        if (instability.triggered) {
          triggerHardAbort(instability.reason ?? 'flight_abort_instability');
          await flightCtrl.setActuatorOutputs([0, 0, 0, 0]);
          return;
        }

        // ── Lift detection ────────────────────────────────────────────────────
        if (fsm.phase === 'RAMPING') {
          const liftResult = detectLift(
            imuState,
            prevImuState,
            dtSeconds,
            groundAltM,
          );
          if (liftResult.liftDetected) {
            const liftDetected = fsm.requestTransition('LIFT_DETECTED', `lift_detected via ${liftResult.method}`);
            if (liftDetected) {
              logger.info(
                { type: 'flight_event', event: 'lift_detected', method: liftResult.method, flightPhase: fsm.phase },
                'lift_detected',
              );
              fsm.requestTransition('STABILIZING', `stabilizing after lift detection via ${liftResult.method}`);
            }
          }
        }
      }

      // ── Live telemetry stream ─────────────────────────────────────────────
      if (config.TELEMETRY_ENABLED) {
        const stabilityScore = computeStabilityScore(imuState, instabilityConfig);
        emitTelemetry(fsm.phase, fieldState, solved, imuState, stabilityScore, logger);
      }
    } catch (err) {
      logger.warn({ err }, 'field loop: setActuatorOutputs failed');
    } finally {
      fieldLoopRunning = false;
    }
  }, FIELD_LOOP_INTERVAL_MS);
}

function stopFieldLoop(): void {
  if (fieldLoopTimer !== null) {
    clearInterval(fieldLoopTimer);
    fieldLoopTimer = null;
  }
  fieldLoopRunning = false;
}

/**
 * Trigger a hard abort at any point in the flight lifecycle.
 *
 * Cuts intensity to 0, transitions FSM to ABORT, and logs a full state snapshot.
 * Safe to call from any context — is a no-op if already aborted.
 */
function triggerHardAbort(reason: string): void {
  if (fsm.isAborted()) return; // already aborted — no double-trigger

  // Zero intensity immediately so the next tick sends zero outputs.
  fieldState = { ...fieldState, intensity: 0, enabled: false };

  const snapshot = fsm.snapshot();
  fsm.requestTransition('ABORT', reason);

  logger.error(
    {
      type: 'hard_abort',
      reason,
      flightPhase: snapshot.phase,
      elapsedMs: snapshot.elapsedMs,
      history: snapshot.history,
      fieldState: {
        intensity: fieldState.intensity,
        phase: fieldState.phase,
        bias: fieldState.bias,
      },
      imuState,
    },
    `HARD ABORT: ${reason}`,
  );
}

// ── Health ────────────────────────────────────────────────────────────────────

function publishHealth(healthy: boolean): void {
  const health: PropulsionHealth = {
    vehicleId: config.VEHICLE_ID,
    liftCell1Ok: healthy,
    liftCell2Ok: healthy,
    liftCell3Ok: healthy,
    liftCell4Ok: healthy,
    thrustCorridorOk: healthy,
    overallHealthy: healthy,
    timestamp: new Date().toISOString(),
  };
  publish(TOPICS.PROPULSION_HEALTH, health);
}

// ── Motion plan handler ───────────────────────────────────────────────────────

async function applyMotionPlan(plan: MotionPlan): Promise<void> {
  logger.info({ planType: plan.type, planId: plan.id }, 'Applying motion plan');

  if (config.FIELD_MODE_ENABLED) {
    // ── Version-1 field mode: route through the tangential-field solver ──────
    let intensity = 0;
    let bias = 0;

    switch (plan.type) {
      case 'ASCEND':
        intensity = 70;
        bias = FIELD_BIAS_ASCEND;
        break;
      case 'HOVER':
      case 'HOLD':
        intensity = 50;
        bias = 0;
        break;
      case 'FOLLOW':
        intensity = 55;
        bias = FIELD_BIAS_FOLLOW;
        break;
      case 'DESCEND':
        intensity = 30;
        bias = FIELD_BIAS_DESCEND;
        break;
    }

    // ── Safe-lift / tether mode overrides ────────────────────────────────────
    const safeLiftActive = config.SAFE_LIFT_MODE || config.TETHER_MODE;
    if (safeLiftActive) {
      // Clamp intensity to safe band.
      intensity = Math.min(intensity, config.SAFE_LIFT_MAX_INTENSITY);
      // Lock translation.
      fieldState = { ...fieldState, velocityX: 0, velocityY: 0 };
    }

    fieldState = { ...fieldState, intensity, bias, enabled: true };
    // Track the plan's altitude target so the stabilizer can correct vertical drift.
    targetAltM = plan.targetAltitudeM;

    // ── Initiate ramp if in ARMED state ──────────────────────────────────────
    if (safeLiftActive && fsm.phase === 'ARMED') {
      if (config.TETHER_MODE && !config.TETHER_CONFIRM) {
        logger.warn(
          { type: 'tether_confirm_required', flightPhase: fsm.phase },
          'tethered test mode: TETHER_CONFIRM=false — ramp blocked; set TETHER_CONFIRM=true to proceed',
        );
      } else {
        rampStartMs = Date.now();
        const ok = fsm.requestTransition('RAMPING', 'ramp_start');
        if (ok) {
          logger.info(
            { type: 'flight_event', event: 'ramp_start', rampConfig, flightPhase: fsm.phase },
            config.TETHER_MODE ? 'tethered test: ramp_start' : 'safe-lift: ramp_start',
          );
        }
      }
    }

    startFieldLoop();
    logger.info(
      {
        planType: plan.type,
        intensity,
        bias,
        phaseVelocity: fieldState.phaseVelocity,
        spin: fieldState.spin,
        targetAltM,
        translationEnabled: translatorConfig.enabled,
        safeLiftActive,
        flightPhase: fsm.phase,
      },
      'propulsion-controller: field mode active',
    );
  } else {
    // ── Standard avgLift mode: original flat-throttle behavior ──────────────
    stopFieldLoop();
    switch (plan.type) {
      case 'ASCEND':
        await flightCtrl.setThrottle([70, 70, 70, 70], 40);
        break;
      case 'HOVER':
      case 'HOLD':
        await flightCtrl.setThrottle([50, 50, 50, 50], 0);
        break;
      case 'FOLLOW':
        await flightCtrl.setThrottle([55, 55, 55, 55], 60);
        break;
      case 'DESCEND':
        await flightCtrl.setThrottle([30, 30, 30, 30], 0);
        break;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await flightCtrl.connect();
  if (sensorLink !== null) {
    await sensorLink.connect();
  }
  await connectBus();

  // ── Emit startup verification banner ───────────────────────────────────────
  emitStartupBanner(
    {
      fieldModeEnabled: config.FIELD_MODE_ENABLED,
      stabilizationEnabled: config.FIELD_STABILIZATION_ENABLED,
      translationEnabled: config.FIELD_TRANSLATION_ENABLED,
      hardwareMode: config.FC_HARDWARE_MODE,
      routerConfig,
      safeLiftMode: config.SAFE_LIFT_MODE,
      tetherMode: config.TETHER_MODE,
      telemetryEnabled: config.TELEMETRY_ENABLED,
    },
    logger,
  );

  logger.info(
    { fieldModeEnabled: config.FIELD_MODE_ENABLED, stabilizationEnabled: config.FIELD_STABILIZATION_ENABLED },
    'propulsion-controller started',
  );

  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, async (event) => {
    if (event.to === 'ARMED_READY') {
      // ── Mixer-mode hardware arming guard ────────────────────────────────────
      // FC_OUTPUT_MODE=mixer on real hardware with field mode active is NOT a
      // valid configuration for true per-motor field execution: the FC mixer
      // matrix reorders outputs and does not preserve the [A,B,C,D] software
      // motor ordering.  Block arming and require the operator to either
      // switch to FC_OUTPUT_MODE=passthrough (with the FC configured for
      // passthrough) or disable FIELD_MODE_ENABLED.
      if (
        config.FC_HARDWARE_MODE === 'mavlink' &&
        config.FIELD_MODE_ENABLED &&
        routerConfig.outputMode === 'mixer'
      ) {
        logger.error(
          {
            type: 'mixer_field_mode_arm_blocked',
            FC_HARDWARE_MODE: config.FC_HARDWARE_MODE,
            FIELD_MODE_ENABLED: config.FIELD_MODE_ENABLED,
            FC_OUTPUT_MODE: routerConfig.outputMode,
          },
          [
            '⛔ ARMING BLOCKED — FC_OUTPUT_MODE=mixer is NOT valid for field-mode execution on real hardware.',
            '  The FC mixer matrix will reorder actuator outputs and break the [A,B,C,D] motor routing.',
            '  To arm, either:',
            '    (a) Set FC_OUTPUT_MODE=passthrough and configure the FC for passthrough (ArduPilot: SERVO_PASS_THRU; PX4: actuator direct mode), or',
            '    (b) Set FIELD_MODE_ENABLED=false to use standard avgLift mode (which is compatible with the FC mixer).',
          ].join('\n'),
        );
        return; // do not arm
      }

      // ── Passthrough failsafe guard ─────────────────────────────────────────
      // When FC_OUTPUT_MODE=passthrough, validate all hard conditions before
      // arming.  If any are not satisfied, refuse to arm and emit a hard error.
      if (routerConfig.outputMode === 'passthrough') {
        const guard = validatePassthroughConditions(
          routerConfig,
          config.FIELD_MODE_ENABLED,
          config.FC_HARDWARE_MODE,
        );
        if (!guard.valid) {
          logger.error(
            {
              type: 'passthrough_arm_blocked',
              errors: guard.errors,
              warnings: guard.warnings,
            },
            [
              '⛔ ARMING BLOCKED — FC_OUTPUT_MODE=passthrough but required conditions are not satisfied:',
              ...guard.errors.map((e) => `  • ${e}`),
              'Resolve the above errors before attempting to arm.',
            ].join('\n'),
          );
          return; // do not arm
        }
      }

      // Reset field phase on each arm cycle.
      fieldState = { ...fieldState, phase: 0 };

      // ── Transition FSM to ARMED ──────────────────────────────────────────
      // Reset FSM to IDLE first (allows re-arming after a previous ABORT/IDLE).
      if (fsm.phase === 'ABORT') {
        fsm.requestTransition('IDLE', 'disarmed_after_abort');
      }
      if (fsm.phase !== 'ARMED') {
        fsm.requestTransition('ARMED', 'armed');
        // Capture ground-reference altitude for lift detection.
        groundAltM = imuState.valid ? imuState.altitude : undefined;
        logger.info(
          { type: 'flight_event', event: 'armed', flightPhase: fsm.phase, groundAltM },
          config.TETHER_MODE ? 'tethered test: armed' : 'safe-lift: armed',
        );
      }

      await flightCtrl.arm();
    }
    if (event.to === 'LANDED') {
      stopFieldLoop();
      // Transition FSM back to IDLE on landing.
      if (fsm.phase !== 'IDLE' && fsm.phase !== 'ABORT') {
        fsm.requestTransition('IDLE', 'landed');
      }
      rampStartMs = null;
      await flightCtrl.disarm();
    }
  });

  subscribe<MotionPlan>(TOPICS.MOTION_PLAN, async (plan) => {
    await applyMotionPlan(plan);
    publishHealth(true);
  });

  setInterval(() => {
    publishHealth(true);
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'propulsion-controller fatal error');
  process.exit(1);
});
