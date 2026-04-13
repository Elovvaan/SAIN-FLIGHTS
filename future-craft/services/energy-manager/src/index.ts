import pino from 'pino';
import { config } from '@future-craft/config';
import { connectBus, publish, TOPICS } from '@future-craft/message-bus';
import { SimPowerRouterLink } from '@future-craft/power-router-link';
import { computeBudgets } from '@future-craft/energy-model';
import { EnergyState } from '@future-craft/schemas';

const logger = pino({ name: 'energy-manager', level: config.LOG_LEVEL });
const powerRouter = new SimPowerRouterLink();

async function pollEnergy(): Promise<void> {
  const raw = await powerRouter.readEnergyState();
  const budgets = computeBudgets(raw.batteryPct);
  await powerRouter.setPropulsionBudgetW(budgets.propulsionBudgetW);
  await powerRouter.setFieldBudgetW(budgets.fieldBudgetW);

  const state: EnergyState = {
    vehicleId: config.VEHICLE_ID,
    batteryPct: raw.batteryPct,
    voltageMv: raw.voltageMv,
    currentMa: raw.currentMa,
    estimatedRemainingMs: raw.estimatedRemainingMs,
    propulsionBudgetW: budgets.propulsionBudgetW,
    fieldBudgetW: budgets.fieldBudgetW,
    reserveActive: budgets.reserveActive,
    timestamp: new Date().toISOString(),
  };

  publish(TOPICS.ENERGY_UPDATED, state);
  logger.debug({ batteryPct: state.batteryPct, reserveActive: state.reserveActive }, 'Energy state published');
}

async function main(): Promise<void> {
  await powerRouter.connect();
  await connectBus();
  logger.info('energy-manager started');

  await pollEnergy();
  setInterval(() => {
    pollEnergy().catch((err) => logger.error({ err }, 'Energy poll failed'));
  }, 3000);

  setInterval(() => {
    publish('vehicle.energy-manager.heartbeat', { timestamp: new Date().toISOString() });
  }, 5000);
}

main().catch((err) => {
  logger.error({ err }, 'energy-manager fatal error');
  process.exit(1);
});
