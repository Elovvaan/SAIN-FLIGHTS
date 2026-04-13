import { z } from 'zod';

// === Intents ===
export const IntentTypeSchema = z.enum([
  'RUN_CHECKS', 'ARM', 'TAKEOFF', 'HOVER', 'FOLLOW',
  'LAND', 'HOLD_POSITION', 'BATTERY_STATUS', 'SYSTEM_STATUS', 'FIELD_TEST',
]);
export type IntentType = z.infer<typeof IntentTypeSchema>;

export const IntentSchema = z.object({
  id: z.string(),
  type: IntentTypeSchema,
  source: z.string(),
  payload: z.record(z.unknown()).optional(),
  timestamp: z.string(),
});
export type Intent = z.infer<typeof IntentSchema>;

// === Vehicle States ===
export const VehicleStateSchema = z.enum([
  'STANDBY', 'PREFLIGHT', 'ARMED_READY', 'LAUNCH_INITIATION',
  'ASCENDING', 'HOVER_STABLE', 'FOLLOW', 'LAND_SEQUENCE',
  'LANDED', 'EMERGENCY_HOVER', 'FAULT_HOLD',
]);
export type VehicleState = z.infer<typeof VehicleStateSchema>;

export const StateChangedEventSchema = z.object({
  from: VehicleStateSchema,
  to: VehicleStateSchema,
  reason: z.string(),
  timestamp: z.string(),
  vehicleId: z.string(),
});
export type StateChangedEvent = z.infer<typeof StateChangedEventSchema>;

// === Motion Plan ===
export const MotionPlanSchema = z.object({
  id: z.string(),
  type: z.enum(['ASCEND', 'DESCEND', 'HOVER', 'FOLLOW', 'HOLD']),
  targetAltitudeM: z.number().optional(),
  targetVelocityMps: z.number().optional(),
  durationMs: z.number().optional(),
  timestamp: z.string(),
});
export type MotionPlan = z.infer<typeof MotionPlanSchema>;

// === Field Plan ===
export const FieldPlanSchema = z.object({
  id: z.string(),
  zoneId: z.string(),
  action: z.enum(['ACTIVATE', 'DEACTIVATE', 'PULSE', 'STATUS']),
  intensityPct: z.number().min(0).max(100).optional(),
  durationMs: z.number().optional(),
  timestamp: z.string(),
});
export type FieldPlan = z.infer<typeof FieldPlanSchema>;

// === Energy State ===
export const EnergyStateSchema = z.object({
  vehicleId: z.string(),
  batteryPct: z.number().min(0).max(100),
  voltageMv: z.number(),
  currentMa: z.number(),
  estimatedRemainingMs: z.number(),
  propulsionBudgetW: z.number(),
  fieldBudgetW: z.number(),
  reserveActive: z.boolean(),
  timestamp: z.string(),
});
export type EnergyState = z.infer<typeof EnergyStateSchema>;

// === Scene State ===
export const SceneStateSchema = z.object({
  vehicleId: z.string(),
  obstaclesDetected: z.number(),
  clearanceM: z.number(),
  targetVisible: z.boolean(),
  targetDistanceM: z.number().optional(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  timestamp: z.string(),
});
export type SceneState = z.infer<typeof SceneStateSchema>;

// === Fault Event ===
export const FaultSeveritySchema = z.enum(['WARNING', 'CRITICAL', 'EMERGENCY']);
export const FaultEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  severity: FaultSeveritySchema,
  code: z.string(),
  message: z.string(),
  timestamp: z.string(),
});
export type FaultEvent = z.infer<typeof FaultEventSchema>;

// === Speech Request ===
export const SpeechRequestSchema = z.object({
  id: z.string(),
  text: z.string(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'EMERGENCY']).default('NORMAL'),
  timestamp: z.string(),
});
export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;

// === Telemetry Event ===
export const TelemetryEventSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  topic: z.string(),
  payload: z.record(z.unknown()),
  timestamp: z.string(),
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// === Propulsion Health ===
export const PropulsionHealthSchema = z.object({
  vehicleId: z.string(),
  liftCell1Ok: z.boolean(),
  liftCell2Ok: z.boolean(),
  liftCell3Ok: z.boolean(),
  liftCell4Ok: z.boolean(),
  thrustCorridor0k: z.boolean(),
  overallHealthy: z.boolean(),
  timestamp: z.string(),
});
export type PropulsionHealth = z.infer<typeof PropulsionHealthSchema>;

// === Field Health ===
export const FieldHealthSchema = z.object({
  vehicleId: z.string(),
  zone1Ok: z.boolean(),
  zone2Ok: z.boolean(),
  zone3Ok: z.boolean(),
  overallHealthy: z.boolean(),
  timestamp: z.string(),
});
export type FieldHealth = z.infer<typeof FieldHealthSchema>;
