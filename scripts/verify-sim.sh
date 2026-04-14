#!/usr/bin/env bash
# verify-sim.sh — Local end-to-end verification for SAIN-FLIGHTS
# Usage: pnpm verify:sim
# Exit 0 = PASS, nonzero = FAIL

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Force localhost-only NATS URL
export NATS_URL="nats://127.0.0.1:4222"

PASS=0
FAIL=1
RESULTS=()

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         SAIN-FLIGHTS Local Verification Mode             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: NATS connectivity check
# ─────────────────────────────────────────────────────────────────────────────
echo "[verify] Step 1: Checking NATS on 127.0.0.1:4222..."
if ! nc -z -w 3 127.0.0.1 4222 2>/dev/null; then
  echo ""
  echo "FATAL: NATS not reachable on 127.0.0.1:4222"
  echo ""
  echo "Start NATS with:"
  echo "  nats-server -a 127.0.0.1 -p 4222"
  echo ""
  echo "Then run verification:"
  echo "  pnpm verify:sim"
  echo ""
  echo "To inspect telemetry after a run:"
  echo "  sqlite3 data/telemetry.db 'SELECT id, topic, recorded_at FROM telemetry ORDER BY id'"
  echo ""
  exit 1
fi
echo "[verify] ✓ NATS reachable"

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Start all services in background
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "[verify] Step 2: Starting all services..."

# Remove stale telemetry DB so assertions are clean
rm -f data/telemetry.db

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

echo "[verify] Services PID: $SERVICES_PID — waiting 3s for startup..."
sleep 3

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Run sim-harness and capture exit code
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "[verify] Step 3: Running sim-harness (full flight sequence)..."

HARNESS_LOG=$(mktemp /tmp/harness-verify-XXXXXX.log)
npx tsx apps/sim-harness/src/index.ts 2>&1 | tee "$HARNESS_LOG"
HARNESS_EXIT=${PIPESTATUS[0]}

echo ""
echo "[verify] Shutting down services..."
kill $SERVICES_PID 2>/dev/null || true
sleep 1

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: End-of-run assertions
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
echo "[verify] Step 4: Running end-of-run assertions..."
echo "────────────────────────────────────────────────────────────"

OVERALL_PASS=true

# Assertion 1: sim-harness exited 0 (final state = LAND)
echo ""
echo "[assert] 1. Final state == LAND (harness exit code)"
if [ "$HARNESS_EXIT" -eq 0 ]; then
  echo "         ✓ PASS — harness exited 0 (LAND reached)"
  RESULTS+=("PASS: final state is LAND")
else
  echo "         ✗ FAIL — harness exited $HARNESS_EXIT (LAND not reached)"
  RESULTS+=("FAIL: final state is NOT LAND (exit=$HARNESS_EXIT)")
  OVERALL_PASS=false
fi

# Assertion 2: telemetry DB exists
echo ""
echo "[assert] 2. Telemetry DB exists"
if [ -f "data/telemetry.db" ]; then
  echo "         ✓ PASS — data/telemetry.db present"
  RESULTS+=("PASS: telemetry DB exists")
else
  echo "         ✗ FAIL — data/telemetry.db missing"
  RESULTS+=("FAIL: telemetry DB missing")
  OVERALL_PASS=false
fi

# Assertion 3: all key intents recorded in telemetry
KEY_INTENTS=("RUN_CHECKS" "ARM" "TAKEOFF" "HOVER_STABLE" "FOLLOW" "HOLD_POSITION" "FIELD_TEST" "LAND")
echo ""
echo "[assert] 3. All key intents present in telemetry"
INTENTS_PASS=true
if [ -f "data/telemetry.db" ]; then
  for intent in "${KEY_INTENTS[@]}"; do
    count=$(sqlite3 data/telemetry.db "SELECT COUNT(*) FROM telemetry WHERE topic='vehicle.intent.received' AND payload LIKE '%\"intent\":\"${intent}\"%'" 2>/dev/null || echo 0)
    if [ "$count" -gt 0 ]; then
      echo "         ✓ intent ${intent} found (${count} row(s))"
    else
      echo "         ✗ intent ${intent} MISSING"
      INTENTS_PASS=false
      OVERALL_PASS=false
    fi
  done
else
  echo "         ✗ SKIP — telemetry DB missing"
  INTENTS_PASS=false
  OVERALL_PASS=false
fi
if $INTENTS_PASS; then
  RESULTS+=("PASS: all key intents present in telemetry")
else
  RESULTS+=("FAIL: some key intents missing from telemetry")
fi

# Assertion 4: FIELD_TEST event present in telemetry
echo ""
echo "[assert] 4. Field test event present in telemetry"
if [ -f "data/telemetry.db" ]; then
  ft_count=$(sqlite3 data/telemetry.db "SELECT COUNT(*) FROM telemetry WHERE topic='vehicle.field.health' AND payload LIKE '%zonesActive%'" 2>/dev/null || echo 0)
  if [ "$ft_count" -gt 0 ]; then
    echo "         ✓ PASS — vehicle.field.health found ($ft_count row(s))"
    RESULTS+=("PASS: field test event present")
  else
    echo "         ✗ FAIL — vehicle.field.health not found"
    RESULTS+=("FAIL: field test event missing")
    OVERALL_PASS=false
  fi
else
  echo "         ✗ SKIP — telemetry DB missing"
  RESULTS+=("FAIL: field test event check skipped (no DB)")
  OVERALL_PASS=false
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Print summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                  VERIFICATION SUMMARY                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
for result in "${RESULTS[@]}"; do
  echo "  $result"
done
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  LOCAL BOOT COMMANDS:"
echo "    Start NATS:        nats-server -a 127.0.0.1 -p 4222"
echo "    Run verification:  pnpm verify:sim"
echo "    Inspect telemetry: sqlite3 data/telemetry.db 'SELECT id, topic, recorded_at FROM telemetry ORDER BY id'"
echo "────────────────────────────────────────────────────────────"
echo ""

if $OVERALL_PASS; then
  echo "  ✓ RESULT: PASS — all assertions satisfied"
  echo ""
  # Clean up temp log
  rm -f "$HARNESS_LOG"
  exit 0
else
  echo "  ✗ RESULT: FAIL — one or more assertions failed"
  echo ""
  rm -f "$HARNESS_LOG"
  exit 1
fi
