import Database from 'better-sqlite3';
import { config } from '@future-craft/config';
import pino from 'pino';

const logger = pino({ name: 'log-replay' });

function replay(): void {
  const db = new Database(config.SQLITE_PATH, { readonly: true });
  const events = db.prepare(
    'SELECT * FROM telemetry_events ORDER BY recorded_at ASC',
  ).all() as Array<{
    id: string; session_id: string; vehicle_id: string;
    topic: string; payload: string; recorded_at: string;
  }>;
  logger.info({ count: events.length }, 'Replaying telemetry events');
  for (const ev of events) {
    console.log(`[${ev.recorded_at}] [${ev.topic}] ${ev.payload}`);
  }
  db.close();
}

replay();
