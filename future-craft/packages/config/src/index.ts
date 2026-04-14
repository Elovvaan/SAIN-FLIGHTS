import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  NATS_URL: z.string().default('nats://localhost:4222'),
  SQLITE_PATH: z.string().default('./data/telemetry.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  VEHICLE_ID: z.string().default('sain-001'),
  PERCEPTION_HTTP_PORT: z.coerce.number().default(8010),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

export const config = loadConfig();
