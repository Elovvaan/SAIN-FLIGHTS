import pino from 'pino';
import { config } from '@future-craft/config';
import { connectBus, subscribe, publish, TOPICS } from '@future-craft/message-bus';
import { SimAudioLink } from '@future-craft/audio-link';
import { SpeechRequest } from '@future-craft/schemas';

const logger = pino({ name: 'audio-io', level: config.LOG_LEVEL });
const audio = new SimAudioLink();

async function main(): Promise<void> {
  await audio.connect();
  await connectBus();
  logger.info('audio-io started');

  subscribe<SpeechRequest>(TOPICS.SPEECH_REQUESTED, async (req) => {
    logger.info({ id: req.id, priority: req.priority }, 'Speaking request received');
    await audio.speak(req.text);
  });

  setInterval(() => {
    publish('vehicle.audio-io.heartbeat', { timestamp: new Date().toISOString() });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'audio-io fatal error');
  process.exit(1);
});
