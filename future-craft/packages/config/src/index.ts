import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  NATS_URL: z.string().default('nats://localhost:4222'),
  SQLITE_PATH: z.string().default('./data/telemetry.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  VEHICLE_ID: z.string().default('sain-001'),
  PERCEPTION_HTTP_PORT: z.coerce.number().default(8010),
  // Hardware mode — 'sim' keeps simulation adapters; 'mavlink' uses real flight controller
  FC_HARDWARE_MODE: z.enum(['sim', 'mavlink']).default('sim'),
  FC_MAVLINK_HOST: z.string().default('127.0.0.1'),
  FC_MAVLINK_PORT: z.coerce.number().default(14550),
  FC_MAVLINK_TARGET_SYS: z.coerce.number().default(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

export const config = loadConfig();
