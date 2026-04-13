import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '@future-craft/config';

export function openDb(): Database.Database {
  const dbPath = config.SQLITE_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tel_session ON telemetry_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_tel_topic ON telemetry_events(topic);
  `);
  return db;
}
