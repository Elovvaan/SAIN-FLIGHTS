import { VehicleState, IntentType } from '@future-craft/schemas';

export type TransitionResult =
  | { allowed: true; nextState: VehicleState }
  | { allowed: false; reason: string };

const TRANSITIONS: Record<VehicleState, Partial<Record<IntentType, VehicleState>>> = {
  STANDBY: {
    RUN_CHECKS: 'PREFLIGHT',
    SYSTEM_STATUS: 'STANDBY',
    BATTERY_STATUS: 'STANDBY',
  },
  PREFLIGHT: {
    ARM: 'ARMED_READY',
    SYSTEM_STATUS: 'PREFLIGHT',
    BATTERY_STATUS: 'PREFLIGHT',
  },
  ARMED_READY: {
    TAKEOFF: 'LAUNCH_INITIATION',
    SYSTEM_STATUS: 'ARMED_READY',
    BATTERY_STATUS: 'ARMED_READY',
  },
  LAUNCH_INITIATION: {
    HOVER: 'ASCENDING',
    SYSTEM_STATUS: 'LAUNCH_INITIATION',
  },
  ASCENDING: {
    HOVER: 'HOVER_STABLE',
    LAND: 'LAND_SEQUENCE',
    SYSTEM_STATUS: 'ASCENDING',
  },
  HOVER_STABLE: {
    FOLLOW: 'FOLLOW',
    LAND: 'LAND_SEQUENCE',
    HOLD_POSITION: 'HOVER_STABLE',
    FIELD_TEST: 'HOVER_STABLE',
    BATTERY_STATUS: 'HOVER_STABLE',
    SYSTEM_STATUS: 'HOVER_STABLE',
  },
  FOLLOW: {
    HOLD_POSITION: 'HOVER_STABLE',
    LAND: 'LAND_SEQUENCE',
    FIELD_TEST: 'FOLLOW',
    BATTERY_STATUS: 'FOLLOW',
    SYSTEM_STATUS: 'FOLLOW',
  },
  LAND_SEQUENCE: {
    SYSTEM_STATUS: 'LAND_SEQUENCE',
  },
  LANDED: {
    RUN_CHECKS: 'PREFLIGHT',
    SYSTEM_STATUS: 'LANDED',
    BATTERY_STATUS: 'LANDED',
  },
  EMERGENCY_HOVER: {
    LAND: 'LAND_SEQUENCE',
    SYSTEM_STATUS: 'EMERGENCY_HOVER',
  },
  FAULT_HOLD: {
    SYSTEM_STATUS: 'FAULT_HOLD',
    BATTERY_STATUS: 'FAULT_HOLD',
  },
};

export const EMERGENCY_TRANSITIONS: Partial<Record<VehicleState, VehicleState>> = {
  ASCENDING: 'EMERGENCY_HOVER',
  HOVER_STABLE: 'EMERGENCY_HOVER',
  FOLLOW: 'EMERGENCY_HOVER',
  LAUNCH_INITIATION: 'EMERGENCY_HOVER',
};

export function evaluateTransition(
  current: VehicleState,
  intent: IntentType,
): TransitionResult {
  const allowedIntents = TRANSITIONS[current];
  const nextState = allowedIntents?.[intent];
  if (nextState !== undefined) {
    return { allowed: true, nextState };
  }
  return {
    allowed: false,
    reason: `Intent '${intent}' is not allowed in state '${current}'`,
  };
}

export function forceEmergency(current: VehicleState): VehicleState {
  return EMERGENCY_TRANSITIONS[current] ?? 'FAULT_HOLD';
}

export function isGrounded(state: VehicleState): boolean {
  return state === 'STANDBY' || state === 'PREFLIGHT' || state === 'ARMED_READY' || state === 'LANDED';
}

export function isAirborne(state: VehicleState): boolean {
  return (
    state === 'ASCENDING' ||
    state === 'HOVER_STABLE' ||
    state === 'FOLLOW' ||
    state === 'LAND_SEQUENCE' ||
    state === 'LAUNCH_INITIATION'
  );
}
