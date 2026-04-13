import { connect } from 'nats';
import {
  TOPICS, NATS_URL, encode, decode, now,
  IntentMessage
} from '../../../packages/shared/src/index.js';

const SERVICE = 'command-service';

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

  const sub = nc.subscribe(TOPICS.INTENT_RECEIVED);
  console.log(`[${SERVICE}] Subscribed to ${TOPICS.INTENT_RECEIVED}`);

  for await (const msg of sub) {
    const data = decode<IntentMessage>(msg.data);
    console.log(`[${SERVICE}] Received intent: ${data.intent} → routing to safety-supervisor`);

    nc.publish(TOPICS.SAFETY_CHECK, encode({
      intent: data.intent,
      timestamp: now(),
    }));
  }
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
