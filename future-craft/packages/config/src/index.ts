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
  // ── Execution-layer output mode ───────────────────────────────────────────
  // mixer      = existing FC-guided path (SET_ACTUATOR_CONTROL_TARGET routed
  //              through the FC mixer matrix before reaching ESCs).
  //              Compatible with standard GUIDED mode.  NOT guaranteed to
  //              preserve the [A,B,C,D] software motor ordering.
  // passthrough = direct actuator routing: software outputs are mapped 1-to-1
  //              to physical channels before transmission.  Requires the FC to
  //              be configured for passthrough (ArduPilot: SERVO_PASS_THRU or
  //              custom motor matrix; PX4: actuator direct mode).
  FC_OUTPUT_MODE: z.enum(['mixer', 'passthrough']).default('mixer'),
  // ── Motor channel map ─────────────────────────────────────────────────────
  // Physical ESC/PWM channel index (0-based) for each logical motor.
  // Default: straight-through (A→0, B→1, C→2, D→3).
  // Override when the airframe wires motors in a different order, e.g.:
  //   MOTOR_A_CHANNEL=2   if the front-right ESC is wired to channel 2.
  MOTOR_A_CHANNEL: z.coerce.number().int().min(0).max(3).default(0),
  MOTOR_B_CHANNEL: z.coerce.number().int().min(0).max(3).default(1),
  MOTOR_C_CHANNEL: z.coerce.number().int().min(0).max(3).default(2),
  MOTOR_D_CHANNEL: z.coerce.number().int().min(0).max(3).default(3),
  // ── Motor inversion flags ─────────────────────────────────────────────────
  // Set to 'true' or '1' when an ESC expects a reversed throttle signal for
  // that motor (value → 1 − value before transmission).
  MOTOR_A_INVERTED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MOTOR_B_INVERTED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MOTOR_C_INVERTED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MOTOR_D_INVERTED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // ── Safe-lift mode ────────────────────────────────────────────────────────
  // When true, limits intensity to SAFE_LIFT_MAX_INTENSITY, disables
  // aggressive phase velocity, locks translation (velocityX=0, velocityY=0),
  // enables stabilization only, and soft-starts thrust via the ramp controller.
  SAFE_LIFT_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Minimum intensity for the safe-lift ramp (% of full scale, 0–100).
  SAFE_LIFT_MIN_INTENSITY: z.coerce.number().min(0).max(100).default(10),
  // Maximum intensity allowed while in safe-lift mode (% of full scale, 0–100).
  SAFE_LIFT_MAX_INTENSITY: z.coerce.number().min(0).max(100).default(35),
  // Ramp duration in milliseconds (time to travel from min to max intensity).
  SAFE_LIFT_RAMP_DURATION_MS: z.coerce.number().min(0).default(3000),
  // ── Tethered test mode ────────────────────────────────────────────────────
  // When true, activates TETHER_MODE which behaves like SAFE_LIFT_MODE but
  // additionally requires TETHER_CONFIRM=true before the ramp will start.
  // Every stage is logged: armed / ramp_start / lift_detected / instability.
  TETHER_MODE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Confirmation flag required before the tethered ramp will start.
  TETHER_CONFIRM: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // ── Instability detection thresholds ─────────────────────────────────────
  // Maximum absolute roll or pitch (radians) before abort is triggered.
  INSTABILITY_MAX_ANGLE_RAD: z.coerce.number().default(0.436),
  // Maximum angular rate (radians/second) before abort is triggered.
  INSTABILITY_MAX_RATE_RAD_S: z.coerce.number().default(1.571),
  // Stable-band radius (radians); angles within ±this value are considered stable.
  INSTABILITY_STABLE_BAND_RAD: z.coerce.number().default(0.087),
  // ── Live telemetry stream ─────────────────────────────────────────────────
  // When true, a structured telemetry frame is emitted on every field-loop tick.
  TELEMETRY_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}

export const config = loadConfig();
