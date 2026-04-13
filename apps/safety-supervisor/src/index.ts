import { connect } from 'nats';
import {
  TOPICS, NATS_URL, encode, decode, now,
  SafetyCheckMessage
} from '../../../packages/shared/src/index.js';

const SERVICE = 'safety-supervisor';

const UNSAFE_INTENTS: string[] = [];

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

  const sub = nc.subscribe(TOPICS.SAFETY_CHECK);
  console.log(`[${SERVICE}] Subscribed to ${TOPICS.SAFETY_CHECK}`);

  for await (const msg of sub) {
    const data = decode<SafetyCheckMessage>(msg.data);
    const { intent } = data;

    console.log(`[${SERVICE}] Safety check for intent: ${intent}`);

    if (UNSAFE_INTENTS.includes(intent)) {
      console.log(`[${SERVICE}] ✗ UNSAFE intent blocked: ${intent}`);
      nc.publish(TOPICS.FAULT_DETECTED, encode({
        reason: `Unsafe intent blocked: ${intent}`,
        timestamp: now(),
      }));
    } else {
      console.log(`[${SERVICE}] ✓ Intent approved: ${intent}`);
      nc.publish(TOPICS.INTENT_APPROVED, encode({
        intent,
        timestamp: now(),
      }));
    }
  }
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
