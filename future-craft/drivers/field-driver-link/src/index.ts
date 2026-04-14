import pino from 'pino';
import type { FieldDriverLink } from '@future-craft/hardware-abstraction';

const logger = pino({ name: 'field-driver-link' });

export class SimFieldDriverLink implements FieldDriverLink {
  async connect(): Promise<void> {
    logger.info('SimFieldDriverLink: connected (sim mode)');
  }

  async disconnect(): Promise<void> {
    logger.info('SimFieldDriverLink: disconnected');
  }

  async activateZone(zoneId: string, intensityPct: number, durationMs?: number): Promise<void> {
    logger.info({ zoneId, intensityPct, durationMs }, 'SimFieldDriverLink: zone activated');
  }

  async deactivateZone(zoneId: string): Promise<void> {
    logger.info({ zoneId }, 'SimFieldDriverLink: zone deactivated');
  }

  async getZoneHealth(zoneId: string): Promise<{ healthy: boolean }> {
    return { healthy: true };
  }
}
