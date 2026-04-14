import pino from 'pino';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { createFlightControllerLink } from '@future-craft/flight-controller-link';
import {
  MotionPlan, StateChangedEvent, PropulsionHealth,
} from '@future-craft/schemas';
import { solveField, advancePhase } from './field-solver';
import type { FieldState } from './field-solver';

const logger = pino({ name: 'propulsion-controller', level: config.LOG_LEVEL });
const flightCtrl = createFlightControllerLink(
  config.FC_HARDWARE_MODE,
  config.FC_MAVLINK_HOST,
  config.FC_MAVLINK_PORT,
  config.FC_MAVLINK_TARGET_SYS,
);

// ── Field-mode state ──────────────────────────────────────────────────────────

/** Control loop interval for field-mode phase advancement (20 Hz). */
const FIELD_LOOP_INTERVAL_MS = 50;

let fieldState: FieldState = {
  intensity: 0,
  phase: 0,
  phaseVelocity: config.FIELD_PHASE_VELOCITY,
  spin: config.FIELD_SPIN,
  bias: 0,
  enabled: false,
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
      fieldState = advancePhase(fieldState, dtSeconds);
      const outputs = solveField(fieldState).map(
        (v) => v * config.FIELD_OUTPUT_SCALE,
      ) as [number, number, number, number];
      await flightCtrl.setActuatorOutputs(outputs);
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
        bias = 0.2;  // slight expansion bias for climb
        break;
      case 'HOVER':
      case 'HOLD':
        intensity = 50;
        bias = 0;
        break;
      case 'FOLLOW':
        intensity = 55;
        bias = 0.1;
        break;
      case 'DESCEND':
        intensity = 30;
        bias = -0.2; // contraction bias for descent
        break;
    }

    fieldState = { ...fieldState, intensity, bias, enabled: true };
    startFieldLoop();
    logger.info(
      { planType: plan.type, intensity, bias, phaseVelocity: fieldState.phaseVelocity, spin: fieldState.spin },
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
  await connectBus();
  logger.info(
    { fieldModeEnabled: config.FIELD_MODE_ENABLED },
    'propulsion-controller started',
  );

  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, async (event) => {
    if (event.to === 'ARMED_READY') {
      // Reset field phase on each arm cycle.
      fieldState = { ...fieldState, phase: 0 };
      await flightCtrl.arm();
    }
    if (event.to === 'LANDED') {
      stopFieldLoop();
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
