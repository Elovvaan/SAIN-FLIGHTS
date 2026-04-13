import pino from 'pino';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { openDb } from './db';

const logger = pino({ name: 'telemetry-logger', level: config.LOG_LEVEL });

let db: Database.Database;
let sessionId: string;

function startSession(): void {
  sessionId = randomUUID();
  db.prepare('INSERT INTO sessions (id, vehicle_id, started_at) VALUES (?, ?, ?)').run(
    sessionId,
    config.VEHICLE_ID,
    new Date().toISOString(),
  );
  logger.info({ sessionId }, 'Telemetry session started');
}

function logEvent(topic: string, payload: unknown): void {
  db.prepare(
    'INSERT INTO telemetry_events (id, session_id, vehicle_id, topic, payload, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    randomUUID(),
    sessionId,
    config.VEHICLE_ID,
    topic,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

async function main(): Promise<void> {
  db = openDb();
  startSession();
  await connectBus();
  logger.info('telemetry-logger started');

  const topics = [
    TOPICS.STATE_CHANGED,
    TOPICS.INTENT_RECEIVED,
    TOPICS.INTENT_DENIED,
    TOPICS.MOTION_PLAN,
    TOPICS.ENERGY_UPDATED,
    TOPICS.FAULT_DETECTED,
    TOPICS.PROPULSION_HEALTH,
    TOPICS.FIELD_HEALTH,
    TOPICS.FIELD_PLAN,
    TOPICS.SCENE_UPDATED,
    TOPICS.SPEECH_REQUESTED,
  ];

  for (const topic of topics) {
    subscribe(topic, (payload) => {
      logEvent(topic, payload);
    });
  }

  process.on('SIGTERM', () => {
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      sessionId,
    );
    logger.info({ sessionId }, 'Telemetry session ended (SIGTERM)');
    process.exit(0);
  });

  setInterval(() => {
    publish('vehicle.telemetry-logger.heartbeat', { sessionId, timestamp: new Date().toISOString() });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'telemetry-logger fatal error');
  process.exit(1);
});
