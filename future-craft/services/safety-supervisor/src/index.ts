import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { evaluateSafety } from '@future-craft/safety-model';
import {
  Intent, VehicleState, EnergyState, FaultEvent,
  PropulsionHealth, FieldHealth, StateChangedEvent,
} from '@future-craft/schemas';

const logger = pino({ name: 'safety-supervisor', level: config.LOG_LEVEL });

let currentState: VehicleState = 'STANDBY';
let lastEnergy: EnergyState | null = null;
let propulsionHealthy = true;
let fieldHealthy = true;

function emitFault(code: string, message: string, severity: FaultEvent['severity']): void {
  const fault: FaultEvent = {
    id: randomUUID(),
    source: 'safety-supervisor',
    severity,
    code,
    message,
    timestamp: new Date().toISOString(),
  };
  publish(TOPICS.FAULT_DETECTED, fault);
  logger.error({ code, severity, message }, 'Fault detected');
}

async function main(): Promise<void> {
  await connectBus();
  logger.info('safety-supervisor started — highest authority active');

  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, (event) => {
    currentState = event.to;
  });

  subscribe<EnergyState>(TOPICS.ENERGY_UPDATED, (energy) => {
    lastEnergy = energy;
    if (energy.batteryPct <= 10) {
      emitFault('LOW_BATTERY_CRITICAL', `Battery at ${energy.batteryPct}% — critical`, 'EMERGENCY');
    } else if (energy.batteryPct <= 20) {
      emitFault('LOW_BATTERY_WARNING', `Battery at ${energy.batteryPct}% — reserve active`, 'WARNING');
    }
  });

  subscribe<PropulsionHealth>(TOPICS.PROPULSION_HEALTH, (health) => {
    propulsionHealthy = health.overallHealthy;
    if (!propulsionHealthy) {
      emitFault('PROPULSION_DEGRADED', 'One or more lift cells reporting unhealthy', 'CRITICAL');
    }
  });

  subscribe<FieldHealth>(TOPICS.FIELD_HEALTH, (health) => {
    fieldHealthy = health.overallHealthy;
    if (!fieldHealthy) {
      emitFault('FIELD_SYSTEM_DEGRADED', 'Field zone reporting unhealthy', 'WARNING');
    }
  });

  subscribe<Intent>(TOPICS.INTENT_RECEIVED, (intent) => {
    const decision = evaluateSafety(intent.type, currentState, lastEnergy);
    if (!decision.safe) {
      publish(TOPICS.INTENT_DENIED, {
        intentId: intent.id,
        type: intent.type,
        reason: decision.reason,
        state: currentState,
        timestamp: new Date().toISOString(),
      });
      logger.warn({ intent: intent.type, reason: decision.reason }, 'Safety supervisor denied intent');
      if (decision.forceEmergency) {
        emitFault('SAFETY_FORCE_EMERGENCY', decision.reason, 'EMERGENCY');
      }
    }
  });

  setInterval(() => {
    publish('vehicle.safety-supervisor.heartbeat', {
      propulsionHealthy,
      fieldHealthy,
      batteryPct: lastEnergy?.batteryPct ?? null,
      timestamp: new Date().toISOString(),
    });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'safety-supervisor fatal error');
  process.exit(1);
});
