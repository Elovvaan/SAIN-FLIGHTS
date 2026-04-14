# SAIN-FLIGHTS Version-1 Hardware Bring-Up Package

**Vehicle:** 4-node tangential-field craft (Version-1 field vehicle)
**Software:** `future-craft` monorepo — propulsion-controller passthrough mode
**Purpose:** Production-grade hardware wiring, ESC mapping, FC configuration, and
bench bring-up procedure so that software outputs `[A, B, C, D]` reach the
intended motors safely and predictably.

> **⚠ IMPORTANT**: This package assumes `FC_OUTPUT_MODE=passthrough`.
> The field-control architecture (`field-solver`, `field-stabilizer`,
> `field-translator`, `actuator-router`) is **not modified** here.
> This document only covers hardware wiring, FC configuration, and bring-up procedure.

---

## 1. Physical Wiring Plan

### 1.1 BOM Assumptions

| Item | Quantity | Notes |
|---|---|---|
| Brushless motors (e.g. T-Motor F60 Pro or equivalent) | 4 | CW and CCW prop-thread variants required — see §2 |
| 4-in-1 ESC or 4× individual ESCs (BLHeli32 or AM32, 30–50 A) | 1 set | Must support standard PWM or DSHOT signal; BLHeli32 preferred for directional verification |
| Flight controller (Pixhawk 4 / Cube Orange / Matek H743) | 1 | Must expose ≥ 4 independent MAIN/AUX PWM outputs |
| Power Distribution Board (PDB) with 5 V BEC | 1 | Rated ≥ 4× peak ESC draw + 5 % margin |
| LiPo battery (4S or 6S, ≥ 4 000 mAh) | 1 | Choose cell count so that `battery_voltage × motor_Kv` stays within the motor's rated max RPM (e.g. a 1 000 Kv motor on 4S ≈ 14.8 V → ~14 800 RPM unloaded); do not exceed the motor manufacturer's rated input voltage |
| Power module (e.g. Holybro PM07 or equivalent) | 1 | Inline between battery and PDB/ESC rail |
| Inline fuse / circuit breaker | 1 | Rating = 1.2 × total ESC peak draw |
| Master power disconnect (XT60/XT90 anti-spark) | 1 | |
| Dedicated kill-switch (RC channel or servo-rail latch relay) | 1 | Cuts ESC signal lines (not power) |
| Signal/ground twisted pair (26 AWG) | 4 runs | FC output → ESC signal+GND |
| Power wiring (12–16 AWG silicone) | 4 runs | PDB → ESC power input |
| FC USB-to-UART adapter or FTDI cable | 1 | Parameter configuration |
| 3DR/SiK telemetry radio (optional) | 1 pair | Monitoring during bench test |
| Vibration-damping FC mount (30×30 or 45×45 mm) | 1 | |
| Tether anchors (rated ≥ 3× craft MTOW) | ≥ 4 | One per arm |

---

### 1.2 Battery → Power → ESC Power Wiring

```
BATTERY (XT60/XT90)
      │
      ├──► [INLINE FUSE / CIRCUIT BREAKER]   (12–14 AWG)
      │
      ├──► [ANTI-SPARK MASTER DISCONNECT]    (XT60 loop-key or relay)
      │
      ▼
POWER MODULE (Holybro PM07 or equivalent)
  ├── Voltage + current sense → FC POWER port (connector cable)
  └── Battery-voltage output → PDB / ESC bus rail
      │
      ├──► ESC-A power input   (Motor A)      (12–14 AWG, keep < 15 cm)
      ├──► ESC-B power input   (Motor B)
      ├──► ESC-C power input   (Motor C)
      └──► ESC-D power input   (Motor D)
```

**Key rules:**
- Use 12 AWG minimum for the main battery-to-PDB run; 14 AWG is acceptable for
  individual ESC legs if the run is < 15 cm.
- Solder all power joints; no crimps on the high-current path.
- Twist each ESC power pair (positive + return ground) to minimise EMI loops.
- Star-point ground: all ESC grounds and FC power ground must converge at a single
  PDB pad — do **not** daisy-chain grounds.

---

### 1.3 FC Power Wiring

```
PDB 5 V BEC output ──► FC POWER port (e.g. Pixhawk: "POWER1")
                        ├── Provides regulated 5.3 V / 3 A to FC
                        └── Current + voltage ADC sent back to autopilot
```

- Backup power (POWER2 / USB) from a separate 5 V BEC for redundancy (optional
  but recommended for real-vehicle operation).

---

### 1.4 ESC Signal/Ground Wiring

```
FC MAIN OUTPUT RAIL
  MAIN1 (PWM signal) ──twisted──► ESC-A signal pin
  MAIN1 GND          ──twisted──► ESC-A ground pin   ← ESSENTIAL: common ground

  MAIN2 (PWM signal) ──twisted──► ESC-B signal pin
  MAIN2 GND          ──twisted──► ESC-B ground pin

  MAIN3 (PWM signal) ──twisted──► ESC-C signal pin
  MAIN3 GND          ──twisted──► ESC-C ground pin

  MAIN4 (PWM signal) ──twisted──► ESC-D signal pin
  MAIN4 GND          ──twisted──► ESC-D ground pin
```

- **Always** connect the ESC signal-ground wire back to the FC servo rail GND
  even when using BEC-powered ESCs — without a common ground, signal levels
  float and motors behave erratically.
- Do **not** connect the ESC BEC +5 V pin to the FC servo rail if the FC has its
  own regulated supply; backfeed can damage the FC's 5 V regulator.
- Route signal wires away from power cables (see §1.7).

---

### 1.5 Telemetry Wiring (Optional but Recommended)

```
FC TELEM1 port ──► SiK Telemetry Radio (TX/RX/GND/+5V)
                      │
                      ▼
               Ground station MAVProxy / QGroundControl
```

- SiK radio provides MAVLink stream for real-time monitoring without USB tether.
- Set MAVProxy `--out` to the laptop port used by the ground console.

---

### 1.6 Kill Switch / Fuse / Master Disconnect Placement

```
BATTERY → [ANTI-SPARK CONNECTOR] → [INLINE FUSE] → POWER MODULE → PDB
                                           ↕
                              [KILL SWITCH on RC AUX channel]
                              (cuts signal to all 4 ESCs via relay
                               or via FC arming channel)
```

- **Anti-spark disconnect**: physically between battery and power module; must be
  the first thing the operator touches when powering down.
- **Inline fuse**: immediately downstream of the disconnect; protects wiring from
  a short in the ESC/PDB.  Rating = 120 % of total peak draw.
- **Kill switch**: controls the FC arming state via an RC AUX channel or GPIO
  relay; does NOT cut battery power but immediately disarms the FC so all ESC
  signals drop to the disarm level.

---

### 1.7 Grounding Approach

- **Single-point star ground** at the PDB centre pad.
- All ESC negative wires meet at that pad.
- FC power GND and FC servo-rail GND both return to that pad.
- Battery negative returns to that pad.
- **Never** create ground loops: each GND path must have exactly one return route
  to the star point.

---

### 1.8 Power vs Signal Wiring Separation

| Rule | Minimum |
|---|---|
| Power leads (≥ 12 AWG) | 2 cm physical separation from any signal wire |
| Signal twisted pairs | Route 90° to power runs where they must cross |
| No bundling | Never zip-tie signal wires to power wires for more than 5 cm |
| Ferrite beads | Optional on signal wires near ESCs if EMI interference is seen |

---

### 1.9 IMU / FC Physical Placement

| Requirement | Guideline |
|---|---|
| Location on frame | Centre of gravity (CG) ± 2 cm in all axes |
| Mounting | 4× rubber-damper standoffs (30 mm or 45 mm hole pattern) |
| Orientation | FC X-axis (arrow) pointing forward (toward motor A / 0°) |
| Isolation | No hard mechanical contact between FC baseplate and frame arms |
| Clearance | ≥ 3 cm from any ESC, motor bell, or power wire |
| IMU calibration | Level-calibrate **before** any wiring is disturbed |

> **Note**: The field-stabilizer reads the IMU for real-time attitude feedback.
> Any FC mounting offset from the CG introduces a constant bias in pitch/roll that
> will be integrated by the stabilizer — keep the FC as close to CG as possible.

---

## 2. ESC / Motor Map

### 2.1 Physical Layout (Top-down view, nose pointing up = Motor A)

```
              ↑ NORTH / FORWARD
              
         [D] 270°         [A] 0°
          (front-left)    (front-right)
               \             /
                \           /
                 [FC — CG]
                /           \
               /             \
         [C] 180°         [B] 90°
          (rear-left)     (rear-right)

         ↓ SOUTH / AFT
```

Prop directions follow the standard X-frame rule where opposite motors cancel
torque.  Prop-nut thread direction is chosen so that the motor's own spin
**tightens** the nut (self-locking):

- **A (0°, front-right)** → CW prop · **CCW-thread (left-hand) nut**
  *(CW motor rotation tightens a left-hand-thread nut)*
- **B (90°, rear-right)** → CCW prop · **CW-thread (right-hand) nut**
  *(CCW motor rotation tightens a right-hand-thread nut)*
- **C (180°, rear-left)** → CW prop · **CCW-thread (left-hand) nut**
- **D (270°, front-left)** → CCW prop · **CW-thread (right-hand) nut**

---

### 2.2 Definitive Motor Mapping Table

| Logical Motor | Physical Position | FC Output Channel | Spin Dir | Env Variable |
|---|---|---|---|---|
| **A** | Front / 0° | MAIN1 | CW | `MOTOR_A_CHANNEL=0` |
| **B** | Right / 90° | MAIN2 | CCW | `MOTOR_B_CHANNEL=1` |
| **C** | Rear / 180° | MAIN3 | CW | `MOTOR_C_CHANNEL=2` |
| **D** | Left / 270° | MAIN4 | CCW | `MOTOR_D_CHANNEL=3` |

> **Default mapping is straight-through (A→ch0, B→ch1, C→ch2, D→ch3)**.
> If your airframe wires ESCs in a different physical order, update the
> `MOTOR_*_CHANNEL` environment variables accordingly and re-run the bench test.

---

### 2.3 Motor Inversion Rules

Motor signal inversion (`v → 1 − v`) is **not required** for standard BLHeli32
ESCs running in the default configuration.  Set `MOTOR_*_INVERTED=true` only if:
- The ESC firmware requires a reversed throttle range (rare — verify with ESC
  configuration tool before enabling), OR
- The motor wiring to the ESC phases is intentionally reversed and motor
  direction is confirmed inverted in the ESC configuration tool.

Default:
```
MOTOR_A_INVERTED=false
MOTOR_B_INVERTED=false
MOTOR_C_INVERTED=false
MOTOR_D_INVERTED=false
```

---

### 2.4 Confirming Logical A Spins Physical A

**Method** (no props required):

1. Set `FC_OUTPUT_MODE=passthrough`, `FIELD_MODE_ENABLED=true`.
2. Run the bench sequence:
   ```
   node -e "
     const { generateBenchSequence } = require('./services/propulsion-controller/src/bench-test');
     const cfg = { outputMode:'passthrough', channelMap:{A:0,B:1,C:2,D:3},
                   inversionMap:{A:false,B:false,C:false,D:false}, outputScale:0.15 };
     const steps = generateBenchSequence(cfg);
     console.log(JSON.stringify(steps.find(s=>s.label==='A_ONLY').routed.physical));
   "
   ```
   Expected output: `[0.15, 0, 0, 0]` — only channel 0 (MAIN1, motor A) is active.
3. Apply the `A_ONLY` vector to the FC while watching which physical motor responds.
   The motor at the **front-right arm (0°)** must be the one that spins.
4. If a different motor spins: update `MOTOR_A_CHANNEL` to match the physical channel
   that is connected to the front-right ESC.

---

## 3. Flight Controller Configuration

### 3.1 ArduPilot Configuration

#### What MUST be disabled

| Parameter | Value | Reason |
|---|---|---|
| `FRAME_TYPE` | Set to **custom** (or ensure `SERVO_PASS_THRU` overrides it) | Prevents ArduCopter's built-in X-frame mixer from re-ordering motor outputs |
| `ATC_RATE_*` D-terms | Consider disabling for initial bench tests | Prevents rate-loop injection during passthrough verification |
| `RC_OVERRIDE` (if present) | `0` | Prevents GCS override of actuator outputs |

#### What MUST remain enabled

| Parameter | Value | Reason |
|---|---|---|
| `SERVO_PASS_THRU` | Bitmask with bits 0–3 set (value = **15** for MAIN1–MAIN4) | **Critical** — routes `SET_ACTUATOR_CONTROL_TARGET` group-0 controls[0..3] directly to MAIN1–4 without FC mixer |
| `ARMING_CHECK` | Keep enabled | Safety — do not disable arming checks |
| `BRD_SAFETY_MASK` | Include MAIN1–4 | Ensures safety switch controls all motor outputs |

> **Alternative to `SERVO_PASS_THRU`**: Load a custom motor matrix that maps
> group-0 controls[0], [1], [2], [3] to MAIN1, MAIN2, MAIN3, MAIN4 at weight 1.0
> with no mixing contribution from attitude controllers.

#### How to avoid legacy quad mixing

ArduPilot's ArduCopter frame assumes a specific motor layout by default.  With
`SERVO_PASS_THRU=15` the `SET_ACTUATOR_CONTROL_TARGET` payload bypasses the
mixing matrix entirely — the group-0 `controls[0..3]` values land verbatim on
MAIN1–MAIN4 after scaling.  **This is the REQUIRED configuration for SAIN-FLIGHTS
passthrough mode.**

Without `SERVO_PASS_THRU`, `SET_ACTUATOR_CONTROL_TARGET` still passes through
the ArduCopter mixer.  In that case the software motor order will be silently
remapped — this is the primary source of "outputs correct in logs but wrong
physically" failures.

#### Bench test FC mode

Set the vehicle to **STABILIZE** or **GUIDED** mode on the bench.  Do not use
ACRO during bench testing — ACRO can apply rate-loop output on top of actuator
commands.

#### ArduPilot verdict

| Condition | Status |
|---|---|
| `SERVO_PASS_THRU=15` set | ✅ **VALID** — true passthrough guaranteed |
| `SERVO_PASS_THRU` not set (default GUIDED) | ⛔ **INVALID** — FC mixer applies; motor order not preserved |

---

### 3.2 PX4 Configuration

#### What MUST be disabled

| Parameter | Value | Reason |
|---|---|---|
| Default airframe mixer | Remove / override | PX4 quad-x mixer will re-order actuator outputs |
| `MC_*` rate controller terms | Disable or zero for bench tests | Prevents attitude injection during passthrough verification |

#### What MUST remain enabled

| Parameter | Value | Reason |
|---|---|---|
| Actuator direct mode (`UAVCAN_SUB_ACT`) or custom mixer with direct pass | Active | Routes `SET_ACTUATOR_CONTROL_TARGET` without attitude mixing |
| Safety arming requirements | Keep enabled | |

#### How to avoid legacy quad mixing in PX4

In PX4, actuator outputs for multirotor use the `MulticopterMixer` by default.
To achieve true passthrough:
1. Use **actuator direct mode**: configure the vehicle's mixer YAML to map
   control group 0 channels 0–3 directly to outputs 0–3 at weight 1.0 with no
   `MC_*` rate mixer contributions.
2. Or use a **pass-through mixer file** (`ROMFS/px4fmu_common/mixers/pass.main.mix`)
   that defines 4 channels as direct passthrough.

#### PX4 verdict

| Condition | Status |
|---|---|
| Direct-pass mixer loaded | ✅ **VALID** — controls reach ESCs without remixing |
| Default quad-x mixer | ⛔ **INVALID** — PX4 will apply its own torque mixing |

> **⚠ This software cannot auto-detect FC mixer state.**
> The startup verification banner emits a `WARN` advisory when
> `FC_HARDWARE_MODE=mavlink` reminding the operator to verify manually.
> The advisory reads:
> ```
> ArduPilot: ensure SERVO_PASS_THRU is set or a custom motor matrix is loaded…
> PX4: ensure actuator direct mode is active…
> This software cannot auto-detect FC mixer configuration — verify manually.
> ```

---

## 4. ESC Calibration + Motor Test Procedure

> **SAFETY**: Remove all propellers before beginning. All steps assume a benched
> vehicle secured to a test stand or held in a bench vice.

### Step 0 — ESC Throttle Calibration (one-time, per ESC)

1. Disconnect all motor signal wires from the FC.
2. Connect each ESC signal wire directly to a calibrated PWM source (servo tester
   or the FC in manual-output mode).
3. Power on with full throttle (2 000 µs PWM) applied first.
4. When the ESC emits a calibration beep, reduce to minimum throttle (1 000 µs).
5. ESC emits the confirmation beep sequence — throttle range is now set.
6. Repeat for all four ESCs.
7. Reconnect ESC signal wires to FC MAIN1–MAIN4.

**Expected result**: All four ESCs have the same throttle end-point.  
**Failure**: ESC emits continuous tone or does not respond → re-power in
calibration mode, or check signal voltage level (must be 3.3 V or 5 V depending
on ESC model).

---

### Step 1 — Single-Motor Isolation (`A_ONLY` through `D_ONLY`)

```
Environment:
  FC_OUTPUT_MODE=passthrough
  FIELD_MODE_ENABLED=true
  FIELD_OUTPUT_SCALE=0.15       ← low-power bench level
  FC_HARDWARE_MODE=mavlink      ← real hardware path
```

Run the bench sequence via the propulsion-controller log output:

```bash
# Start propulsion-controller with bench mode enabled (custom boot flag or REPL)
# Watch the startup banner — confirm: FC config status: VALID
# Trigger A_ONLY step
```

For each step (`A_ONLY`, `B_ONLY`, `C_ONLY`, `D_ONLY`):

| Step | Expected | Failure Meaning |
|---|---|---|
| `A_ONLY` | Only the motor at **front-right (0°)** spins | Wrong channel map — `MOTOR_A_CHANNEL` points to wrong ESC |
| `B_ONLY` | Only the motor at **rear-right (90°)** spins | Wrong channel map — `MOTOR_B_CHANNEL` mismatch |
| `C_ONLY` | Only the motor at **rear-left (180°)** spins | Wrong channel map — `MOTOR_C_CHANNEL` mismatch |
| `D_ONLY` | Only the motor at **front-left (270°)** spins | Wrong channel map — `MOTOR_D_CHANNEL` mismatch |

**Confirm no FC remixing**: The structured log entry for each step should show:
```json
{
  "outputMode": "passthrough",
  "solved": { "A": 0.15, "B": 0, "C": 0, "D": 0 },
  "physical": { "ch0": 0.15, "ch1": 0, "ch2": 0, "ch3": 0 }
}
```
If `physical` values differ from `solved` in unexpected ways (e.g. A value
appears at ch2 instead of ch0 when `MOTOR_A_CHANNEL=0`), the FC is still
applying mixer remapping — recheck `SERVO_PASS_THRU` / PX4 direct mode.

---

### Step 2 — Diagonal Pair Check (`A_AND_C`, `B_AND_D`)

| Step | Expected | Failure Meaning |
|---|---|---|
| `A_AND_C` | Front-right and rear-left motors spin simultaneously | Diagonal wiring error — check which physical arm is CG-diagonal |
| `B_AND_D` | Rear-right and front-left motors spin simultaneously | Same |

Diagonal pairs are critical: opposing arms share the same torque-cancellation
role in the field solver.  A mis-wired diagonal will cause uncontrolled yaw.

---

### Step 3 — Spin Direction Confirmation

After single-motor isolation is confirmed:

1. Apply `A_ONLY` at ~15 % throttle.
2. Hold a piece of paper or a small tuft of thread near (NOT touching) the motor
   shaft — airflow should indicate CW rotation when viewed from above.
3. Repeat for all four motors:

| Motor | Expected Direction (viewed from above) | Confirmation Signal |
|---|---|---|
| A (front-right) | CW | Prop wash deflects air CCW under shaft |
| B (rear-right) | CCW | Prop wash deflects air CW under shaft |
| C (rear-left) | CW | Same as A |
| D (front-left) | CCW | Same as B |

**If motor direction is wrong**:  
- Swap **any two of the three motor phase wires** to the ESC to reverse direction.
  This is the preferred method — do NOT invert the signal in software unless the
  ESC physically cannot be re-phased (e.g. all-in-one ESC with a fixed direction
  firmware).

---

### Step 4 — Low-Amplitude Phase Sweep (`PHASE_SWEEP_0` through `PHASE_SWEEP_7`)

The phase sweep generates 8 rotating differential output patterns at ~12 % base
throttle with ±5 % amplitude modulation.  Purpose: confirm that all four channels
respond independently and that no channel is stuck or clipped.

Expected behavior per step:
- All four motors are spinning simultaneously.
- The relative throttle level of each motor changes gradually step-by-step.
- No motor stays pinned at 0 % or 100 % across all 8 steps.
- The structured log for each step shows `physical` values that follow the expected
  sine-wave distribution.

**Failure indicators**:
- One motor stuck at 0 throughout all 8 steps → signal wire disconnected or ESC
  disarmed.
- One motor pinned at max throughout → ESC calibration not done or signal
  inverted in hardware.
- Adjacent motors respond identically → channel mapping error (two motors on same
  FC output).

---

### Step 5 — Confirm No FC Remixing

After steps 1–4, compare the structured log `physical` values with the
`solved` values for at least one step.

For `FC_OUTPUT_MODE=passthrough` with default `MOTOR_*_CHANNEL` mapping:
```
solved.A == physical.ch0  (within floating-point rounding)
solved.B == physical.ch1
solved.C == physical.ch2
solved.D == physical.ch3
```

Any deviation (e.g. `solved.A = 0.15` but `physical.ch0 = 0`) indicates:
- FC is still applying its mixer, OR
- Channel map is misconfigured.

---

## 5. Safe-Lift Hardware Checklist

Complete this checklist in order before every tethered or free-lift attempt.

### Frame & Mechanical

- [ ] **Frame integrity**: all arms are tight, no cracks or deformation
- [ ] **Motor mounts**: all four motor bolts torqued, loctite applied
- [ ] **Propeller orientation**: A and C (CW motors) have CW-pitch props with
      **CCW-thread (left-hand) nuts** (motor spin tightens nut);
      B and D (CCW motors) have CCW-pitch props with **CW-thread (right-hand)
      nuts** — confirm prop markings and nut thread direction before each flight
- [ ] **Propeller security**: all prop nuts tight (hand-tight + 1/4 turn); nylon
      lock-nut or prop adapter collar present
- [ ] **Motor order**: visually walk the arms in order A (front-right) → B (rear-right)
      → C (rear-left) → D (front-left) and confirm they match the wiring plan
- [ ] **No debris**: clear all debris (screws, wire ties) from motor/prop zones

### FC Mounting & IMU

- [ ] **FC mounting**: vibration-damper standoffs installed, no rigid contact with frame
- [ ] **IMU orientation**: FC forward arrow aligned with craft nose (toward motor A / 0°)
- [ ] **Level calibration**: FC IMU level-calibrated with vehicle on a flat surface
- [ ] **Compass calibration** (if using GPS/compass): completed and saved

### Electrical

- [ ] **Battery voltage**: ≥ 3.8 V per cell under no-load condition (do not fly below
      3.5 V per cell loaded)
- [ ] **Power module voltage reading**: compared to multimeter — reading matches within
      0.2 V
- [ ] **ESC temperature** (after step 1–5 bench tests): all ESCs cool to touch; any
      ESC > 60 °C at rest indicates calibration or signal problem

### Software / FC Configuration

- [ ] **Startup verification banner**: shows `FC config status: VALID — passthrough
      execution enabled`
- [ ] **No `passthrough_arm_blocked` errors** in startup log
- [ ] **`FIELD_MODE_ENABLED=true`** in `.env`
- [ ] **`FC_OUTPUT_MODE=passthrough`** in `.env`
- [ ] **`FIELD_OUTPUT_SCALE`** set to ≤ 0.35 for first lift (safe-lift band)
- [ ] **`SAFE_LIFT_MODE=true`** confirmed in `.env`
- [ ] **`FC_HARDWARE_MODE=mavlink`** confirmed in `.env`
- [ ] **`SERVO_PASS_THRU=15`** (ArduPilot) or direct-pass mixer (PX4) confirmed

### Safety Equipment

- [ ] **Passthrough validation**: bench sequence completed — all motors fire on
      correct channels
- [ ] **Tether installed**: rated ≥ 3× MTOW; anchored at four arm tips; slack ≤
      0.5× hover height
- [ ] **Clear abort path**: operator has direct line of sight to kill switch; no
      bystanders within 5 m
- [ ] **Logging enabled**: `TELEMETRY_ENABLED=true` confirmed; SQLite telemetry file
      path writable
- [ ] **Ground station active**: MAVProxy / QGroundControl showing live heartbeat

---

## 6. Tethered First-Lift Procedure

> **All steps must be performed in order.  Do not skip steps.**
> Abort on ANY anomaly.

### Phase A — Power On

1. Secure vehicle to test stand. Confirm tether attachments (§5).
2. Confirm no props installed yet.
3. Remove laptop/USB cables from the FC.
4. Announce "arming area clear" — ensure all bystanders are > 5 m away.
5. Connect battery via anti-spark master disconnect.
6. Wait 10 seconds for FC boot.

**Stop immediately if**: FC LEDs do not sequence through the normal boot pattern,
or any ESC emits continuous error tones.

---

### Phase B — Startup Verification Banner Check

7. Read the propulsion-controller log on the ground station.
8. Confirm the startup banner shows:
   ```
   FC config status: VALID — passthrough execution enabled
   ```
9. Confirm no `passthrough_arm_blocked` entries in the log.
10. Confirm motor channel map in the banner matches the physical wiring.

**Stop immediately if**: banner shows `INVALID` or any `passthrough_arm_blocked`
errors.  Resolve configuration before proceeding.

---

### Phase C — Install Props

11. With battery still connected but vehicle **disarmed**, install propellers.
12. A and C (front-right, rear-left): CW-thread prop, CCW-threaded nut, torque to spec.
13. B and D (rear-right, front-left): CCW-thread prop, CW-threaded nut, torque to spec.
14. Re-confirm no loose props by attempting to spin each by hand against the nut.

**Stop immediately if**: any prop cannot be secured or is cracked.

---

### Phase D — Arm

15. Ensure `TETHER_CONFIRM=true` is set in `.env` (required by tether mode).
16. Issue the ARM command via the ground console:
    ```
    ARM
    ```
17. Confirm the FC arming LED sequence (solid green or equivalent for the FC model).
18. Confirm the startup log shows `armed` event.

**Stop immediately if**: arming is refused.  Read the log for the specific
`passthrough_arm_blocked` reason and resolve.

---

### Phase E — Safe-Lift Mode Enable + Slow Ramp

19. Confirm `SAFE_LIFT_MODE=true` is active (banner shows `safe-lift mode: ENABLED`).
20. Issue the `FIELD_TEST` command:
    ```
    FIELD_TEST
    ```
21. The thrust-ramp controller will begin a 3-second linear ramp from 10 % to 35 %
    intensity (configurable via `SAFE_LIFT_MIN_INTENSITY` and `SAFE_LIFT_MAX_INTENSITY`).
22. Watch the structured log for `thrust_ramp` events:
    ```json
    { "type": "thrust_ramp", "intensity": 10, "rampFraction": 0.0 }
    { "type": "thrust_ramp", "intensity": 22, "rampFraction": 0.5 }
    { "type": "thrust_ramp", "intensity": 35, "rampFraction": 1.0 }
    ```

**Stop immediately if**: any motor is silent while others spin, or the craft
tilts > 5° before lifting.  Disarm and re-run bench sequence.

---

### Phase F — Lift Detect

23. If the craft lifts within the tether, confirm the log shows a `lift_detected`
    event.
24. Maintain at hover for no more than **10 seconds** for the first lift.
25. Observe:
    - Tether tension is symmetric across all four tether points (no single-point pull).
    - No excessive yaw oscillation.
    - IMU roll and pitch remain within ± 15°.

**Stop immediately if**:
- Craft yaws more than 30° in any direction.
- Single tether point becomes taut while others are slack (indicates motor failure
  on one arm).
- IMU reports roll or pitch > 25° (instability detector fires automatically and
  triggers abort).
- Any motor smell or smoke.
- Any ESC emits error tone.

---

### Phase G — Abort + Shutdown

26. Issue the LAND command:
    ```
    LAND
    ```
27. Confirm the thrust ramp descends to 0 % intensity.
28. Issue the disarm command:
    ```
    DISARM
    ```
    (or use the RC kill switch if the craft does not descend).
29. Wait for all motor sounds to stop completely (≥ 3 seconds after disarm).
30. Disconnect battery via master disconnect.
31. Wait 2 minutes before touching props or ESCs — ESCs remain hot after shutdown.

---

## 7. Failure Diagnosis Table

| Symptom | Likely Layer | Exact Fix |
|---|---|---|
| **Craft flips immediately on ramp start** | ESC/motor map wrong — one or more motors are on wrong arms | Re-run Steps 1–3 of §4 to confirm each logical motor fires the correct physical motor.  Correct `MOTOR_*_CHANNEL` values or swap ESC signal wires. |
| **Craft yaws hard on ramp** | Diagonal motor pair `A_AND_C` or `B_AND_D` has mismatched spin direction | Step 3 of §4 — check motor spin direction; swap two motor phase wires on the offending ESC(s). |
| **One motor is wrong (e.g. A fires at rear-right position)** | `MOTOR_A_CHANNEL` points to the wrong ESC channel | Update `MOTOR_A_CHANNEL` to the ESC channel physically connected to the front-right arm (0°). |
| **Bench sequence mismatched (log says ch0 active but rear motor spins)** | Physical ESC-to-FC wiring error | Swap the signal wire for the misbehaving ESC to the correct FC MAIN output pin. |
| **Outputs correct in logs but wrong physically** | FC is still applying mixer (most common cause) | Confirm `SERVO_PASS_THRU=15` is set in ArduPilot (Mission Planner > Full Parameter List), or that the PX4 direct-pass mixer is loaded.  Do NOT proceed without confirming. |
| **FC still remixing after `SERVO_PASS_THRU=15`** | Parameter not applied or FC rebooted to defaults | Write the parameter via Mission Planner with vehicle connected, verify with MAVProxy `param fetch SERVO_PASS_THRU`, then **reboot FC and verify again**. |
| **Oscillates on tether** | Stabilizer gains too high for the specific airframe | Reduce `FIELD_KP_PITCH` and `FIELD_KP_ROLL` by 50 %; confirm `FIELD_STABILIZATION_ENABLED` is appropriate for the test phase. |
| **No lift despite correct routing and full ramp** | `FIELD_OUTPUT_SCALE` too low, or `SAFE_LIFT_MAX_INTENSITY` too low for craft weight | Increase `SAFE_LIFT_MAX_INTENSITY` to 40–50 in `.env` (within safe tether limits).  If at 50 % and still no lift, verify battery voltage under load. |
| **Startup banner shows `INVALID`** | One or more hard passthrough conditions not met | Read `passthroughErrors` array in the banner log.  Most common: `FIELD_MODE_ENABLED` is false, or duplicate `MOTOR_*_CHANNEL` values. |
| **`passthrough_arm_blocked` in log** | Same as above | Same fix as `INVALID` banner. |
| **ESC does not respond during bench test** | ESC not calibrated, or signal GND missing | Redo ESC throttle calibration (§4 Step 0).  Check that signal GND wire is connected between the ESC and the FC servo rail GND. |
| **Bench sequence: all channels fire simultaneously** | `FC_OUTPUT_MODE=mixer` is still active | Confirm `FC_OUTPUT_MODE=passthrough` in `.env` and that the propulsion-controller was restarted after the change. |

---

## 8. Complete Environment Variable Reference for Field-Mode Hardware

```dotenv
# ── Hardware mode ──────────────────────────────────────────────────────────────
FC_HARDWARE_MODE=mavlink

# MAVLink FC endpoint
FC_MAVLINK_HOST=127.0.0.1
FC_MAVLINK_PORT=14550
FC_MAVLINK_TARGET_SYS=1

# ── Field control mode ─────────────────────────────────────────────────────────
FIELD_MODE_ENABLED=true
FIELD_PHASE_VELOCITY=3.14159265358979
FIELD_SPIN=1
FIELD_OUTPUT_SCALE=0.30           # ← bench/first-lift value; raise only after validation

# ── Field stabilization ────────────────────────────────────────────────────────
FIELD_STABILIZATION_ENABLED=true
FIELD_KP_PITCH=0.8
FIELD_KP_ROLL=0.8
FIELD_KB_PITCH=0.2
FIELD_KB_ROLL=0.2
FIELD_KI_ALT=0.1

# ── Execution-layer output mode ────────────────────────────────────────────────
FC_OUTPUT_MODE=passthrough

# ── Motor channel map (default straight-through; update if ESCs wired differently)
MOTOR_A_CHANNEL=0                 # front-right → MAIN1
MOTOR_B_CHANNEL=1                 # rear-right  → MAIN2
MOTOR_C_CHANNEL=2                 # rear-left   → MAIN3
MOTOR_D_CHANNEL=3                 # front-left  → MAIN4

# ── Motor inversion (false unless ESC requires reversed signal)
MOTOR_A_INVERTED=false
MOTOR_B_INVERTED=false
MOTOR_C_INVERTED=false
MOTOR_D_INVERTED=false

# ── Safe-lift mode ─────────────────────────────────────────────────────────────
SAFE_LIFT_MODE=true
SAFE_LIFT_MIN_INTENSITY=10
SAFE_LIFT_MAX_INTENSITY=35
SAFE_LIFT_RAMP_DURATION_MS=3000

# ── Tethered test mode ─────────────────────────────────────────────────────────
TETHER_MODE=true
TETHER_CONFIRM=true               # set to true just before issuing FIELD_TEST command

# ── Instability detection (defaults appropriate for first lift)
INSTABILITY_MAX_ANGLE_RAD=0.436   # ≈ 25°
INSTABILITY_MAX_RATE_RAD_S=1.571  # ≈ 90°/s
INSTABILITY_STABLE_BAND_RAD=0.087 # ≈ 5°

# ── Telemetry ──────────────────────────────────────────────────────────────────
TELEMETRY_ENABLED=true
```

---

## Go / No-Go Criteria Summary

### GO (all must be true before first tethered lift attempt)

- [ ] All 215 propulsion-controller unit tests pass (`pnpm --filter @future-craft/propulsion-controller test`)
- [ ] Startup banner: `FC config status: VALID — passthrough execution enabled`
- [ ] No `passthrough_arm_blocked` entries in startup log
- [ ] Bench sequence complete: each logical motor fires exactly on its expected physical channel
- [ ] Spin directions confirmed for all four motors (§4 Step 3)
- [ ] `SERVO_PASS_THRU=15` (ArduPilot) or direct-pass mixer (PX4) confirmed via parameter read-back
- [ ] Diagonal pairs (`A_AND_C`, `B_AND_D`) confirmed via bench sequence (§4 Step 2)
- [ ] Battery voltage ≥ 3.8 V per cell at rest
- [ ] All ESCs cool to touch after bench sequence
- [ ] Tether installed, rated, and confirmed (§5)
- [ ] Ground station showing live heartbeat
- [ ] `FIELD_OUTPUT_SCALE` ≤ 0.35 for first lift
- [ ] `SAFE_LIFT_MODE=true` active

### NO-GO (any one blocks lift)

- [ ] Startup banner shows `INVALID`
- [ ] Any `passthrough_arm_blocked` error in log
- [ ] Any motor fires on the wrong physical channel
- [ ] Any motor spins in the wrong direction
- [ ] `SERVO_PASS_THRU` not set / PX4 direct mode not confirmed
- [ ] ESC temperature > 60 °C at rest
- [ ] Battery voltage < 3.7 V per cell at rest
- [ ] Tether not installed or not anchored
- [ ] Any prop loose or cracked
- [ ] Bench sequence has any step where the `physical` array does not match the expected `solved` routing
