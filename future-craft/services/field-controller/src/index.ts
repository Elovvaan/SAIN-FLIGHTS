import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { SimFieldDriverLink } from '@future-craft/field-driver-link';
import { Intent, FieldHealth, FieldPlan } from '@future-craft/schemas';

const logger = pino({ name: 'field-controller', level: config.LOG_LEVEL });
const fieldDriver = new SimFieldDriverLink();

function publishHealth(): void {
  const health: FieldHealth = {
    vehicleId: config.VEHICLE_ID,
    zone1Ok: true,
    zone2Ok: true,
    zone3Ok: true,
    overallHealthy: true,
    timestamp: new Date().toISOString(),
  };
  publish(TOPICS.FIELD_HEALTH, health);
}

async function main(): Promise<void> {
  await fieldDriver.connect();
  await connectBus();
  logger.info('field-controller started');

  subscribe<Intent>(TOPICS.INTENT_RECEIVED, async (intent) => {
    if (intent.type === 'FIELD_TEST') {
      logger.info('field-controller: executing FIELD_TEST sequence');
      const plan: FieldPlan = {
        id: randomUUID(),
        zoneId: 'zone-1',
        action: 'PULSE',
        intensityPct: 75,
        durationMs: 2000,
        timestamp: new Date().toISOString(),
      };
      publish(TOPICS.FIELD_PLAN, plan);
      await fieldDriver.activateZone('zone-1', 75, 2000);
      publishHealth();
    }
  });

  setInterval(() => {
    publishHealth();
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'field-controller fatal error');
  process.exit(1);
});
