#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Force localhost-only NATS URL
export NATS_URL="nats://127.0.0.1:4222"

if ! command -v nats-server &> /dev/null; then
  echo ""
  echo "ERROR: nats-server not found on PATH."
  echo ""
  echo "Install nats-server first, then run:"
  echo "  nats-server -a 127.0.0.1 -p 4222"
  echo ""
  echo "After nats-server is running, execute:"
  echo "  pnpm dev:sim:local"
  echo ""
  exit 1
fi

# ── NATS connectivity check ──────────────────────────────────────────────────
echo "[boot] Checking NATS on 127.0.0.1:4222..."
if ! nc -z -w 2 127.0.0.1 4222 2>/dev/null; then
  echo ""
  echo "ERROR: NATS not reachable on 127.0.0.1:4222"
  echo ""
  echo "Start NATS first:"
  echo "  nats-server -a 127.0.0.1 -p 4222"
  echo ""
  exit 1
fi
echo "[boot] NATS reachable."

echo ""
echo "================================================"
echo "  SAIN-FLIGHTS Local Simulation Startup"
echo "  NATS: ${NATS_URL}"
echo "================================================"

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

exit $HARNESS_EXIT
