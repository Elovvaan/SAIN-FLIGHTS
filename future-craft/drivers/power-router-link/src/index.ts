import pino from 'pino';
import type { PowerRouterLink } from '@future-craft/hardware-abstraction';

const logger = pino({ name: 'power-router-link' });

export class SimPowerRouterLink implements PowerRouterLink {
  private batteryPct = 85;

  async connect(): Promise<void> {
    logger.info('SimPowerRouterLink: connected (sim mode)');
  }

  async disconnect(): Promise<void> {
    logger.info('SimPowerRouterLink: disconnected');
  }

  async readEnergyState() {
    this.batteryPct = Math.max(0, this.batteryPct - 0.1);
    return {
      batteryPct: this.batteryPct,
      voltageMv: Math.round(this.batteryPct * 44),
      currentMa: 18000,
      estimatedRemainingMs: Math.round((this.batteryPct / 100) * 25 * 60 * 1000),
    };
  }

  async setPropulsionBudgetW(watts: number): Promise<void> {
    logger.debug({ watts }, 'SimPowerRouterLink: propulsion budget set');
  }

  async setFieldBudgetW(watts: number): Promise<void> {
    logger.debug({ watts }, 'SimPowerRouterLink: field budget set');
  }
}
