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

## Hardware Mode — Real Flight Controller Binding

`flight-controller-link` ships two implementations that satisfy the same
`FlightControllerLink` interface.  The active implementation is selected at
startup by the `FC_HARDWARE_MODE` environment variable so **no other service
needs to change** — state-engine, safety-supervisor, and telemetry-logger
continue operating identically.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `FC_HARDWARE_MODE` | `sim` | `sim` = simulation adapter; `mavlink` = real hardware |
| `FC_MAVLINK_HOST` | `127.0.0.1` | UDP host of the flight controller |
| `FC_MAVLINK_PORT` | `14550` | UDP port of the flight controller |
| `FC_MAVLINK_TARGET_SYS` | `1` | MAVLink system ID of the flight controller |

### MAVLink command mapping

| `setThrottle` call (avgLift) | MAVLink command sent |
|---|---|
| avgLift ≥ 65 (ASCEND) | `MAV_CMD_NAV_TAKEOFF` (param7 = altitude m) |
| 45 ≤ avgLift < 65 (HOVER/HOLD) | `MAV_CMD_DO_SET_MODE` → LOITER |
| avgLift < 45 (DESCEND) | `MAV_CMD_NAV_LAND` |
| `arm()` | `MAV_CMD_DO_SET_MODE` GUIDED + `MAV_CMD_COMPONENT_ARM_DISARM` param1=1 |
| `disarm()` | `MAV_CMD_COMPONENT_ARM_DISARM` param1=0 |

### Setup instructions for real hardware mode

#### Option A — ArduPilot SITL (software-in-the-loop test)

```bash
# 1. Install ArduPilot SITL
pip install dronekit-sitl

# 2. Start ArduCopter SITL (binds UDP on 127.0.0.1:14550 by default)
dronekit-sitl copter

# 3. (Optional) attach MAVProxy for monitoring in a second terminal
mavproxy.py --master=udp:127.0.0.1:14550 --console

# 4. Enable hardware mode — add to your .env
FC_HARDWARE_MODE=mavlink
FC_MAVLINK_HOST=127.0.0.1
FC_MAVLINK_PORT=14550
FC_MAVLINK_TARGET_SYS=1

# 5. Start core services as normal
pnpm dev:core
```

#### Option B — Real ArduPilot/PX4 hardware over USB serial bridge

```bash
# 1. Attach flight controller via USB; identify the serial port
ls /dev/ttyUSB* /dev/ttyACM*   # Linux
ls /dev/cu.usbmodem*            # macOS

# 2. Start MAVProxy as a UDP bridge
mavproxy.py --master=/dev/ttyUSB0 --baudrate 57600 \
            --out=udp:127.0.0.1:14550 --console

# 3. Enable hardware mode in .env
FC_HARDWARE_MODE=mavlink
FC_MAVLINK_HOST=127.0.0.1
FC_MAVLINK_PORT=14550
FC_MAVLINK_TARGET_SYS=1

# 4. Start core services
pnpm dev:core
```

### Verification steps

After starting in hardware mode run the simulation sequence and verify:

```bash
# Terminal 1 — run the full simulation command sequence
pnpm dev:sim

# Terminal 2 — watch propulsion-controller logs for MAVLink commands
# Expected sequence:
#   MavlinkFlightControllerLink: connected — heartbeat running
#   MavlinkFlightControllerLink: ARM sent (GUIDED mode + arm command)
#   MavlinkFlightControllerLink: TAKEOFF command sent
#   MavlinkFlightControllerLink: LOITER (hold) mode sent
#   MavlinkFlightControllerLink: LAND command sent
#   MavlinkFlightControllerLink: DISARM sent
```

To revert to simulation mode at any time set `FC_HARDWARE_MODE=sim` (or remove
the variable entirely — it defaults to `sim`).

---

## Tech Stack

- **TypeScript** + **tsx** for all Node.js services
- **pnpm workspaces** for monorepo management
- **NATS** for inter-service messaging
- **SQLite** (better-sqlite3) for telemetry persistence
- **Zod** for runtime schema validation
- **Pino** for structured logging
- **Python FastAPI + uvicorn** for perception engine
