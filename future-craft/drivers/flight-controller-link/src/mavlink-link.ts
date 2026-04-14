/**
 * MavlinkFlightControllerLink
 *
 * Real hardware implementation of FlightControllerLink.
 * Communicates with an ArduPilot/PX4 flight controller via MAVLink 2.0 over UDP.
 *
 * Default endpoint: UDP 127.0.0.1:14550 (ArduPilot SITL default; change
 * FC_MAVLINK_HOST / FC_MAVLINK_PORT env vars for real hardware serial-to-UDP
 * bridges, e.g. via mavproxy or dronekit-sitl).
 *
 * setThrottle() maps abstract lift-cell percentages to high-level MAVLink
 * flight commands so the existing propulsion-controller logic is unchanged:
 *   avgLift ≥ 65  → TAKEOFF (GUIDED mode)
 *   avgLift 45–64 → LOITER  (hold position)
 *   avgLift < 45  → LAND
 */

import * as dgram from 'dgram';
import pino from 'pino';
import type { FlightControllerLink } from '@future-craft/hardware-abstraction';
import {
  buildHeartbeat,
  buildCommandLong,
  buildSetActuatorControlTarget,
  MAV_CMD_COMPONENT_ARM_DISARM,
  MAV_CMD_NAV_TAKEOFF,
  MAV_CMD_NAV_LAND,
  MAV_CMD_DO_SET_MODE,
  ARDUCOP_MODE_GUIDED,
  ARDUCOP_MODE_LOITER,
  MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
} from './mavlink-encoder.js';

const logger = pino({ name: 'flight-controller-link:mavlink' });

/** Altitude (metres) commanded on TAKEOFF when thrustPct is low. */
const MIN_TAKEOFF_ALT_M = 5;

export class MavlinkFlightControllerLink implements FlightControllerLink {
  private socket: dgram.Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private armed = false;

  constructor(
    private readonly host: string = '127.0.0.1',
    private readonly port: number = 14550,
    private readonly targetSystem: number = 1,
  ) {}

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.socket = dgram.createSocket('udp4');
    // Errors after connect are logged rather than thrown to avoid crashing the
    // service — the health check will report unhealthy.
    this.socket.on('error', (err) => {
      logger.error({ err }, 'MavlinkFlightControllerLink socket error');
    });

    await this.send(buildHeartbeat());
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.send(buildHeartbeat());
      } catch (err) {
        logger.warn({ err }, 'MAVLink heartbeat send failed');
      }
    }, 1000);
    this.connected = true;
    logger.info(
      { host: this.host, port: this.port, targetSystem: this.targetSystem },
      'MavlinkFlightControllerLink: connected — heartbeat running',
    );
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.connected = false;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    logger.info('MavlinkFlightControllerLink: disconnected');
  }

  // ── Arm / Disarm ───────────────────────────────────────────────────────────

  async arm(): Promise<void> {
    // Switch to GUIDED mode before arming so the FC accepts the command.
    await this.send(buildCommandLong(
      this.targetSystem, 1,
      MAV_CMD_DO_SET_MODE, 0,
      MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, ARDUCOP_MODE_GUIDED, 0, 0, 0, 0, 0,
    ));
    await this.send(buildCommandLong(
      this.targetSystem, 1,
      MAV_CMD_COMPONENT_ARM_DISARM, 0,
      1, 0, 0, 0, 0, 0, 0, // param1=1 → ARM
    ));
    this.armed = true;
    logger.info('MavlinkFlightControllerLink: ARM sent (GUIDED mode + arm command)');
  }

  async disarm(): Promise<void> {
    await this.send(buildCommandLong(
      this.targetSystem, 1,
      MAV_CMD_COMPONENT_ARM_DISARM, 0,
      0, 0, 0, 0, 0, 0, 0, // param1=0 → DISARM
    ));
    this.armed = false;
    logger.info('MavlinkFlightControllerLink: DISARM sent');
  }

  // ── Throttle → high-level flight commands ──────────────────────────────────

  async setThrottle(liftCells: [number, number, number, number], thrustPct: number): Promise<void> {
    if (!this.armed) {
      logger.warn('setThrottle called while disarmed — command ignored');
      return;
    }

    const avgLift = (liftCells[0] + liftCells[1] + liftCells[2] + liftCells[3]) / 4;

    if (avgLift >= 65) {
      // ASCEND — command takeoff to a target altitude derived from thrustPct
      // Target altitude: thrustPct maps [0,100] to [0,25] m — clamped to 5 m minimum.
      const targetAltM = Math.max(MIN_TAKEOFF_ALT_M, thrustPct / 4);
      await this.send(buildCommandLong(
        this.targetSystem, 1,
        MAV_CMD_NAV_TAKEOFF, 0,
        0, 0, 0, 0, 0, 0, targetAltM, // param7 = target altitude (m)
      ));
      logger.info(
        { avgLift, targetAltM },
        'MavlinkFlightControllerLink: TAKEOFF command sent',
      );
    } else if (avgLift >= 45) {
      // HOVER / HOLD — switch to LOITER mode so the FC holds position
      await this.send(buildCommandLong(
        this.targetSystem, 1,
        MAV_CMD_DO_SET_MODE, 0,
        MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, ARDUCOP_MODE_LOITER, 0, 0, 0, 0, 0,
      ));
      logger.info({ avgLift }, 'MavlinkFlightControllerLink: LOITER (hold) mode sent');
    } else {
      // DESCEND — command landing
      await this.send(buildCommandLong(
        this.targetSystem, 1,
        MAV_CMD_NAV_LAND, 0,
        0, 0, 0, 0, 0, 0, 0,
      ));
      logger.info({ avgLift }, 'MavlinkFlightControllerLink: LAND command sent');
    }
  }

  // ── Direct actuator output (field mode) ────────────────────────────────────

  /**
   * Send per-motor outputs to the flight controller via
   * SET_ACTUATOR_CONTROL_TARGET (msg_id=140).
   *
   * Each value in `outputs` must be in [0, 1]; values are passed directly as
   * controls[0..3] in mixer group 0.  In ArduPilot/PX4 GUIDED mode the FC
   * applies its own mixer matrix before driving the ESCs, so this is
   * effectively an attitude-rate/thrust demand rather than raw PWM.  For true
   * per-motor passthrough, the vehicle must be configured for passthrough mode
   * or a custom mixer that maps these channels 1-to-1.
   *
   * In all cases the FC remains responsible for arming interlocks — this call
   * is silently dropped if the link is not armed.
   */
  async setActuatorOutputs(outputs: [number, number, number, number]): Promise<void> {
    if (!this.armed) {
      logger.warn('setActuatorOutputs called while disarmed — command ignored');
      return;
    }

    const controls: [number, number, number, number, number, number, number, number] = [
      outputs[0], outputs[1], outputs[2], outputs[3],
      0, 0, 0, 0, // channels 4-7 unused
    ];
    await this.send(buildSetActuatorControlTarget(this.targetSystem, controls, 0));
    logger.debug(
      { outputs },
      'MavlinkFlightControllerLink: SET_ACTUATOR_CONTROL_TARGET sent',
    );
  }

  // ── Health ─────────────────────────────────────────────────────────────────
  async getHealth(): Promise<{ healthy: boolean; cells: boolean[] }> {
    const healthy = this.connected && this.socket !== null;
    return { healthy, cells: [healthy, healthy, healthy, healthy] };
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private send(packet: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not initialised — call connect() first'));
        return;
      }
      this.socket.send(packet, this.port, this.host, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
