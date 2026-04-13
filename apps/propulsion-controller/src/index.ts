import { connect } from 'nats';
import {
  TOPICS, NATS_URL, encode, decode, now,
  MotionPlanMessage
} from '../../../packages/shared/src/index.js';

const SERVICE = 'propulsion-controller';

async function main() {
  console.log(`[${SERVICE}] Connecting to NATS at ${NATS_URL}...`);
  const nc = await connect({
    servers: NATS_URL,
    reconnect: true,
    maxReconnectAttempts: -1,
    waitOnFirstConnect: true,
  });
  console.log(`[${SERVICE}] Connected to NATS`);

  nc.publish(TOPICS.SERVICE_READY, encode({ service: SERVICE, timestamp: now() }));

  const sub = nc.subscribe(TOPICS.MOTION_PLAN);
  console.log(`[${SERVICE}] Subscribed to ${TOPICS.MOTION_PLAN}`);

  for await (const msg of sub) {
    const data = decode<MotionPlanMessage>(msg.data);
    const { state } = data;

    let propulsionLog = '';
    switch (state) {
      case 'TAKEOFF':
        propulsionLog = 'spooling lift';
        break;
      case 'HOVER_STABLE':
        propulsionLog = 'holding position';
        break;
      case 'FOLLOW':
        propulsionLog = 'tracking target';
        break;
      case 'LAND':
        propulsionLog = 'descending';
        break;
      case 'ARM':
        propulsionLog = 'motors armed, standby';
        break;
      case 'RUN_CHECKS':
        propulsionLog = 'running motor checks';
        break;
      case 'HOLD_POSITION':
        propulsionLog = 'holding position';
        break;
      case 'FIELD_TEST':
        propulsionLog = 'field test pattern thrust';
        break;
      default:
        propulsionLog = `executing ${state}`;
    }

    console.log(`[${SERVICE}] ${propulsionLog}`);

    nc.publish(TOPICS.PROPULSION_HEALTH, encode({
      status: 'nominal',
      state,
      log: propulsionLog,
      timestamp: now(),
    }));

    nc.publish(TOPICS.ENERGY_UPDATED, encode({
      batteryPct: Math.max(10, 100 - Math.random() * 5),
      state,
      timestamp: now(),
    }));
  }
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
