import pino from 'pino';
import { randomUUID } from 'crypto';
import { config } from '@future-craft/config';
import { connectBus, publish, subscribe, TOPICS } from '@future-craft/message-bus';
import { stateChangePhrase, intentDeniedPhrase, faultPhrase } from '@future-craft/voice-model';
import {
  StateChangedEvent, FaultEvent, SceneState, SpeechRequest,
  IntentType,
} from '@future-craft/schemas';

const logger = pino({ name: 'agent-runtime', level: config.LOG_LEVEL });

function speak(text: string, priority: SpeechRequest['priority'] = 'NORMAL'): void {
  const req: SpeechRequest = {
    id: randomUUID(),
    text,
    priority,
    timestamp: new Date().toISOString(),
  };
  publish(TOPICS.SPEECH_REQUESTED, req);
}

async function main(): Promise<void> {
  await connectBus();
  logger.info('agent-runtime started');

  subscribe<StateChangedEvent>(TOPICS.STATE_CHANGED, (event) => {
    const phrase = stateChangePhrase(event.from, event.to);
    speak(phrase);
    logger.info({ to: event.to, phrase }, 'Agent speaking state change');
  });

  subscribe<{ type: IntentType; reason: string }>(TOPICS.INTENT_DENIED, (event) => {
    const phrase = intentDeniedPhrase(event.type, event.reason);
    speak(phrase, 'HIGH');
  });

  subscribe<FaultEvent>(TOPICS.FAULT_DETECTED, (fault) => {
    const phrase = faultPhrase(fault);
    const priority: SpeechRequest['priority'] = fault.severity === 'EMERGENCY' ? 'EMERGENCY' : 'HIGH';
    speak(phrase, priority);
  });

  subscribe<SceneState>(TOPICS.SCENE_UPDATED, (scene) => {
    if (scene.obstaclesDetected > 0) {
      speak(`Obstacle detected at ${scene.clearanceM.toFixed(1)} meters clearance.`, 'HIGH');
    }
  });

  setInterval(() => {
    publish('vehicle.agent-runtime.heartbeat', { timestamp: new Date().toISOString() });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'agent-runtime fatal error');
  process.exit(1);
});
