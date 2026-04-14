/**
 * Minimal MAVLink 2.0 packet encoder.
 *
 * Implements only the subset of MAVLink required for flight-controller binding:
 *   - HEARTBEAT          (msg_id=0,  crc_extra=50)
 *   - COMMAND_LONG       (msg_id=76, crc_extra=152)
 *
 * No external dependencies — uses only Node.js built-ins.
 * Reference: https://mavlink.io/en/guide/serialization.html
 */

// ── CRC-16/MCRF4XX (X25) ────────────────────────────────────────────────────

function crcAccumulate(data: number, crc: number): number {
  let tmp = (data ^ (crc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return (((crc >> 8) & 0xff) ^ (tmp << 8) ^ (tmp << 3) ^ ((tmp >> 4) & 0x0f)) & 0xffff;
}

function x25Crc(data: Buffer, crcExtra: number): number {
  let crc = 0xffff;
  for (const b of data) crc = crcAccumulate(b, crc);
  crc = crcAccumulate(crcExtra, crc);
  return crc;
}

// ── Sequence counter (shared across packet builders) ────────────────────────

let _seq = 0;

/** GCS system ID and component ID used in outgoing packets. */
const GCS_SYS_ID = 255;
const GCS_COMP_ID = 0;

// ── Packet builder ───────────────────────────────────────────────────────────

function buildPacket(msgId: number, crcExtra: number, payload: Buffer): Buffer {
  const seq = _seq++ & 0xff;
  const hdr = Buffer.allocUnsafe(10);
  hdr[0] = 0xfd;              // STX
  hdr[1] = payload.length;    // payload length
  hdr[2] = 0;                 // incompat_flags
  hdr[3] = 0;                 // compat_flags
  hdr[4] = seq;               // sequence
  hdr[5] = GCS_SYS_ID;       // system id
  hdr[6] = GCS_COMP_ID;      // component id
  hdr[7] = msgId & 0xff;      // message id byte 0
  hdr[8] = (msgId >> 8) & 0xff; // message id byte 1
  hdr[9] = (msgId >> 16) & 0xff; // message id byte 2

  // CRC covers bytes 1–9 (inclusive) + payload, then crc_extra is appended
  const crcInput = Buffer.concat([hdr.subarray(1), payload]);
  const crc = x25Crc(crcInput, crcExtra);
  const crcBuf = Buffer.allocUnsafe(2);
  crcBuf.writeUInt16LE(crc, 0);

  return Buffer.concat([hdr, payload, crcBuf]);
}

// ── MAVLink constants ────────────────────────────────────────────────────────

export const MAV_CMD_COMPONENT_ARM_DISARM = 400;
export const MAV_CMD_NAV_TAKEOFF = 22;
export const MAV_CMD_NAV_LAND = 21;
export const MAV_CMD_DO_SET_MODE = 176;

/** ArduCopter custom flight-mode numbers (used with MAV_CMD_DO_SET_MODE). */
export const ARDUCOP_MODE_GUIDED = 4;
export const ARDUCOP_MODE_LOITER = 5;

/** Base-mode flag: autopilot using custom mode numbering. */
export const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1;

// ── Public packet builders ───────────────────────────────────────────────────

/**
 * Build a MAVLink 2.0 HEARTBEAT packet (msg_id=0).
 * Sent periodically so the flight controller knows the GCS is alive.
 */
export function buildHeartbeat(): Buffer {
  const payload = Buffer.allocUnsafe(9);
  payload.writeUInt32LE(0, 0); // custom_mode = 0
  payload[4] = 6;               // type: MAV_TYPE_GCS
  payload[5] = 8;               // autopilot: MAV_AUTOPILOT_INVALID
  payload[6] = 0;               // base_mode
  payload[7] = 4;               // system_status: MAV_STATE_ACTIVE
  payload[8] = 3;               // mavlink_version
  return buildPacket(0, 50, payload);
}

/**
 * Build a MAVLink 2.0 COMMAND_LONG packet (msg_id=76).
 *
 * @param targetSystem   MAVLink system ID of the flight controller (typically 1)
 * @param targetComponent MAVLink component ID (1 = autopilot)
 * @param command        MAVLink command number
 * @param confirmation   Confirmation index (0 for first attempt)
 * @param p1–p7          Command parameters (float)
 */
export function buildCommandLong(
  targetSystem: number,
  targetComponent: number,
  command: number,
  confirmation: number,
  p1: number, p2: number, p3: number, p4: number,
  p5: number, p6: number, p7: number,
): Buffer {
  const payload = Buffer.allocUnsafe(33);
  payload.writeFloatLE(p1, 0);
  payload.writeFloatLE(p2, 4);
  payload.writeFloatLE(p3, 8);
  payload.writeFloatLE(p4, 12);
  payload.writeFloatLE(p5, 16);
  payload.writeFloatLE(p6, 20);
  payload.writeFloatLE(p7, 24);
  payload.writeUInt16LE(command, 28);
  payload[30] = targetSystem;
  payload[31] = targetComponent;
  payload[32] = confirmation;
  return buildPacket(76, 152, payload);
}
