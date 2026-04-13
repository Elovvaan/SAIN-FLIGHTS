export const TOPICS = {
  INTENT_RECEIVED: 'vehicle.intent.received',
  SAFETY_CHECK: 'vehicle.safety.check',
  INTENT_APPROVED: 'vehicle.intent.approved',
  INTENT_DENIED: 'vehicle.intent.denied',
  STATE_CHANGED: 'vehicle.state.changed',
  MOTION_PLAN: 'vehicle.motion.plan',
  PROPULSION_HEALTH: 'vehicle.propulsion.health',
  FIELD_PLAN: 'vehicle.field.plan',
  FIELD_HEALTH: 'vehicle.field.health',
  ENERGY_UPDATED: 'vehicle.energy.updated',
  FAULT_DETECTED: 'vehicle.fault.detected',
  SCENE_UPDATED: 'vehicle.scene.updated',
  SERVICE_READY: 'vehicle.service.ready',
} as const;

export type Topic = typeof TOPICS[keyof typeof TOPICS];

export type VehicleState =
  | 'IDLE'
  | 'RUN_CHECKS'
  | 'ARM'
  | 'TAKEOFF'
  | 'HOVER_STABLE'
  | 'FOLLOW'
  | 'HOLD_POSITION'
  | 'FIELD_TEST'
  | 'LAND';

export type Intent = VehicleState;

export const VALID_TRANSITIONS: Record<VehicleState, VehicleState[]> = {
  IDLE: ['RUN_CHECKS'],
  RUN_CHECKS: ['ARM'],
  ARM: ['TAKEOFF'],
  TAKEOFF: ['HOVER_STABLE'],
  HOVER_STABLE: ['FOLLOW', 'HOLD_POSITION', 'LAND'],
  FOLLOW: ['HOLD_POSITION', 'HOVER_STABLE', 'LAND'],
  HOLD_POSITION: ['FIELD_TEST', 'FOLLOW', 'HOVER_STABLE', 'LAND'],
  FIELD_TEST: ['LAND', 'HOLD_POSITION'],
  LAND: ['IDLE'],
};

export function canTransition(from: VehicleState, to: VehicleState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface IntentMessage {
  intent: Intent;
  timestamp: string;
  source?: string;
}

export interface StateChangedMessage {
  previousState: VehicleState;
  currentState: VehicleState;
  timestamp: string;
}

export interface MotionPlanMessage {
  state: VehicleState;
  action: string;
  timestamp: string;
}

export interface SafetyCheckMessage {
  intent: Intent;
  timestamp: string;
}

export interface FieldHealthMessage {
  status: string;
  zonesActive: boolean;
  timestamp: string;
}

export interface PropulsionHealthMessage {
  status: string;
  state: VehicleState;
  timestamp: string;
}

export interface ServiceReadyMessage {
  service: string;
  timestamp: string;
}

export const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

export function encode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

export function decode<T>(data: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

export function now(): string {
  return new Date().toISOString();
}
