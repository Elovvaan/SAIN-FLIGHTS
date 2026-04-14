import pino from 'pino';
import type { FlightControllerLink } from '@future-craft/hardware-abstraction';
import { MavlinkFlightControllerLink } from './mavlink-link.js';

export { MavlinkFlightControllerLink } from './mavlink-link.js';

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

  async setActuatorOutputs(outputs: [number, number, number, number]): Promise<void> {
    if (!this.armed) {
      logger.warn('setActuatorOutputs called while disarmed — command ignored');
      return;
    }
    logger.debug({ outputs }, 'SimFlightControllerLink: setActuatorOutputs');
  }

  async getHealth(): Promise<{ healthy: boolean; cells: boolean[] }> {
    return { healthy: true, cells: [true, true, true, true] };
  }
}

/**
 * Factory that returns the appropriate FlightControllerLink implementation.
 *
 * @param mode          'sim' (default) or 'mavlink'
 * @param mavlinkHost   UDP host of the flight controller (mavlink mode only)
 * @param mavlinkPort   UDP port of the flight controller (mavlink mode only)
 * @param targetSystem  MAVLink system ID of the FC (mavlink mode only)
 */
export function createFlightControllerLink(
  mode: 'sim' | 'mavlink',
  mavlinkHost = '127.0.0.1',
  mavlinkPort = 14550,
  targetSystem = 1,
): FlightControllerLink {
  if (mode === 'mavlink') {
    return new MavlinkFlightControllerLink(mavlinkHost, mavlinkPort, targetSystem);
  }
  return new SimFlightControllerLink();
}
