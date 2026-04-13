import { spawn, ChildProcess } from 'child_process';
import pino from 'pino';
import path from 'path';

const logger = pino({ name: 'vehicle-runtime' });

interface ServiceDef {
  name: string;
  cwd: string;
  cmd: string;
  args: string[];
}

const SERVICES: ServiceDef[] = [
  { name: 'state-engine', cwd: '../../services/state-engine', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'safety-supervisor', cwd: '../../services/safety-supervisor', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'energy-manager', cwd: '../../services/energy-manager', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'flight-orchestrator', cwd: '../../services/flight-orchestrator', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'propulsion-controller', cwd: '../../services/propulsion-controller', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'field-controller', cwd: '../../services/field-controller', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'agent-runtime', cwd: '../../services/agent-runtime', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'audio-io', cwd: '../../services/audio-io', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'telemetry-logger', cwd: '../../services/telemetry-logger', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
  { name: 'command-service', cwd: '../../services/command-service', cmd: 'npx', args: ['tsx', 'src/index.ts'] },
];

const procs: ChildProcess[] = [];

function startService(def: ServiceDef): ChildProcess {
  const cwd = path.resolve(__dirname, def.cwd);
  const proc = spawn(def.cmd, def.args, { cwd, stdio: 'inherit', env: process.env });
  proc.on('exit', (code) => {
    logger.warn({ service: def.name, code }, 'Service exited');
  });
  logger.info({ service: def.name }, 'Service started');
  return proc;
}

function shutdown(): void {
  logger.info('Shutting down all services...');
  for (const p of procs) {
    p.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

logger.info('vehicle-runtime boot supervisor starting');
for (const svc of SERVICES) {
  procs.push(startService(svc));
}
logger.info('All services started');
