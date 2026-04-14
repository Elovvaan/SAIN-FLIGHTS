/**
 * Flight State Machine — hardware-validation layer for controlled lift.
 *
 * Manages the lifecycle of a real-world flight attempt with explicit, logged
 * state transitions.  This layer sits ON TOP of the existing field architecture
 * and does NOT modify field-solver, field-stabilizer, field-translator, or
 * actuator-router.
 *
 * States:
 *   IDLE            — system powered, not armed
 *   ARMED           — system armed, awaiting ramp command
 *   RAMPING         — thrust ramp in progress (soft-start)
 *   LIFT_DETECTED   — craft has left ground under controlled conditions
 *   STABILIZING     — craft airborne, stabilizer actively maintaining orientation
 *   ABORT           — hard abort triggered; outputs cut to zero
 *
 * Transitions are explicit and must be requested via requestTransition().
 * Illegal transitions are silently rejected (no state change).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** All valid states of the flight state machine. */
export type FlightPhase =
  | 'IDLE'
  | 'ARMED'
  | 'RAMPING'
  | 'LIFT_DETECTED'
  | 'STABILIZING'
  | 'ABORT';

/** A recorded state transition. */
export type FlightTransitionRecord = {
  from: FlightPhase;
  to: FlightPhase;
  reason: string;
  timestampMs: number;
};

/** Snapshot of all flight machine state for abort logging. */
export type FlightStateSnapshot = {
  phase: FlightPhase;
  history: readonly FlightTransitionRecord[];
  enteredAtMs: number;
  elapsedMs: number;
};

// ── Allowed transitions ───────────────────────────────────────────────────────

/**
 * Adjacency map of legal forward transitions.
 * ABORT can be reached from any non-ABORT state (handled specially below).
 */
const ALLOWED_TRANSITIONS: Readonly<Record<FlightPhase, readonly FlightPhase[]>> = {
  IDLE:           ['ARMED'],
  ARMED:          ['RAMPING', 'IDLE'],
  RAMPING:        ['LIFT_DETECTED', 'STABILIZING', 'ABORT', 'IDLE'],
  LIFT_DETECTED:  ['STABILIZING', 'ABORT', 'IDLE'],
  STABILIZING:    ['ABORT', 'IDLE'],
  ABORT:          ['IDLE'],
};

// ── FlightStateMachine class ──────────────────────────────────────────────────

export class FlightStateMachine {
  private _phase: FlightPhase = 'IDLE';
  private _enteredAtMs: number = Date.now();
  private _history: FlightTransitionRecord[] = [];

  // ── Observers ───────────────────────────────────────────────────────────────

  /** Current flight phase. */
  get phase(): FlightPhase {
    return this._phase;
  }

  /** Milliseconds spent in the current phase. */
  get elapsedMs(): number {
    return Date.now() - this._enteredAtMs;
  }

  /** Immutable copy of the transition history. */
  get history(): readonly FlightTransitionRecord[] {
    return this._history.slice();
  }

  // ── Transitions ─────────────────────────────────────────────────────────────

  /**
   * Request a transition to `next` with a human-readable `reason`.
   *
   * ABORT can be requested from any non-ABORT state.
   * All other transitions must be explicitly permitted by ALLOWED_TRANSITIONS.
   *
   * @returns true if the transition was accepted, false if it was rejected.
   */
  requestTransition(next: FlightPhase, reason: string): boolean {
    // ABORT is always allowed from any non-ABORT state.
    const isAbortFromAny = next === 'ABORT' && this._phase !== 'ABORT';
    const isAllowed =
      isAbortFromAny ||
      ALLOWED_TRANSITIONS[this._phase].includes(next);

    if (!isAllowed) {
      return false;
    }

    const record: FlightTransitionRecord = {
      from: this._phase,
      to: next,
      reason,
      timestampMs: Date.now(),
    };
    this._history.push(record);
    this._phase = next;
    this._enteredAtMs = record.timestampMs;
    return true;
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────────

  /** Return a full snapshot of the machine state (used for abort logging). */
  snapshot(): FlightStateSnapshot {
    return {
      phase: this._phase,
      history: this.history,
      enteredAtMs: this._enteredAtMs,
      elapsedMs: this.elapsedMs,
    };
  }

  // ── Convenience predicates ────────────────────────────────────────────────────

  /** True when the machine is in a live-flight phase (RAMPING, LIFT_DETECTED, or STABILIZING). */
  isFlying(): boolean {
    return (
      this._phase === 'RAMPING' ||
      this._phase === 'LIFT_DETECTED' ||
      this._phase === 'STABILIZING'
    );
  }

  /** True when the machine is in the ABORT state. */
  isAborted(): boolean {
    return this._phase === 'ABORT';
  }
}
