import { connect } from 'nats';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  TOPICS, NATS_URL, decode, now
} from '../../../packages/shared/src/index.js';

// Use Node.js built-in SQLite (available in Node.js v22.5+)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: unknown[]): { lastInsertRowid: number | bigint } };
  };
};

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
  console.log(`[${SERVICE}] Connecting to NATS at ${NATS_URL}...`);
  const nc = await connect({
    servers: NATS_URL,
    reconnect: true,
    maxReconnectAttempts: -1,
    waitOnFirstConnect: true,
  });
  console.log(`[${SERVICE}] Connected to NATS`);
  console.log(`[${SERVICE}] Telemetry DB: ${dbPath}`);

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
        } catch {
          record(topic, { raw: new TextDecoder().decode(msg.data) });
        }
      }
    })();
  }

  await nc.closed();
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
