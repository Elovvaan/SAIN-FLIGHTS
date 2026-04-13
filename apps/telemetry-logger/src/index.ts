import { connect } from 'nats';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  TOPICS, NATS_URL, decode, now
} from '../../../packages/shared/src/index.js';

const SERVICE = 'telemetry-logger';

const dataDir = join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, 'telemetry.db');
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )
`);

const insertRow = db.prepare('INSERT INTO telemetry (topic, payload, recorded_at) VALUES (?, ?, ?)');

function record(topic: string, payload: unknown) {
  const row = insertRow.run(topic, JSON.stringify(payload), now());
  console.log(`[${SERVICE}] Recorded [${topic}] row id=${row.lastInsertRowid}`);
}

async function main() {
  console.log(`[${SERVICE}] SERVICE_STARTING`);
  console.log(`[${SERVICE}] Connecting to NATS at ${NATS_URL}...`);
  const nc = await connect({
    servers: NATS_URL,
    reconnect: false,
  });
  console.log(`[${SERVICE}] Connected to NATS`);
  console.log(`[${SERVICE}] Telemetry DB: ${dbPath}`);
  console.log(`[${SERVICE}] SERVICE_READY`);

  const watchedTopics = [
    TOPICS.INTENT_RECEIVED,
    TOPICS.STATE_CHANGED,
    TOPICS.MOTION_PLAN,
    TOPICS.FIELD_PLAN,
    TOPICS.ENERGY_UPDATED,
    TOPICS.FAULT_DETECTED,
    TOPICS.PROPULSION_HEALTH,
    TOPICS.FIELD_HEALTH,
    TOPICS.INTENT_DENIED,
    TOPICS.SAFETY_CHECK,
    TOPICS.INTENT_APPROVED,
  ];

  for (const topic of watchedTopics) {
    const sub = nc.subscribe(topic);
    console.log(`[${SERVICE}] Subscribed to ${topic}`);
    (async () => {
      for await (const msg of sub) {
        try {
          const data = decode<unknown>(msg.data);
          record(topic, data);
        } catch (err) {
          const raw = new TextDecoder().decode(msg.data);
          console.warn(`[${SERVICE}] Failed to decode message on ${topic}: ${err}. Recording raw.`);
          record(topic, { raw });
        }
      }
    })();
  }

  console.log(`[${SERVICE}] SERVICE_SUBSCRIPTIONS_READY`);

  await nc.closed();
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
