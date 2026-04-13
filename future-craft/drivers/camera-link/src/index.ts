import pino from 'pino';
import type { CameraLink } from '@future-craft/hardware-abstraction';

const logger = pino({ name: 'camera-link' });

export class SimCameraLink implements CameraLink {
  async connect(): Promise<void> {
    logger.info('SimCameraLink: connected (sim mode)');
  }

  async disconnect(): Promise<void> {
    logger.info('SimCameraLink: disconnected');
  }

  async captureFrame(): Promise<Buffer> {
    return Buffer.alloc(1024, 0);
  }

  getStreamUrl(): string {
    return 'sim://camera/stream/0';
  }
}
