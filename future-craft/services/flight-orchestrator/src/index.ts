import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import {
  Intent, VehicleState, MotionPlan, EnergyState,
  SceneState, StateChangedEvent,
} from '@future-craft/schemas';

const logger = pino({ name: 'flight-orchestrator', level: config.LOG_LEVEL });

let currentState: VehicleState = 'STANDBY';
let lastEnergy: EnergyState | null = null;
let lastScene: SceneState | null = null;

function buildPlan(type: MotionPlan['type'], overrides: Partial<MotionPlan> = {}): MotionPlan {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function onIntent(intent: Intent): void {
  logger.info({ intent: intent.type, state: currentState }, 'Flight orchestrator received intent');
  switch (intent.type) {
    case 'TAKEOFF':
      publish(TOPICS.MOTION_PLAN, buildPlan('ASCEND', { targetAltitudeM: 10, durationMs: 5000 }));
      break;
    case 'HOVER':
      publish(TOPICS.MOTION_PLAN, buildPlan('HOVER'));
      break;
    case 'FOLLOW':
      publish(TOPICS.MOTION_PLAN, buildPlan('FOLLOW', { targetVelocityMps: 3 }));
      break;
    case 'HOLD_POSITION':
      publish(TOPICS.MOTION_PLAN, buildPlan('HOLD'));
      break;
    case 'LAND':
      publish(TOPICS.MOTION_PLAN, buildPlan('DESCEND', { targetAltitudeM: 0, durationMs: 8000 }));
      break;
  }
}

async function main(): Promise<void> {
  await connectBus();
  logger.info('flight-orchestrator started');

  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, (event) => {
    currentState = event.to;
    if (event.to === 'LAUNCH_INITIATION') {
      publish(TOPICS.MOTION_PLAN, buildPlan('ASCEND', { targetAltitudeM: 10, durationMs: 5000 }));
    }
    if (event.to === 'LAND_SEQUENCE') {
      publish(TOPICS.MOTION_PLAN, buildPlan('DESCEND', { targetAltitudeM: 0, durationMs: 8000 }));
    }
  });

  subscribe<EnergyState>(TOPICS.ENERGY_UPDATED, (energy) => {
    lastEnergy = energy;
  });

  subscribe<SceneState>(TOPICS.SCENE_UPDATED, (scene) => {
    lastScene = scene;
  });

  subscribe<Intent>(TOPICS.INTENT_RECEIVED, onIntent);

  setInterval(() => {
    publish('vehicle.flight-orchestrator.heartbeat', { timestamp: new Date().toISOString() });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'flight-orchestrator fatal error');
  process.exit(1);
});
