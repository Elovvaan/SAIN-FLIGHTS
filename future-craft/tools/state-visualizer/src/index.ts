import { VehicleState, IntentType } from '@future-craft/schemas';
import { evaluateTransition } from '@future-craft/state-machine';

const states: VehicleState[] = [
  'STANDBY', 'PREFLIGHT', 'ARMED_READY', 'LAUNCH_INITIATION',
  'ASCENDING', 'HOVER_STABLE', 'FOLLOW', 'LAND_SEQUENCE',
  'LANDED', 'EMERGENCY_HOVER', 'FAULT_HOLD',
];

const intents: IntentType[] = [
  'RUN_CHECKS', 'ARM', 'TAKEOFF', 'HOVER', 'FOLLOW',
  'LAND', 'HOLD_POSITION', 'BATTERY_STATUS', 'SYSTEM_STATUS', 'FIELD_TEST',
];

console.log('\n=== Sain Flight State Transition Matrix ===\n');
for (const state of states) {
  const allowed: string[] = [];
  for (const intent of intents) {
    const result = evaluateTransition(state, intent);
    if (result.allowed) {
      allowed.push(`${intent} → ${result.nextState}`);
    }
  }
  console.log(`[${state}]`);
  for (const t of allowed) {
    console.log(`  ${t}`);
  }
}
