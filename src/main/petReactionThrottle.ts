/**
 * Reaction suppression for the pet channel (quirk-ui Round 2, scope B).
 *
 * Every committed task completion fires `task-completed` once (locked by
 * tests/task-undo-restore.test.ts) and index.ts already forwards it to the pet;
 * hydration sips arrive through the scheduler's sendSip. Bursts must not turn
 * the pet into a metronome, so each reaction kind gets its own gate: the first
 * event inside the window reacts, the rest stay silent — nothing is queued,
 * queued reactions would fire long after the moment they celebrate. Pure and
 * clock-injected, so the window semantics are testable without a running app.
 */

/** Suppression window for celebrations (ux §11.2: 30s global once). */
export const CELEBRATE_SUPPRESS_MS = 30_000;

/** Suppression window for hydration sips (ux §11.2: 10s, independent). */
export const SIP_SUPPRESS_MS = 10_000;

export interface PetReactionGate {
  /**
   * True when this event may react. The first call inside a window consumes
   * it: later calls within `windowMs` return false without queuing. `now` must
   * be non-decreasing across calls (wall clock or injected clock); a clock
   * running backwards is suppressed conservatively.
   */
  shouldReact(now: number): boolean;
}

export const createPetReactionGate = (windowMs: number = CELEBRATE_SUPPRESS_MS): PetReactionGate => {
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    shouldReact(now: number): boolean {
      if (now - lastAt < windowMs) return false;
      lastAt = now;
      return true;
    }
  };
};
