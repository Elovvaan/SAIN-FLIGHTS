import * as readline from 'readline';
import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { IntentTypeSchema, StateChangedEvent, SpeechRequest } from '@future-craft/schemas';

const logger = pino({ name: 'ground-console', level: config.LOG_LEVEL });

async function main(): Promise<void> {
  await connectBus();
  logger.info('ground-console started');

  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, (event) => {
    console.log(`\n[STATE] ${event.from} → ${event.to} (${event.reason})`);
  });

  subscribe<SpeechRequest>(TOPICS.SPEECH_REQUESTED, (req) => {
    console.log(`[SAIN] ${req.text}`);
  });

  subscribe<object>(TOPICS.FAULT_DETECTED, (fault) => {
    console.log(`[FAULT] ${JSON.stringify(fault)}`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n=== Sain Flight Ground Console ===');
  console.log('Commands: RUN_CHECKS | ARM | TAKEOFF | HOVER | FOLLOW | LAND | HOLD_POSITION | FIELD_TEST | BATTERY_STATUS | SYSTEM_STATUS');
  console.log('Type a command and press Enter.\n');

  rl.on('line', (line) => {
    const raw = line.trim().toUpperCase().replace(/ /g, '_');
    const result = IntentTypeSchema.safeParse(raw);
    if (!result.success) {
      console.log(`Unknown command: ${line}`);
      return;
    }
    publish(TOPICS.INTENT_RECEIVED, {
      id: randomUUID(),
      type: result.data,
      source: 'ground-console',
      timestamp: new Date().toISOString(),
    });
    console.log(`→ Dispatched: ${result.data}`);
  });
}

main().catch((err) => {
  logger.error({ err }, 'ground-console fatal error');
  process.exit(1);
});
