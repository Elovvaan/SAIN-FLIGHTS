# Sain Flight — future-craft Monorepo

Autonomous flight vehicle control system built with TypeScript, NATS messaging, SQLite telemetry, and Python perception.

## Prerequisites

- Node.js 20+
- pnpm 9+
- NATS Server (`brew install nats-server` or [nats.io](https://nats.io))
- Python 3.11+
- uvicorn (`pip install uvicorn`)

## Install

```bash
pnpm install
```

## Boot Instructions

### 1. Start NATS message broker
```bash
nats-server
```

### 2. Configure environment
```bash
cp .env.example .env
```

### 3. Start core services
```bash
pnpm dev:core
```
Starts: state-engine, command-service, safety-supervisor, flight-orchestrator, propulsion-controller, energy-manager, telemetry-logger, agent-runtime, audio-io

### 4. Run simulation sequence
```bash
pnpm dev:sim
```

### 5. Start perception engine (Python)
```bash
pnpm start:perception
# or
cd services/perception-engine && uvicorn main:app --host 0.0.0.0 --port 8010 --reload
```

### 6. Launch ground console
```bash
pnpm --filter ./apps/ground-console dev
```
Available commands: `RUN_CHECKS` | `ARM` | `TAKEOFF` | `HOVER` | `FOLLOW` | `LAND` | `HOLD_POSITION` | `FIELD_TEST` | `BATTERY_STATUS` | `SYSTEM_STATUS`

### 7. Full vehicle runtime (boot supervisor)
```bash
pnpm start:vehicle
```

## Architecture

```
future-craft/
├── apps/
│   ├── vehicle-runtime     # Boot supervisor spawning all services
│   ├── ground-console      # Operator command terminal
│   └── sim-harness         # Automated simulation sequence
├── services/
│   ├── state-engine        # FSM — vehicle state authority
│   ├── command-service     # Intent normalization & dispatch
│   ├── safety-supervisor   # Highest-priority safety gate
│   ├── flight-orchestrator # Motion planning
│   ├── propulsion-controller # Lift cell & thrust control
│   ├── field-controller    # Field assist zones
│   ├── energy-manager      # Battery & power budgets
│   ├── telemetry-logger    # SQLite event persistence
│   ├── agent-runtime       # AI agent & voice narration
│   ├── audio-io            # TTS/STT interface
│   └── perception-engine   # Python FastAPI + NATS scene publisher
├── packages/
│   ├── config              # Env config with Zod validation
│   ├── schemas             # Shared Zod schemas & TypeScript types
│   ├── message-bus         # NATS publish/subscribe wrapper
│   ├── state-machine       # FSM transition logic
│   ├── hardware-abstraction # Driver interfaces
│   ├── vehicle-model       # Physical vehicle specification
│   ├── energy-model        # Battery budget computation
│   ├── safety-model        # Safety decision logic
│   ├── voice-model         # Speech phrase generation
│   └── mission-model       # Mission objectives & phases
├── drivers/
│   ├── flight-controller-link
│   ├── power-router-link
│   ├── field-driver-link
│   ├── camera-link
│   ├── audio-link
│   └── sensor-link
├── tools/
│   ├── log-replay
│   ├── state-visualizer
│   └── field-test-analyzer
└── firmware/
    ├── pod-controller-fw
    ├── rear-thrust-fw
    └── field-zone-fw
```

## Tech Stack

- **TypeScript** + **tsx** for all Node.js services
- **pnpm workspaces** for monorepo management
- **NATS** for inter-service messaging
- **SQLite** (better-sqlite3) for telemetry persistence
- **Zod** for runtime schema validation
- **Pino** for structured logging
- **Python FastAPI + uvicorn** for perception engine
