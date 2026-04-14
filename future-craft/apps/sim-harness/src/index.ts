import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { IntentType, Intent, StateChangedEvent } from '@future-craft/schemas';

const logger = pino({ name: 'sim-harness', level: config.LOG_LEVEL });

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatch(type: IntentType): void {
  const intent: Intent = {
    id: randomUUID(),
    type,
    source: 'sim-harness',
    timestamp: new Date().toISOString(),
  };
  publish(TOPICS.INTENT_RECEIVED, intent);
  logger.info({ type }, 'Sim dispatched intent');
}

async function runSimSequence(): Promise<void> {
  logger.info('=== SIM SEQUENCE STARTED ===');

  const stateLog: string[] = [];
  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, (event) => {
    stateLog.push(`${event.from} → ${event.to}`);
    logger.info({ from: event.from, to: event.to }, 'STATE CHANGE');
  });

  await delay(1000);

  logger.info('Step 1: RUN_CHECKS');
  dispatch('RUN_CHECKS');
  await delay(1500);

  logger.info('Step 2: ARM');
  dispatch('ARM');
  await delay(1500);

  logger.info('Step 3: TAKEOFF');
  dispatch('TAKEOFF');
  await delay(2000);

  logger.info('Step 4: Simulate ascent complete (HOVER transition)');
  dispatch('HOVER');
  await delay(2000);

  logger.info('Step 5: FOLLOW');
  dispatch('FOLLOW');
  await delay(2000);

  logger.info('Step 6: HOLD_POSITION');
  dispatch('HOLD_POSITION');
  await delay(1500);

  logger.info('Step 7: FIELD_TEST');
  dispatch('FIELD_TEST');
  await delay(2000);

  logger.info('Step 8: LAND');
  dispatch('LAND');
  await delay(3000);

  logger.info({ stateLog }, '=== SIM SEQUENCE COMPLETE ===');
  logger.info('State transitions recorded:');
  stateLog.forEach((s) => logger.info(`  ${s}`));
}

async function main(): Promise<void> {
  await connectBus();
  logger.info('sim-harness connected to bus');
  await runSimSequence();
  await delay(1000);
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'sim-harness fatal error');
  process.exit(1);
});
