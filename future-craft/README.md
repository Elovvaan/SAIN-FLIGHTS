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

## Version-1 Tangential-Field Control Mode

`propulsion-controller` ships two parallel control paths that coexist behind
the same NATS `vehicle.motion.plan` subscription:

| Mode | Control model | Activated by |
|---|---|---|
| **avgLift** (default) | Flat equal-throttle; maps motion-plan type to a fixed `setThrottle()` call | `FIELD_MODE_ENABLED=false` (default) |
| **field mode** (V1) | 4-node tangential-field solver; continuously advances a phase angle and drives per-motor outputs via `setActuatorOutputs()` | `FIELD_MODE_ENABLED=true` |

### Control model overview

The Version-1 model replaces the flat `avgLift` average with a **FieldState**
that carries:

```
intensity      — master lift / energy level, 0–100
phase          — current phase angle (radians)
phaseVelocity  — phase advance rate (radians/second)
spin           — rotation direction: 1 = CW, −1 = CCW
bias           — contraction/expansion bias, −1 to +1
enabled        — field modulation on/off
```

Motor outputs are computed by `field-solver.ts` as:

```
A = base + amplitude × sin(phase + 0°)
B = base + amplitude × sin(phase + 90°)
C = base + amplitude × sin(phase + 180°)
D = base + amplitude × sin(phase + 270°)
```

where `base = intensity / 100` (adjusted by `bias`) and `amplitude = base × 0.3`.
All outputs are clamped to `[0, 1]`.  The four evenly-spaced phase offsets
guarantee that the average across all motors always equals `base` — no net
torque is introduced by the phase rotation alone.

The phase advances at 20 Hz via an internal `setInterval` loop, so the field
rotates continuously without requiring new motion-plan messages.

### New environment variables

| Variable | Default | Description |
|---|---|---|
| `FIELD_MODE_ENABLED` | `false` | `true` activates Version-1 field mode |
| `FIELD_PHASE_VELOCITY` | `3.14159…` (π) | Phase advance rate in rad/s (≈ 1 rotation / 2 s) |
| `FIELD_SPIN` | `1` | `1` = clockwise; any negative value = counter-clockwise |
| `FIELD_OUTPUT_SCALE` | `1` | Scale factor `[0, 1]` applied to solver outputs before sending to FC |
| `FIELD_STABILIZATION_ENABLED` | `false` | `true` activates IMU-driven field stabilization |
| `FIELD_KP_PITCH` | `0.8` | Phase-correction gain for pitch error (rad/s per rad) |
| `FIELD_KP_ROLL` | `0.8` | Phase-correction gain for roll error (rad/s per rad) |
| `FIELD_KB_PITCH` | `0.2` | Bias-correction gain for pitch error (bias-units/s per rad) |
| `FIELD_KB_ROLL` | `0.2` | Bias-correction gain for roll error (bias-units/s per rad) |
| `FIELD_KI_ALT` | `0.1` | Intensity-correction gain for altitude error (%/s per metre) |

### Field mode in simulation vs hardware

| Adapter | `setActuatorOutputs()` behaviour |
|---|---|
| `SimFlightControllerLink` | Logs outputs at `debug` level — no hardware required |
| `MavlinkFlightControllerLink` | Sends `SET_ACTUATOR_CONTROL_TARGET` (msg_id=140) via UDP to the FC |

**MAVLink hardware note:** `SET_ACTUATOR_CONTROL_TARGET` (group 0) in standard
ArduPilot GUIDED mode routes through the FC mixer matrix before reaching the
ESCs.  For true 1-to-1 per-motor passthrough, the vehicle must be configured
with `SERVO_PASS_THRU` or a custom mixer that maps channels 0–3 directly to
motors A–D.  The arm/disarm and takeoff/land paths are **not** affected by
field mode.

### Enabling field mode for SITL testing

```bash
# .env (or export in shell)
FIELD_MODE_ENABLED=true
FIELD_PHASE_VELOCITY=3.14159265358979   # 1 rotation / 2 s
FIELD_SPIN=1                            # clockwise
FIELD_OUTPUT_SCALE=0.8                  # limit to 80 % power during testing
FC_HARDWARE_MODE=sim                    # or mavlink for SITL

# Field stabilization (optional — requires FIELD_MODE_ENABLED=true)
FIELD_STABILIZATION_ENABLED=true
FIELD_KP_PITCH=0.8
FIELD_KP_ROLL=0.8
FIELD_KB_PITCH=0.2
FIELD_KB_ROLL=0.2
FIELD_KI_ALT=0.1
```

### Field stabilization

When `FIELD_STABILIZATION_ENABLED=true`, the `applyFieldStabilization()` function
runs every field-loop tick **before** the field solver.  It reads the IMU via the
sensor link and injects corrections into the FieldState:

| Channel | Mechanism | Purpose |
|---|---|---|
| `phase` | `phase += (pitch_err × Kp_pitch + roll_err × Kp_roll) × dt × α` | Primary attitude correction — shifts the field force vector |
| `bias` | `bias += (roll_err × Kb_roll + pitch_err × Kb_pitch) × dt × α` | Secondary drift correction — adjusts collective baseline |
| `intensity` | `intensity += alt_err × Ki_alt × dt × α` | Altitude hold — only active when a target altitude is set |

`α = 0.3` is the per-tick smoothing factor that prevents correction spikes.
All outputs are clamped/wrapped: `phase ∈ [0, 2π)`, `bias ∈ [−1, 1]`,
`intensity ∈ [10, 100]`.

**Safety rules:**
- If IMU data is invalid (`valid = false`) the stabilizer returns the input
  FieldState unchanged — the field loop continues without correction.
- In hardware (MAVLink) mode no sensor link is wired in yet; `valid` stays
  `false` and stabilization is transparently bypassed until hardware IMU
  integration is added.

### Field-solver tests

```bash
cd future-craft
pnpm --filter @future-craft/propulsion-controller test
```

---

## Real hardware execution for field-mode vehicles

This section documents the complete execution path from software motor outputs
`[A, B, C, D]` to physical ESC channels, the required FC configuration, how to
run a bench test, and the exact arming conditions.

### Hardware-routing design

The **Actuator Router** (`actuator-router.ts`) sits between the field solver and
the flight controller link.  It is the single source of truth for:

1. **Channel remapping** — maps each logical motor (`A`/`B`/`C`/`D`) to a
   physical ESC/PWM channel index.
2. **Motor inversion** — optionally inverts (`v → 1 − v`) motors that require a
   reversed throttle signal.
3. **Output scaling** — applies `FIELD_OUTPUT_SCALE` before transmission.
4. **Clamping** — guarantees all values are in `[0, 1]` (NaN-safe).
5. **Machine-readable routing log** — every resolved routing operation is logged
   as a structured JSON record with `outputMode`, `solved`, `channelMap`,
   `inversionMap`, and `physical` fields.

### Output modes: `mixer` vs `passthrough`

| `FC_OUTPUT_MODE` | What the FC does | Valid for field execution? |
|---|---|---|
| `mixer` | Routes `SET_ACTUATOR_CONTROL_TARGET` through the FC's own mixer matrix before driving ESCs. Compatible with standard GUIDED mode. | ⛔ **NOT valid** — FC may reorder or blend motor outputs |
| `passthrough` | Software outputs are mapped 1-to-1 to the configured physical channels before transmission. Requires explicit FC configuration (see below). | ✅ **VALID** when FC is correctly configured |

### Required FC configuration

#### ArduPilot
To bypass the default quad mixer, one of the following must be true:
- `SERVO_PASS_THRU` is set to include all motor output channels, **or**
- A **custom motor matrix** is loaded that maps `group-0 controls[0..3]` directly
  to motor outputs `[A, B, C, D]` in the same order as the software channel map.

Without this, `SET_ACTUATOR_CONTROL_TARGET` in GUIDED mode will still pass through
the ArduCopter mixer — **which constitutes FC remixing and is NOT valid for
field-vehicle flight**.

#### PX4
Actuator direct mode must be active so that the `SET_ACTUATOR_CONTROL_TARGET`
payload reaches the ESCs without further mixing.

> **⚠ This software cannot auto-detect FC mixer state.**  The startup banner will
> emit a `WARN` advisory when `FC_HARDWARE_MODE=mavlink` reminding the operator
> to verify manually.

### Motor mapping procedure

1. Set `FC_OUTPUT_MODE=passthrough` and `FIELD_MODE_ENABLED=true` in `.env`.
2. Configure `MOTOR_*_CHANNEL` to match the physical airframe wiring:
   ```
   MOTOR_A_CHANNEL=0  # front-right → ESC channel 0
   MOTOR_B_CHANNEL=1  # rear-right  → ESC channel 1
   MOTOR_C_CHANNEL=2  # rear-left   → ESC channel 2
   MOTOR_D_CHANNEL=3  # front-left  → ESC channel 3
   ```
3. Set inversion flags for any ESC that expects a reversed signal:
   ```
   MOTOR_A_INVERTED=false
   MOTOR_B_INVERTED=false
   MOTOR_C_INVERTED=false
   MOTOR_D_INVERTED=false
   ```
4. Start the propulsion-controller and inspect the startup verification banner.
   The banner will show `FC config status: VALID — passthrough execution enabled`
   when all hard conditions are satisfied.

### New environment variables (execution layer)

| Variable | Default | Description |
|---|---|---|
| `FC_OUTPUT_MODE` | `mixer` | `mixer` = FC mixer path; `passthrough` = direct channel routing |
| `MOTOR_A_CHANNEL` | `0` | Physical ESC channel index for logical motor A (front-right) |
| `MOTOR_B_CHANNEL` | `1` | Physical ESC channel index for logical motor B (rear-right) |
| `MOTOR_C_CHANNEL` | `2` | Physical ESC channel index for logical motor C (rear-left) |
| `MOTOR_D_CHANNEL` | `3` | Physical ESC channel index for logical motor D (front-left) |
| `MOTOR_A_INVERTED` | `false` | `true` to invert motor A signal (v → 1 − v) |
| `MOTOR_B_INVERTED` | `false` | `true` to invert motor B signal |
| `MOTOR_C_INVERTED` | `false` | `true` to invert motor C signal |
| `MOTOR_D_INVERTED` | `false` | `true` to invert motor D signal |

### Bench-test procedure

Use `generateBenchSequence()` (`bench-test.ts`) to verify motor routing without
free flight.  The sequence runs motors **one at a time** in this exact order:

| Step | Logical output | Purpose |
|---|---|---|
| `A_ONLY` | `[0.15, 0, 0, 0]` | Confirm front-right motor wiring |
| `B_ONLY` | `[0, 0.15, 0, 0]` | Confirm rear-right motor wiring |
| `C_ONLY` | `[0, 0, 0.15, 0]` | Confirm rear-left motor wiring |
| `D_ONLY` | `[0, 0, 0, 0.15]` | Confirm front-left motor wiring |
| `A_AND_C` | `[0.15, 0, 0.15, 0]` | Confirm front-right/rear-left diagonal pair |
| `B_AND_D` | `[0, 0.15, 0, 0.15]` | Confirm rear-right/front-left diagonal pair |
| `PHASE_SWEEP_0–7` | low-amplitude rotating | Confirm differential routing at 45° steps |

Each step logs both the **logical** `[A, B, C, D]` vector and the **resolved
physical** `[ch0, ch1, ch2, ch3]` array so the operator can directly confirm
which ESC channel fires for each motor command.

### Startup verification banner

On every start, the propulsion-controller emits a structured log tagged with
`type: 'startup_verification'` containing:

- field mode enabled / disabled
- stabilization enabled / disabled
- translation enabled / disabled
- output mode (`MIXER` or `PASSTHROUGH`)
- output scale
- motor channel map (`A→ch0  B→ch1  C→ch2  D→ch3`)
- motor inversion flags
- FC config status: `VALID` or `INVALID — arming blocked`
- Any hard errors or advisory warnings

### Arming failsafe

When `FC_OUTPUT_MODE=passthrough`, arming is **blocked** if any of the following
hard conditions are not satisfied:

1. `FIELD_MODE_ENABLED=true` — passthrough without field mode has no per-motor
   outputs to route.
2. **Channel map is a valid permutation of `[0, 1, 2, 3]`** — no duplicate
   channel assignments; each channel must be an integer in `[0, 3]`.
3. `FIELD_OUTPUT_SCALE > 0` and finite — a degenerate scale prevents all motor
   output.

When arming is blocked, the log will contain a `passthrough_arm_blocked` entry
listing exactly which conditions failed.

### Conditions required before tethered lift

Before a tethered lift with `FC_OUTPUT_MODE=passthrough`:

- [ ] Startup banner shows `FC config status: VALID`
- [ ] Bench test completed with `FC_HARDWARE_MODE=mavlink` — each motor fires
      on the expected physical channel
- [ ] FC mixer bypass is manually verified (ArduPilot `SERVO_PASS_THRU` / custom
      motor matrix, or PX4 actuator direct mode)
- [ ] No `passthrough_arm_blocked` errors in startup log
- [ ] `FIELD_MODE_ENABLED=true`
- [ ] `FIELD_OUTPUT_SCALE` set to a safe bench value (e.g. `0.3`) for first lift

---

## Tech Stack

- **TypeScript** + **tsx** for all Node.js services
- **pnpm workspaces** for monorepo management
- **NATS** for inter-service messaging
- **SQLite** (better-sqlite3) for telemetry persistence
- **Zod** for runtime schema validation
- **Pino** for structured logging
- **Python FastAPI + uvicorn** for perception engine
