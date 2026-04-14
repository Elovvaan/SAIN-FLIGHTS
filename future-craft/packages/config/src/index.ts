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
  // ── Version-1 tangential-field control mode ────────────────────────────────
  // When true, propulsion-controller routes motion plans through the field
  // solver rather than the flat avgLift model.
  FIELD_MODE_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Phase advance rate in radians per second (default ≈ one full rotation / 2 s).
  FIELD_PHASE_VELOCITY: z.coerce.number().default(Math.PI),
  // Spin direction: any value ≥ 0 = clockwise (1), negative = counter-clockwise (−1).
  FIELD_SPIN: z.coerce
    .number()
    .default(1)
    .transform((v) => (v >= 0 ? 1 : -1) as 1 | -1),
  // Scale applied to solver outputs before sending to the flight controller.
  // 1.0 = full range [0..1]; reduce to limit maximum motor power.
  FIELD_OUTPUT_SCALE: z.coerce.number().min(0).max(1).default(1),
  // ── Field stabilization (IMU-driven phase / bias / intensity correction) ────
  // When true, applyFieldStabilization() is called every field-loop tick.
  FIELD_STABILIZATION_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Phase-correction proportional gain for pitch error (rad/s per rad).
  FIELD_KP_PITCH: z.coerce.number().default(0.8),
  // Phase-correction proportional gain for roll error (rad/s per rad).
  FIELD_KP_ROLL: z.coerce.number().default(0.8),
  // Bias-correction gain for pitch error (bias-units/s per rad).
  FIELD_KB_PITCH: z.coerce.number().default(0.2),
  // Bias-correction gain for roll error (bias-units/s per rad).
  FIELD_KB_ROLL: z.coerce.number().default(0.2),
  // Intensity-correction gain for altitude error (%/s per metre).
  FIELD_KI_ALT: z.coerce.number().default(0.1),
  // ── Field translation (velocity-driven directional movement) ─────────────
  // When true, translateField() is called every field-loop tick after
  // stabilization, shifting the field center to produce directional movement
  // WITHOUT tilting the craft.
  FIELD_TRANSLATION_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Gain applied to the translation phase offset (phase radians per unit velocity per second).
  FIELD_TRANSLATION_GAIN: z.coerce.number().default(0.4),
  // Gain applied to the lateral bias assist (bias-units per unit velocity per second).
  FIELD_BIAS_GAIN: z.coerce.number().default(0.1),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

export const config = loadConfig();
