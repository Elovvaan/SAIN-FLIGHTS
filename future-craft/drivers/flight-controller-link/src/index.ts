import pino from 'pino';
import type { FlightControllerLink } from '@future-craft/hardware-abstraction';

const logger = pino({ name: 'flight-controller-link' });

export class SimFlightControllerLink implements FlightControllerLink {
  private armed = false;

  async connect(): Promise<void> {
    logger.info('SimFlightControllerLink: connected (sim mode)');
  }

  async disconnect(): Promise<void> {
    logger.info('SimFlightControllerLink: disconnected');
  }

  async arm(): Promise<void> {
    this.armed = true;
    logger.info('SimFlightControllerLink: motors armed');
  }

  async disarm(): Promise<void> {
    this.armed = false;
    logger.info('SimFlightControllerLink: motors disarmed');
  }

  async setThrottle(liftCells: [number, number, number, number], thrustPct: number): Promise<void> {
    if (!this.armed) {
      logger.warn('setThrottle called while disarmed — command ignored');
      return;
    }
    logger.debug({ liftCells, thrustPct }, 'SimFlightControllerLink: setThrottle');
  }

  async getHealth(): Promise<{ healthy: boolean; cells: boolean[] }> {
    return { healthy: true, cells: [true, true, true, true] };
  }
}
