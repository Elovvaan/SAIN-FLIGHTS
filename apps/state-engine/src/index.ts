import { connect } from 'nats';
import {
  TOPICS, NATS_URL, encode, decode, now, canTransition,
  VehicleState, StateChangedMessage, SafetyCheckMessage
} from '../../../packages/shared/src/index.js';

const SERVICE = 'state-engine';
let currentState: VehicleState = 'IDLE';

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

  const sub = nc.subscribe(TOPICS.INTENT_APPROVED);
  console.log(`[${SERVICE}] Subscribed to ${TOPICS.INTENT_APPROVED}`);
  console.log(`[${SERVICE}] Current state: ${currentState}`);

  for await (const msg of sub) {
    const data = decode<SafetyCheckMessage>(msg.data);
    const targetState = data.intent as VehicleState;

    console.log(`[${SERVICE}] Received approved intent: ${targetState} (current: ${currentState})`);

    if (canTransition(currentState, targetState)) {
      const previous = currentState;
      currentState = targetState;
      console.log(`[${SERVICE}] ✓ Transition: ${previous} → ${currentState}`);

      const stateMsg: StateChangedMessage = {
        previousState: previous,
        currentState,
        timestamp: now(),
      };
      nc.publish(TOPICS.STATE_CHANGED, encode(stateMsg));
    } else {
      console.log(`[${SERVICE}] ✗ Invalid transition: ${currentState} → ${targetState}`);
      nc.publish(TOPICS.INTENT_DENIED, encode({
        reason: `Invalid transition from ${currentState} to ${targetState}`,
        timestamp: now(),
      }));
    }
  }
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
