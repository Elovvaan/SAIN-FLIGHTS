import pino from 'pino';
import type { AudioLink } from '@future-craft/hardware-abstraction';

const logger = pino({ name: 'audio-link' });

export class SimAudioLink implements AudioLink {
  async connect(): Promise<void> {
    logger.info('SimAudioLink: connected (sim mode)');
  }

  async disconnect(): Promise<void> {
    logger.info('SimAudioLink: disconnected');
  }

  async speak(text: string): Promise<void> {
    logger.info({ speech: text }, '[SIM SPEECH OUTPUT]');
    process.stdout.write(`\n🔊 SAIN: "${text}"\n`);
  }

  async listenOnce(_timeoutMs: number): Promise<string | null> {
    return null;
  }
}
