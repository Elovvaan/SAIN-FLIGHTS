import Database from 'better-sqlite3';
import { config } from '@future-craft/config';

function analyze(): void {
  const db = new Database(config.SQLITE_PATH, { readonly: true });
  const fieldEvents = db.prepare(
    "SELECT * FROM telemetry_events WHERE topic = 'vehicle.field.plan' OR topic = 'vehicle.field.health' ORDER BY recorded_at ASC",
  ).all() as Array<{ id: string; topic: string; payload: string; recorded_at: string }>;

  console.log(`\n=== Field Test Analysis (${fieldEvents.length} events) ===\n`);
  for (const ev of fieldEvents) {
    console.log(`[${ev.recorded_at}] ${ev.topic}`);
    const payload = JSON.parse(ev.payload);
    console.log(JSON.stringify(payload, null, 2));
    console.log('---');
  }
  db.close();
}

analyze();
