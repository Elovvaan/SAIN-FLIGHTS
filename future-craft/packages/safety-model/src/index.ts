import { IntentType, VehicleState, EnergyState } from '@future-craft/schemas';

export type SafetyDecision =
  | { safe: true }
  | { safe: false; reason: string; forceEmergency: boolean };

export function evaluateSafety(
  intent: IntentType,
  state: VehicleState,
  energy: EnergyState | null,
): SafetyDecision {
  if (energy) {
    if (energy.batteryPct <= 10 && intent === 'TAKEOFF') {
      return { safe: false, reason: 'Battery critically low — takeoff denied', forceEmergency: false };
    }
    if (energy.batteryPct <= 10 && (state === 'HOVER_STABLE' || state === 'FOLLOW' || state === 'ASCENDING')) {
      return { safe: false, reason: 'Battery critically low — forcing emergency', forceEmergency: true };
    }
  }
  if (intent === 'FIELD_TEST' && state !== 'HOVER_STABLE' && state !== 'FOLLOW') {
    return { safe: false, reason: 'FIELD_TEST only allowed when airborne and stable', forceEmergency: false };
  }
  return { safe: true };
}
