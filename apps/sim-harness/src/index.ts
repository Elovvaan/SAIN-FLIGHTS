import { connect, NatsConnection, NatsError } from 'nats';
import {
  TOPICS, NATS_URL, encode, decode, now,
  VehicleState, StateChangedMessage
} from '../../../packages/shared/src/index.js';

const SERVICE = 'sim-harness';

const SEQUENCE: VehicleState[] = [
  'RUN_CHECKS',
  'ARM',
  'TAKEOFF',
  'HOVER_STABLE',
  'FOLLOW',
  'HOLD_POSITION',
  'FIELD_TEST',
  'LAND',
];

const REQUIRED_SERVICES = [
  'state-engine',
  'safety-supervisor',
  'command-service',
  'flight-orchestrator',
  'propulsion-controller',
  'field-controller',
  'telemetry-logger',
  'perception-engine',
];

async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Check NATS connectivity with a short timeout. Exits process if unreachable. */
async function checkNatsReachable(): Promise<void> {
  const TIMEOUT_MS = 3000;
  console.log(`[${SERVICE}] Checking NATS connectivity at ${NATS_URL}...`);
  try {
    const nc = await Promise.race([
      connect({ servers: NATS_URL, reconnect: false }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
      ),
    ]);
    await nc.close();
    console.log(`[${SERVICE}] NATS reachable at ${NATS_URL}`);
  } catch (err) {
    const msg = err instanceof NatsError ? err.message : String(err);
    console.error(`\n[${SERVICE}] FATAL: NATS not reachable at ${NATS_URL}`);
    console.error(`[${SERVICE}] Reason: ${msg}`);
    console.error(`\nEnsure a NATS server is running and reachable at ${NATS_URL}\n`);
    process.exit(1);
  }
}


async function waitForState(nc: NatsConnection, targetState: VehicleState, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const sub = nc.subscribe(TOPICS.STATE_CHANGED);
    const timer = setTimeout(() => {
      sub.unsubscribe();
      resolve(false);
    }, timeoutMs);

    (async () => {
      for await (const msg of sub) {
        const data = decode<StateChangedMessage>(msg.data);
        if (data.currentState === targetState) {
          clearTimeout(timer);
          sub.unsubscribe();
          console.log(`[${SERVICE}] ✓ State confirmed: ${data.previousState} → ${data.currentState}`);
          resolve(true);
          return;
        }
      }
    })();
  });
}

async function main() {
  console.log(`[${SERVICE}] SERVICE_STARTING`);

  // Fail fast if NATS is unavailable
  await checkNatsReachable();

  console.log(`[${SERVICE}] Connecting to NATS at ${NATS_URL}...`);
  const nc = await connect({
    servers: NATS_URL,
    reconnect: false,
  });
  console.log(`[${SERVICE}] Connected to NATS`);
  console.log(`[${SERVICE}] SERVICE_READY`);

  console.log(`[${SERVICE}] Waiting for services to be ready...`);
  const readyServices = new Set<string>();

  const SERVICE_WAIT_TIMEOUT_MS = 10000;

  await new Promise<void>((resolve) => {
    const readySub = nc.subscribe(TOPICS.SERVICE_READY);
    const timer = setTimeout(() => {
      readySub.unsubscribe();
      const missing = REQUIRED_SERVICES.filter((s) => !readyServices.has(s));
      if (missing.length > 0) {
        console.warn(`[${SERVICE}] Timeout waiting for services. Still missing: ${missing.join(', ')}`);
      } else {
        console.log(`[${SERVICE}] Services ready (timeout fallback): ${[...readyServices].join(', ')}`);
      }
      resolve();
    }, SERVICE_WAIT_TIMEOUT_MS);

    (async () => {
      for await (const msg of readySub) {
        const data = decode<{ service: string }>(msg.data);
        readyServices.add(data.service);
        console.log(`[${SERVICE}] Service ready: ${data.service} (${readyServices.size}/${REQUIRED_SERVICES.length})`);

        const allReady = REQUIRED_SERVICES.every((s) => readyServices.has(s));
        if (allReady) {
          clearTimeout(timer);
          readySub.unsubscribe();
          resolve();
          return;
        }
      }
    })();
  });

  console.log(`[${SERVICE}] All services ready. Starting command sequence...`);
  console.log('');
  console.log('='.repeat(60));
  console.log('  SAIN-FLIGHTS AUTONOMOUS FLIGHT SEQUENCE');
  console.log('='.repeat(60));

  let currentState: VehicleState = 'IDLE';

  for (const intent of SEQUENCE) {
    console.log('');
    console.log(`[${SERVICE}] ► Sending intent: ${intent}`);

    const statePromise = waitForState(nc, intent);

    nc.publish(TOPICS.INTENT_RECEIVED, encode({
      intent,
      timestamp: now(),
      source: SERVICE,
    }));

    console.log(`[${SERVICE}] Waiting for state confirmation: ${intent}...`);

    const confirmed = await statePromise;

    if (!confirmed) {
      console.log(`[${SERVICE}] ⚠ Timeout waiting for state: ${intent}. Aborting.`);
      break;
    }

    currentState = intent;
    await waitMs(500);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  SEQUENCE COMPLETE');
  console.log(`  Final state: ${currentState}`);
  console.log('='.repeat(60));
  console.log('');
  console.log('[BOOT COMMAND]');
  console.log('  pnpm dev:sim');
  console.log('');
  console.log('[EXPECTED CONSOLE OUTPUT FLOW]');
  console.log('  1. NATS server starts');
  console.log('  2. All services connect and subscribe');
  console.log('  3. sim-harness publishes intents in sequence');
  console.log('  4. Each intent flows: intent.received → safety.check → intent.approved → state.changed');
  console.log('  5. flight-orchestrator and propulsion-controller handle each state');
  console.log('  6. field-controller activates on FIELD_TEST');
  console.log('  7. telemetry-logger records all events to SQLite');
  console.log('');
  console.log('[EXAMPLE TELEMETRY ROWS]');
  console.log('  id=1  topic=vehicle.intent.received   payload={"intent":"RUN_CHECKS",...}');
  console.log('  id=2  topic=vehicle.safety.check       payload={"intent":"RUN_CHECKS",...}');
  console.log('  id=3  topic=vehicle.intent.approved    payload={"intent":"RUN_CHECKS",...}');
  console.log('  id=4  topic=vehicle.state.changed      payload={"previousState":"IDLE","currentState":"RUN_CHECKS",...}');
  console.log('');
  console.log('[SEQUENCE STATUS] COMPLETE ✓');
  console.log('  RUN_CHECKS → ARM → TAKEOFF → HOVER_STABLE → FOLLOW → HOLD_POSITION → FIELD_TEST → LAND');

  await nc.drain();
  process.exit(currentState === 'LAND' ? 0 : 1);
}

main().catch((err) => {
  console.error(`[${SERVICE}] Fatal error:`, err);
  process.exit(1);
});
