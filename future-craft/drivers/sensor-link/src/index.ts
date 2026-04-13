import pino from 'pino';
import type { SensorLink } from '@future-craft/hardware-abstraction';

const logger = pino({ name: 'sensor-link' });

export class SimSensorLink implements SensorLink {
  private altM = 0;

  async connect(): Promise<void> {
    logger.info('SimSensorLink: connected (sim mode)');
  }

  async disconnect(): Promise<void> {
    logger.info('SimSensorLink: disconnected');
  }

  async readAltitudeM(): Promise<number> {
    return this.altM;
  }

  async readImu(): Promise<{ roll: number; pitch: number; yaw: number }> {
    return { roll: 0, pitch: 0, yaw: 0 };
  }

  async readGps(): Promise<{ lat: number; lon: number; altM: number } | null> {
    return { lat: 37.7749, lon: -122.4194, altM: this.altM };
  }

  setAltitude(m: number): void {
    this.altM = m;
  }
}
