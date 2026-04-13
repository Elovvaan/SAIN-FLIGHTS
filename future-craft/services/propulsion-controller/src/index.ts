import pino from 'pino';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { SimFlightControllerLink } from '@future-craft/flight-controller-link';
import {
  MotionPlan, StateChangedEvent, PropulsionHealth,
} from '@future-craft/schemas';

const logger = pino({ name: 'propulsion-controller', level: config.LOG_LEVEL });
const flightCtrl = new SimFlightControllerLink();

function publishHealth(healthy: boolean): void {
  const health: PropulsionHealth = {
    vehicleId: config.VEHICLE_ID,
    liftCell1Ok: healthy,
    liftCell2Ok: healthy,
    liftCell3Ok: healthy,
    liftCell4Ok: healthy,
    thrustCorridor0k: healthy,
    overallHealthy: healthy,
    timestamp: new Date().toISOString(),
  };
  publish(TOPICS.PROPULSION_HEALTH, health);
}

async function applyMotionPlan(plan: MotionPlan): Promise<void> {
  logger.info({ planType: plan.type, planId: plan.id }, 'Applying motion plan');
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

async function main(): Promise<void> {
  await flightCtrl.connect();
  await connectBus();
  logger.info('propulsion-controller started');

  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, async (event) => {
    if (event.to === 'ARMED_READY') {
      await flightCtrl.arm();
    }
    if (event.to === 'LANDED') {
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
