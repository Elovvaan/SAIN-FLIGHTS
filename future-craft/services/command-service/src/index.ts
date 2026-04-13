import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, TOPICS } from '@future-craft/message-bus';
import { IntentTypeSchema, IntentType, Intent } from '@future-craft/schemas';

const logger = pino({ name: 'command-service', level: config.LOG_LEVEL });

export function normalizeIntent(raw: string, source = 'cli'): Intent | null {
  const normalized = raw.trim().toUpperCase().replace(/ /g, '_') as IntentType;
  const result = IntentTypeSchema.safeParse(normalized);
  if (!result.success) {
    logger.warn({ raw }, 'Unrecognized command');
    return null;
  }
  return {
    id: randomUUID(),
    type: result.data,
    source,
    timestamp: new Date().toISOString(),
  };
}

export async function dispatchIntent(raw: string, source = 'cli'): Promise<void> {
  const intent = normalizeIntent(raw, source);
  if (!intent) return;
  publish(TOPICS.INTENT_RECEIVED, intent);
  logger.info({ type: intent.type, id: intent.id }, 'Intent dispatched');
}

async function main(): Promise<void> {
  await connectBus();
  logger.info('command-service started — listening on stdin');

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', async (chunk: string) => {
    const lines = chunk.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      await dispatchIntent(line, 'stdin');
    }
  });

  setInterval(() => {
    publish('vehicle.command-service.heartbeat', { timestamp: new Date().toISOString() });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'command-service fatal error');
  process.exit(1);
});
