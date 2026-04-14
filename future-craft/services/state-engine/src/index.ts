import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { evaluateTransition, forceEmergency } from '@future-craft/state-machine';
import {
  Intent, VehicleState, StateChangedEvent,
  FaultEvent,
} from '@future-craft/schemas';

const logger = pino({ name: 'state-engine', level: config.LOG_LEVEL });

let currentState: VehicleState = 'STANDBY';

function transition(to: VehicleState, reason: string): void {
  const from = currentState;
  currentState = to;
  const event: StateChangedEvent = {
    from,
    to,
    reason,
    timestamp: new Date().toISOString(),
    vehicleId: config.VEHICLE_ID,
  };
  publish(TOPICS.STATE_CHANGED, event);
  logger.info({ from, to, reason }, 'State transitioned');
}

async function main(): Promise<void> {
  await connectBus();
  logger.info({ initialState: currentState }, 'state-engine started');

  subscribe<Intent>(TOPICS.INTENT_RECEIVED, (intent) => {
    logger.info({ intent: intent.type, currentState }, 'Evaluating intent');
    const result = evaluateTransition(currentState, intent.type);
    if (result.allowed) {
      transition(result.nextState, `Intent: ${intent.type}`);
    } else {
      publish(TOPICS.INTENT_DENIED, {
        intentId: intent.id,
        type: intent.type,
        reason: result.reason,
        state: currentState,
        timestamp: new Date().toISOString(),
      });
      logger.warn({ intent: intent.type, reason: result.reason }, 'Intent denied');
    }
  });

  subscribe<FaultEvent>(TOPICS.FAULT_DETECTED, (fault) => {
    if (fault.severity === 'EMERGENCY') {
      const emergencyState = forceEmergency(currentState);
      transition(emergencyState, `Emergency fault: ${fault.code}`);
    }
  });

  setInterval(() => {
    publish('vehicle.state-engine.heartbeat', {
      state: currentState,
      timestamp: new Date().toISOString(),
    });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'state-engine fatal error');
  process.exit(1);
});
