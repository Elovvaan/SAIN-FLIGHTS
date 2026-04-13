import { connect } from 'nats';
import {
  TOPICS, NATS_URL, encode, now
} from '../../../packages/shared/src/index.js';

const SERVICE = 'perception-engine';

const SCENE_UPDATES = [
  'clear airspace, no obstacles',
  'wind speed 2m/s from north',
  'GPS lock: 12 satellites',
  'altitude 50m AGL',
  'target acquired at bearing 045',
];

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

  let sceneIndex = 0;

  const interval = setInterval(() => {
    const scene = SCENE_UPDATES[sceneIndex % SCENE_UPDATES.length];
    sceneIndex++;
    console.log(`[${SERVICE}] Publishing scene: ${scene}`);
    nc.publish(TOPICS.SCENE_UPDATED, encode({ scene, timestamp: now() }));
  }, 3000);

  nc.closed().then(() => clearInterval(interval));
  await nc.closed();
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
