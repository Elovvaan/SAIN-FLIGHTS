import { connect } from 'nats';
import {
  TOPICS, NATS_URL, encode, decode, now,
  StateChangedMessage, MotionPlanMessage
} from '../../../packages/shared/src/index.js';

const SERVICE = 'flight-orchestrator';

const STATE_ACTIONS: Record<string, string> = {
  RUN_CHECKS: 'running pre-flight checks',
  ARM: 'arming motors',
  TAKEOFF: 'initiating vertical ascent',
  HOVER_STABLE: 'maintaining hover altitude',
  FOLLOW: 'following target trajectory',
  HOLD_POSITION: 'holding GPS position',
  FIELD_TEST: 'executing field test pattern',
  LAND: 'initiating landing sequence',
  IDLE: 'systems idle',
};

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

  const stateSub = nc.subscribe(TOPICS.STATE_CHANGED);
  console.log(`[${SERVICE}] Subscribed to ${TOPICS.STATE_CHANGED}`);

  const sceneSub = nc.subscribe(TOPICS.SCENE_UPDATED);
  console.log(`[${SERVICE}] Subscribed to ${TOPICS.SCENE_UPDATED}`);

  (async () => {
    for await (const msg of stateSub) {
      const data = decode<StateChangedMessage>(msg.data);
      const { currentState } = data;

      const action = STATE_ACTIONS[currentState] ?? 'unknown action';
      console.log(`[${SERVICE}] State changed to ${currentState} → planning: ${action}`);

      const plan: MotionPlanMessage = {
        state: currentState,
        action,
        timestamp: now(),
      };
      nc.publish(TOPICS.MOTION_PLAN, encode(plan));
    }
  })();

  for await (const msg of sceneSub) {
    const data = decode<{ scene: string; timestamp: string }>(msg.data);
    console.log(`[${SERVICE}] Scene update received: ${data.scene}`);
  }
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
