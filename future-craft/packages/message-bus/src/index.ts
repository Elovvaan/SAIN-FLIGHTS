import { connect, NatsConnection, JSONCodec, Subscription } from 'nats';
import pino from 'pino';
import { config } from '@future-craft/config';

const logger = pino({ name: 'message-bus', level: config.LOG_LEVEL });
const jc = JSONCodec();

export const TOPICS = {
  INTENT_RECEIVED: 'vehicle.intent.received',
  INTENT_DENIED: 'vehicle.intent.denied',
  STATE_CHANGED: 'vehicle.state.changed',
  SCENE_UPDATED: 'vehicle.scene.updated',
  MOTION_PLAN: 'vehicle.motion.plan',
  PROPULSION_HEALTH: 'vehicle.propulsion.health',
  FIELD_PLAN: 'vehicle.field.plan',
  FIELD_HEALTH: 'vehicle.field.health',
  ENERGY_UPDATED: 'vehicle.energy.updated',
  FAULT_DETECTED: 'vehicle.fault.detected',
  SPEECH_REQUESTED: 'vehicle.speech.requested',
  TELEMETRY_EVENT: 'vehicle.telemetry.event',
} as const;

export type Topic = typeof TOPICS[keyof typeof TOPICS];

let nc: NatsConnection | null = null;

export async function connectBus(): Promise<NatsConnection> {
  nc = await connect({ servers: config.NATS_URL });
  logger.info({ url: config.NATS_URL }, 'Connected to NATS message bus');
  return nc;
}

export async function disconnectBus(): Promise<void> {
  if (nc) {
    await nc.drain();
    nc = null;
    logger.info('Disconnected from NATS message bus');
  }
}

export function getBus(): NatsConnection {
  if (!nc) throw new Error('Message bus not connected. Call connectBus() first.');
  return nc;
}

export function publish<T>(topic: string, payload: T): void {
  const bus = getBus();
  bus.publish(topic, jc.encode(payload));
  logger.debug({ topic }, 'Published message');
}

export function subscribe<T>(
  topic: string,
  handler: (data: T) => void | Promise<void>,
): Subscription {
  const bus = getBus();
  const sub = bus.subscribe(topic);
  (async () => {
    for await (const msg of sub) {
      try {
        const data = jc.decode(msg.data) as T;
        await handler(data);
      } catch (err) {
        logger.error({ topic, err }, 'Error handling message');
      }
    }
  })();
  logger.debug({ topic }, 'Subscribed to topic');
  return sub;
}
