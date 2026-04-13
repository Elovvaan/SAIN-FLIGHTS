import { VehicleState, FaultEvent, IntentType } from '@future-craft/schemas';

export function stateChangePhrase(from: VehicleState, to: VehicleState): string {
  const phrases: Partial<Record<VehicleState, string>> = {
    PREFLIGHT: 'Running preflight checks.',
    ARMED_READY: 'Systems armed. Ready for takeoff.',
    LAUNCH_INITIATION: 'Launch sequence initiated.',
    ASCENDING: 'Ascending to target altitude.',
    HOVER_STABLE: 'Hover stable. Awaiting instruction.',
    FOLLOW: 'Follow mode engaged.',
    LAND_SEQUENCE: 'Landing sequence started. Stand clear.',
    LANDED: 'Landed. Motors disarmed.',
    EMERGENCY_HOVER: 'Emergency hover activated.',
    FAULT_HOLD: 'Fault hold engaged. System halted.',
  };
  return phrases[to] ?? `Transitioning from ${from} to ${to}.`;
}

export function intentDeniedPhrase(intent: IntentType, reason: string): string {
  return `Command ${intent.replace('_', ' ').toLowerCase()} denied. ${reason}`;
}

export function faultPhrase(fault: FaultEvent): string {
  return `${fault.severity} fault: ${fault.message}`;
}
