/**
 * Tests for flight-state-machine.ts
 *
 * Run with:
 *   cd future-craft
 *   pnpm --filter @future-craft/propulsion-controller test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FlightStateMachine } from './flight-state-machine';
import type { FlightPhase } from './flight-state-machine';

// ── FlightStateMachine ────────────────────────────────────────────────────────

describe('FlightStateMachine', () => {
  describe('initial state', () => {
    it('starts in IDLE', () => {
      const fsm = new FlightStateMachine();
      assert.strictEqual(fsm.phase, 'IDLE');
    });

    it('has empty history on creation', () => {
      const fsm = new FlightStateMachine();
      assert.strictEqual(fsm.history.length, 0);
    });

    it('isFlying() is false in IDLE', () => {
      const fsm = new FlightStateMachine();
      assert.strictEqual(fsm.isFlying(), false);
    });

    it('isAborted() is false in IDLE', () => {
      const fsm = new FlightStateMachine();
      assert.strictEqual(fsm.isAborted(), false);
    });
  });

  describe('allowed transitions', () => {
    it('IDLE → ARMED is allowed', () => {
      const fsm = new FlightStateMachine();
      const ok = fsm.requestTransition('ARMED', 'test');
      assert.ok(ok);
      assert.strictEqual(fsm.phase, 'ARMED');
    });

    it('ARMED → RAMPING is allowed', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      const ok = fsm.requestTransition('RAMPING', 'ramp_start');
      assert.ok(ok);
      assert.strictEqual(fsm.phase, 'RAMPING');
    });

    it('RAMPING → LIFT_DETECTED is allowed', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('RAMPING', 'ramp_start');
      const ok = fsm.requestTransition('LIFT_DETECTED', 'lift_detected');
      assert.ok(ok);
      assert.strictEqual(fsm.phase, 'LIFT_DETECTED');
    });

    it('LIFT_DETECTED → STABILIZING is allowed', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('RAMPING', 'ramp_start');
      fsm.requestTransition('LIFT_DETECTED', 'lift_detected');
      const ok = fsm.requestTransition('STABILIZING', 'stabilizing');
      assert.ok(ok);
      assert.strictEqual(fsm.phase, 'STABILIZING');
    });

    it('ABORT → IDLE is allowed (re-arm after abort)', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('ABORT', 'abort');
      const ok = fsm.requestTransition('IDLE', 'reset');
      assert.ok(ok);
      assert.strictEqual(fsm.phase, 'IDLE');
    });
  });

  describe('ABORT from any non-ABORT state', () => {
    const phases: FlightPhase[] = ['IDLE', 'ARMED', 'RAMPING', 'LIFT_DETECTED', 'STABILIZING'];
    for (const startPhase of phases) {
      it(`ABORT is reachable from ${startPhase}`, () => {
        const fsm = new FlightStateMachine();
        // Navigate to startPhase
        if (startPhase !== 'IDLE') {
          fsm.requestTransition('ARMED', 'arm');
        }
        if (startPhase === 'RAMPING' || startPhase === 'LIFT_DETECTED' || startPhase === 'STABILIZING') {
          fsm.requestTransition('RAMPING', 'ramp_start');
        }
        if (startPhase === 'LIFT_DETECTED' || startPhase === 'STABILIZING') {
          fsm.requestTransition('LIFT_DETECTED', 'lift_detected');
        }
        if (startPhase === 'STABILIZING') {
          fsm.requestTransition('STABILIZING', 'stabilizing');
        }
        assert.strictEqual(fsm.phase, startPhase);
        const ok = fsm.requestTransition('ABORT', 'test_abort');
        assert.ok(ok, `ABORT should be reachable from ${startPhase}`);
        assert.strictEqual(fsm.phase, 'ABORT');
      });
    }
  });

  describe('rejected transitions', () => {
    it('IDLE → RAMPING is rejected (must go through ARMED)', () => {
      const fsm = new FlightStateMachine();
      const ok = fsm.requestTransition('RAMPING', 'skip');
      assert.strictEqual(ok, false);
      assert.strictEqual(fsm.phase, 'IDLE');
    });

    it('ABORT → ABORT is rejected (no double-abort)', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('ABORT', 'abort');
      const ok = fsm.requestTransition('ABORT', 'double');
      assert.strictEqual(ok, false);
      assert.strictEqual(fsm.phase, 'ABORT');
    });

    it('ABORT → ARMED is rejected (must return to IDLE first)', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('ABORT', 'abort');
      const ok = fsm.requestTransition('ARMED', 'skip');
      assert.strictEqual(ok, false);
    });
  });

  describe('history tracking', () => {
    it('records each transition with from/to/reason/timestampMs', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm_reason');
      fsm.requestTransition('RAMPING', 'ramp_reason');

      const history = fsm.history;
      assert.strictEqual(history.length, 2);
      assert.strictEqual(history[0].from, 'IDLE');
      assert.strictEqual(history[0].to, 'ARMED');
      assert.strictEqual(history[0].reason, 'arm_reason');
      assert.ok(history[0].timestampMs > 0);

      assert.strictEqual(history[1].from, 'ARMED');
      assert.strictEqual(history[1].to, 'RAMPING');
    });

    it('rejected transitions are not recorded in history', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('RAMPING', 'bad'); // rejected
      assert.strictEqual(fsm.history.length, 0);
    });
  });

  describe('snapshot', () => {
    it('snapshot captures phase, history, elapsedMs', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      const snap = fsm.snapshot();
      assert.strictEqual(snap.phase, 'ARMED');
      assert.strictEqual(snap.history.length, 1);
      assert.ok(snap.elapsedMs >= 0);
      assert.ok(snap.enteredAtMs > 0);
    });
  });

  describe('isFlying()', () => {
    it('returns true in RAMPING', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('RAMPING', 'ramp_start');
      assert.strictEqual(fsm.isFlying(), true);
    });

    it('returns true in LIFT_DETECTED', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('RAMPING', 'ramp');
      fsm.requestTransition('LIFT_DETECTED', 'lift');
      assert.strictEqual(fsm.isFlying(), true);
    });

    it('returns true in STABILIZING', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      fsm.requestTransition('RAMPING', 'ramp');
      fsm.requestTransition('STABILIZING', 'stab');
      assert.strictEqual(fsm.isFlying(), true);
    });

    it('returns false in IDLE, ARMED, ABORT', () => {
      for (const setup of [
        () => new FlightStateMachine(),
        () => { const f = new FlightStateMachine(); f.requestTransition('ARMED', 'arm'); return f; },
        () => { const f = new FlightStateMachine(); f.requestTransition('ARMED', 'arm'); f.requestTransition('ABORT', 'abort'); return f; },
      ]) {
        const fsm = setup();
        assert.strictEqual(fsm.isFlying(), false);
      }
    });
  });

  describe('history is immutable (returns a copy)', () => {
    it('mutating the returned history does not affect the FSM', () => {
      const fsm = new FlightStateMachine();
      fsm.requestTransition('ARMED', 'arm');
      const h1 = fsm.history as unknown as Array<unknown>;
      h1.push({ fake: true });
      assert.strictEqual(fsm.history.length, 1); // original unaffected
    });
  });
});
