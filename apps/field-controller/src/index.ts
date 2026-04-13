import { connect } from 'nats';
import {
  TOPICS, NATS_URL, encode, decode, now,
  StateChangedMessage
} from '../../../packages/shared/src/index.js';

const SERVICE = 'field-controller';

async function main() {
  console.log(`[${SERVICE}] SERVICE_STARTING`);
  console.log(`[${SERVICE}] Connecting to NATS at ${NATS_URL}...`);
  const nc = await connect({
    servers: NATS_URL,
    reconnect: false,
  });
  console.log(`[${SERVICE}] Connected to NATS`);

  nc.publish(TOPICS.SERVICE_READY, encode({ service: SERVICE, timestamp: now() }));
  console.log(`[${SERVICE}] SERVICE_READY`);

  const sub = nc.subscribe(TOPICS.STATE_CHANGED);
  console.log(`[${SERVICE}] Subscribed to ${TOPICS.STATE_CHANGED}`);
  console.log(`[${SERVICE}] SERVICE_SUBSCRIPTIONS_READY`);

  for await (const msg of sub) {
    const data = decode<StateChangedMessage>(msg.data);
    const { currentState } = data;

    if (currentState === 'FIELD_TEST') {
      console.log(`[${SERVICE}] Activating mock field zones...`);
      console.log(`[${SERVICE}] field zones active`);

      nc.publish(TOPICS.FIELD_PLAN, encode({
        zones: ['alpha', 'beta', 'gamma'],
        pattern: 'grid-sweep',
        timestamp: now(),
      }));

      nc.publish(TOPICS.FIELD_HEALTH, encode({
        status: 'nominal',
        zonesActive: true,
        zones: ['alpha', 'beta', 'gamma'],
        timestamp: now(),
      }));
    }
  }
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
