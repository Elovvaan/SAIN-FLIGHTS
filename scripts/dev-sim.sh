#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v nats-server &> /dev/null; then
  echo ""
  echo "ERROR: nats-server not found."
  echo "Install from: https://nats.io/download/"
  echo "  macOS:  brew install nats-server"
  echo "  Linux:  https://github.com/nats-io/nats-server/releases"
  echo ""
  exit 1
fi

echo ""
echo "================================================"
echo "  SAIN-FLIGHTS Simulation Startup"
echo "================================================"

pkill -f "nats-server" 2>/dev/null || true
sleep 0.5

echo "[boot] Starting NATS server..."
nats-server &
NATS_PID=$!
sleep 1

echo "[boot] Starting all services..."
npx concurrently \
  --kill-others \
  --kill-others-on-fail \
  -n "telemetry,state,safety,command,flight,propulsion,field,perception" \
  -c "white,blue,yellow,cyan,green,magenta,red,gray" \
  "npx tsx apps/telemetry-logger/src/index.ts" \
  "npx tsx apps/state-engine/src/index.ts" \
  "npx tsx apps/safety-supervisor/src/index.ts" \
  "npx tsx apps/command-service/src/index.ts" \
  "npx tsx apps/flight-orchestrator/src/index.ts" \
  "npx tsx apps/propulsion-controller/src/index.ts" \
  "npx tsx apps/field-controller/src/index.ts" \
  "npx tsx apps/perception-engine/src/index.ts" &
SERVICES_PID=$!

echo "[boot] Waiting for services to initialize (3s)..."
sleep 3

echo "[boot] Running sim-harness..."
npx tsx apps/sim-harness/src/index.ts
HARNESS_EXIT=$?

echo "[boot] Sim-harness complete (exit=$HARNESS_EXIT). Shutting down services..."
kill $SERVICES_PID 2>/dev/null || true
kill $NATS_PID 2>/dev/null || true

exit $HARNESS_EXIT
