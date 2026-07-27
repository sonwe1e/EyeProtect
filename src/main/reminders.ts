import { EventEmitter } from 'node:events';
import type {
  ActiveReminder,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  Settings,
  SingleReminderKind
} from '../shared/types';

type ReminderChangedPayload = ReminderStatus;

const MINUTE = 60_000;
const COMBINE_WINDOW_MS = 60_000;
/** setTimeout cannot wait past 2^31-1 ms (~24.8 days); cap for safety. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/**
 * After suspend/resume or unlocking the screen the user needs a moment;
 * overdue reminders wait this long before forcing a window on screen.
 */
const SYSTEM_GRACE_MS = 60_000;
/** Restore sanity bound: anything scheduled further out than this is corrupt. */
const MAX_SCHEDULE_AHEAD_MS = 48 * 60 * MINUTE;

/**
 * Mandatory rest time before 'complete' is accepted, owned by the main
 * process. Renderers only count down towards ActiveReminder.unlockAt.
 */
const COMPLETE_WAIT_MS: Record<ReminderKind, number> = {
  eye: 30_000,
  walk: 60_000,
  combined: 60_000
};

const reminderKindsFor = (kind: ReminderKind): SingleReminderKind[] => {
  if (kind === 'combined') {
    return ['eye', 'walk'];
  }
  return [kind];
};

/** Persisted reminder state so restarts do not reset or bypass schedules. */
export interface ReminderSnapshot {
  nextEyeAt: number;
  nextWalkAt: number;
  pausedUntil: number | null;
  snoozeCount: number;
  /** Remaining ms frozen by pause(); null when not paused. */
  frozenEyeMs: number | null;
  frozenWalkMs: number | null;
}

export interface SchedulerOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Snapshot restored from disk; used when it passes sanity checks. */
  restore?: ReminderSnapshot | null;
  /** Invoked with a fresh snapshot whenever scheduling state transitions. */
  onPersist?: (snapshot: ReminderSnapshot) => void;
}

export class ReminderScheduler extends EventEmitter {
  private settings: Settings;
  private status: ReminderStatus;
  private timer: NodeJS.Timeout | null = null;
  private sequence = 0;
  private activeIsTest = false;
  private snoozeCount = 0;
  private frozen: { eyeMs: number; walkMs: number } | null = null;
  /** Firing is suppressed until this timestamp (suspend/resume/unlock grace). */
  private quietUntil = 0;
  private readonly now: () => number;
  private readonly onPersist: ((snapshot: ReminderSnapshot) => void) | null;

  constructor(settings: Settings, options: SchedulerOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
    this.onPersist = options.onPersist ?? null;
    this.settings = settings;
    this.status = this.initialStatus(options.restore ?? null);
  }

  /**
   * Deadline-driven instead of a 1s heartbeat: sleep until the next thing
   * that can change state (a deadline, the pause expiring, a combine-window
   * absorb, or the end of a grace period), reconcile once, re-arm.
   */
  start(): void {
    if (this.timer) {
      return;
    }
    this.armTimer();
  }

  stop(): void {
    this.disarm();
  }

  getStatus(): ReminderStatus {
    return {
      ...this.status,
      activeReminder: this.status.activeReminder ? { ...this.status.activeReminder } : null
    };
  }

  updateSettings(settings: Settings, previous: Settings): ReminderStatus {
    const now = this.now();
    this.settings = settings;

    if (!this.status.activeReminder) {
      if (settings.eyeIntervalMinutes !== previous.eyeIntervalMinutes) {
        this.status.nextEyeAt = now + settings.eyeIntervalMinutes * MINUTE;
      }
      if (settings.walkIntervalMinutes !== previous.walkIntervalMinutes) {
        this.status.nextWalkAt = now + settings.walkIntervalMinutes * MINUTE;
      }
    }

    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  handleAction(action: ReminderAction, reminderId: string): ReminderStatus {
    const active = this.status.activeReminder;
    if (!active || active.id !== reminderId) {
      return this.getStatus();
    }

    const now = this.now();
    // Main-process enforcement of the rest wait: a renderer that reloads or
    // replays IPC still cannot complete early or spam snooze.
    if (action === 'complete' && now < active.unlockAt) {
      return this.getStatus();
    }
    if (action === 'snooze' && now < active.snoozeAllowedAt) {
      return this.getStatus();
    }

    if (!this.activeIsTest) {
      for (const kind of active.kinds) {
        this.scheduleKind(kind, action === 'snooze' ? this.settings.snoozeMinutes : this.intervalFor(kind), now);
      }
      if (action === 'snooze') {
        this.snoozeCount += 1;
      } else {
        this.snoozeCount = 0;
      }
    }

    this.status.activeReminder = null;
    this.activeIsTest = false;
    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  triggerTest(kind: ReminderKind): ReminderStatus {
    this.beginReminder(kind, true);
    return this.getStatus();
  }

  /**
   * Open a real reminder right now (tray "立即休息"). Picks the kind whose
   * deadline is nearest; the other kind can still fold in via absorption.
   */
  triggerNow(): ReminderStatus {
    if (this.status.activeReminder) {
      return this.getStatus();
    }
    const kind: SingleReminderKind =
      this.status.nextEyeAt <= this.status.nextWalkAt ? 'eye' : 'walk';
    this.beginReminder(kind, false);
    return this.getStatus();
  }

  /**
   * Freeze the remaining time instead of resetting it: with 2 minutes left
   * until the eye reminder, pausing for an hour no longer costs another full
   * interval after the pause ends.
   */
  pause(minutes: number): ReminderStatus {
    const pauseMinutes = Math.min(24 * 60, Math.max(1, Math.round(minutes)));
    const now = this.now();
    this.frozen = {
      eyeMs: Math.max(0, this.status.nextEyeAt - now),
      walkMs: Math.max(0, this.status.nextWalkAt - now)
    };
    const pausedUntil = now + pauseMinutes * MINUTE;
    this.status.pausedUntil = pausedUntil;
    this.status.activeReminder = null;
    this.activeIsTest = false;
    this.snoozeCount = 0;
    // While paused, "next" reads as pause-end + frozen remainder; resume()
    // recomputes from the (earlier) resume time if the user returns first.
    this.status.nextEyeAt = pausedUntil + this.frozen.eyeMs;
    this.status.nextWalkAt = pausedUntil + this.frozen.walkMs;
    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  /** Continue the frozen countdowns from now. No-op when not paused. */
  resume(): ReminderStatus {
    if (!this.status.pausedUntil) {
      return this.getStatus();
    }
    const now = this.now();
    this.status.pausedUntil = null;
    if (this.frozen) {
      this.status.nextEyeAt = now + this.frozen.eyeMs;
      this.status.nextWalkAt = now + this.frozen.walkMs;
      this.frozen = null;
    }
    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  /** Discard pause and progress; both cycles start over from now. */
  restartCycle(): ReminderStatus {
    const now = this.now();
    this.status.pausedUntil = null;
    this.frozen = null;
    this.snoozeCount = 0;
    this.status.activeReminder = null;
    this.activeIsTest = false;
    this.status.nextEyeAt = now + this.settings.eyeIntervalMinutes * MINUTE;
    this.status.nextWalkAt = now + this.settings.walkIntervalMinutes * MINUTE;
    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  /** System is about to sleep: drop the timer (it would misfire on wake) and persist. */
  suspend(): void {
    this.disarm();
    this.persist();
  }

  /**
   * System woke up. idleSeconds is how long the user has already been away
   * (powerMonitor.getSystemIdleTime()); an absence longer than the shortest
   * cycle counts as a natural break rather than a backlog of reminders.
   */
  handleSystemResume(idleSeconds: number): ReminderStatus {
    const now = this.now();
    const idleMs = Math.max(0, idleSeconds) * 1_000;
    const shortestCycle =
      Math.min(this.settings.eyeIntervalMinutes, this.settings.walkIntervalMinutes) * MINUTE;

    if (!this.status.pausedUntil && idleMs >= shortestCycle) {
      this.status.nextEyeAt = now + this.settings.eyeIntervalMinutes * MINUTE;
      this.status.nextWalkAt = now + this.settings.walkIntervalMinutes * MINUTE;
      this.snoozeCount = 0;
      this.status.activeReminder = null;
      this.activeIsTest = false;
    }

    this.quietUntil = now + SYSTEM_GRACE_MS;
    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  /** Screen unlocked: give the user a grace period before forcing a reminder. */
  handleScreenUnlock(): ReminderStatus {
    const now = this.now();
    this.quietUntil = Math.max(this.quietUntil, now + SYSTEM_GRACE_MS);
    this.armTimer();
    return this.getStatus();
  }

  serialize(): ReminderSnapshot {
    return {
      nextEyeAt: this.status.nextEyeAt,
      nextWalkAt: this.status.nextWalkAt,
      pausedUntil: this.status.pausedUntil,
      snoozeCount: this.snoozeCount,
      frozenEyeMs: this.frozen?.eyeMs ?? null,
      frozenWalkMs: this.frozen?.walkMs ?? null
    };
  }

  /** Runs one scheduling pass. Exposed so tests can drive time deterministically. */
  tick(now: number = this.now()): ReminderStatus {
    this.checkDue(now);
    return this.getStatus();
  }

  onChanged(callback: (payload: ReminderChangedPayload) => void): void {
    this.on('changed', callback);
  }

  private initialStatus(restore: ReminderSnapshot | null): ReminderStatus {
    const now = this.now();
    if (restore && this.isRestorable(restore, now)) {
      this.snoozeCount = restore.snoozeCount;
      let pausedUntil = restore.pausedUntil;
      let nextEyeAt = restore.nextEyeAt;
      let nextWalkAt = restore.nextWalkAt;
      if (pausedUntil !== null && pausedUntil <= now) {
        // The pause expired while the app was away: continue from the stored
        // deadlines (a single reconcile fires at most one overdue reminder).
        pausedUntil = null;
      } else if (pausedUntil !== null && restore.frozenEyeMs !== null && restore.frozenWalkMs !== null) {
        this.frozen = { eyeMs: restore.frozenEyeMs, walkMs: restore.frozenWalkMs };
      }
      return { nextEyeAt, nextWalkAt, pausedUntil, activeReminder: null };
    }

    return {
      nextEyeAt: now + this.settings.eyeIntervalMinutes * MINUTE,
      nextWalkAt: now + this.settings.walkIntervalMinutes * MINUTE,
      pausedUntil: null,
      activeReminder: null
    };
  }

  private isRestorable(snapshot: ReminderSnapshot, now: number): boolean {
    const finiteAhead = (value: number): boolean =>
      Number.isFinite(value) && value > now - MAX_SCHEDULE_AHEAD_MS && value <= now + MAX_SCHEDULE_AHEAD_MS;
    const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
    return (
      finiteAhead(snapshot.nextEyeAt) &&
      finiteAhead(snapshot.nextWalkAt) &&
      (snapshot.pausedUntil === null || finiteAhead(snapshot.pausedUntil)) &&
      Number.isInteger(snapshot.snoozeCount) &&
      snapshot.snoozeCount >= 0 &&
      (snapshot.frozenEyeMs === null || finiteNonNegative(snapshot.frozenEyeMs)) &&
      (snapshot.frozenWalkMs === null || finiteNonNegative(snapshot.frozenWalkMs))
    );
  }

  private disarm(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private armTimer(): void {
    this.disarm();
    const now = this.now();
    const deadline = this.nextDeadline(now);
    if (deadline === null) {
      return;
    }
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, deadline - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.reconcile();
    }, delay);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private nextDeadline(now: number): number | null {
    const candidates: number[] = [];
    if (this.quietUntil > now) {
      candidates.push(this.quietUntil);
    }
    const active = this.status.activeReminder;
    if (active) {
      // Earliest moment a not-yet-included kind can be absorbed into the alert.
      if (!this.activeIsTest) {
        for (const kind of ['eye', 'walk'] as SingleReminderKind[]) {
          if (!active.kinds.includes(kind)) {
            candidates.push(this.nextAtFor(kind) - COMBINE_WINDOW_MS);
          }
        }
      }
      // Nothing to absorb: wait for a user action instead of polling.
    } else {
      candidates.push(this.status.nextEyeAt, this.status.nextWalkAt);
      if (this.status.pausedUntil) {
        candidates.push(this.status.pausedUntil);
      }
    }
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }

  private reconcile(): void {
    this.checkDue(this.now());
    this.persist();
    this.armTimer();
  }

  private checkDue(now: number = this.now()): void {
    if (this.status.activeReminder) {
      this.absorbDueKinds(this.status.activeReminder, now);
      return;
    }

    if (this.status.pausedUntil && now < this.status.pausedUntil) {
      return;
    }

    if (this.status.pausedUntil && now >= this.status.pausedUntil) {
      this.status.pausedUntil = null;
      this.frozen = null;
      this.emitChanged();
    }

    // Resume/unlock grace: the user just got back — no instant forced popup.
    if (now < this.quietUntil) {
      return;
    }

    const eyeDue = this.status.nextEyeAt <= now;
    const walkDue = this.status.nextWalkAt <= now;
    const eyeNear = this.status.nextEyeAt <= now + COMBINE_WINDOW_MS;
    const walkNear = this.status.nextWalkAt <= now + COMBINE_WINDOW_MS;

    if ((eyeDue && walkNear) || (walkDue && eyeNear)) {
      this.beginReminder('combined', false);
      return;
    }

    if (eyeDue) {
      this.beginReminder('eye', false);
      return;
    }

    if (walkDue) {
      this.beginReminder('walk', false);
    }
  }

  private beginReminder(kind: ReminderKind, isTest: boolean): void {
    const now = this.now();
    const unlockAt = now + COMPLETE_WAIT_MS[kind];
    const active: ActiveReminder = {
      id: `${now}-${++this.sequence}`,
      kind,
      kinds: reminderKindsFor(kind),
      startedAt: now,
      unlockAt,
      // First snooze of a cycle is immediate; later ones wait out the countdown.
      snoozeAllowedAt: !isTest && this.snoozeCount > 0 ? unlockAt : now,
      mode: 'focused',
      snoozeCount: isTest ? 0 : this.snoozeCount
    };
    this.activeIsTest = isTest;
    this.status.activeReminder = active;
    this.emitChanged();
  }

  /**
   * While a reminder is on screen, fold the other kind into it as soon as that
   * kind is due (or due within the combine window). One action then reschedules
   * both kinds, so the user never faces two back-to-back reminders for
   * intervals that piled up together.
   */
  private absorbDueKinds(active: ActiveReminder, now: number): void {
    if (this.activeIsTest) {
      return;
    }
    const shouldAbsorb = (['eye', 'walk'] as SingleReminderKind[]).some(
      (kind) => !active.kinds.includes(kind) && this.nextAtFor(kind) <= now + COMBINE_WINDOW_MS
    );
    if (!shouldAbsorb) {
      return;
    }
    active.kinds = ['eye', 'walk'];
    active.kind = 'combined';
    // Extend the enforced rest to the combined duration (counted from the
    // reminder's start) — this is what the renderer countdown must reflect.
    const unlockAt = active.startedAt + COMPLETE_WAIT_MS.combined;
    if (unlockAt > active.unlockAt) {
      active.unlockAt = unlockAt;
    }
    if (active.snoozeCount > 0) {
      active.snoozeAllowedAt = Math.max(active.snoozeAllowedAt, active.unlockAt);
    }
    this.emitChanged();
  }

  private nextAtFor(kind: SingleReminderKind): number {
    return kind === 'eye' ? this.status.nextEyeAt : this.status.nextWalkAt;
  }

  private scheduleKind(kind: SingleReminderKind, minutes: number, from: number): void {
    const nextAt = from + minutes * MINUTE;
    if (kind === 'eye') {
      this.status.nextEyeAt = nextAt;
    } else {
      this.status.nextWalkAt = nextAt;
    }
  }

  private intervalFor(kind: SingleReminderKind): number {
    return kind === 'eye' ? this.settings.eyeIntervalMinutes : this.settings.walkIntervalMinutes;
  }

  private persist(): void {
    this.onPersist?.(this.serialize());
  }

  private emitChanged(): void {
    this.emit('changed', this.getStatus() satisfies ReminderChangedPayload);
  }
}
