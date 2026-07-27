import { EventEmitter } from 'node:events';
import { pickActivityIds } from '../shared/breakActivities';
import type {
  ActiveReminder,
  PreAlertAction,
  ReminderAction,
  ReminderEvent,
  ReminderKind,
  ReminderStatus,
  Settings,
  SingleReminderKind,
  TodoItem
} from '../shared/types';

type ReminderChangedPayload = ReminderStatus;

const MINUTE = 60_000;
const COMBINE_WINDOW_MS = 60_000;
/** Pre-alert "give me a moment" defers the deadline by this long. */
const PRE_ALERT_SNOOZE_MINUTES = 2;
/** How many recently used activity ids to exclude from the next pick. */
const RECENT_ACTIVITY_CAP = 6;
/** setTimeout cannot wait past 2^31-1 ms (~24.8 days); cap for safety. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/**
 * After suspend/resume or unlocking the screen the user needs a moment;
 * overdue reminders wait this long before forcing a window on screen.
 */
const SYSTEM_GRACE_MS = 60_000;
/** Ten minutes away counts as a natural break and restarts both cycles. */
const NATURAL_BREAK_MIN_MS = 10 * MINUTE;
/** Restore sanity bound: anything scheduled further out than this is corrupt. */
const MAX_SCHEDULE_AHEAD_MS = 48 * 60 * MINUTE;

/**
 * Mandatory rest time before 'complete' is accepted in focused mode, owned
 * by the main process. Renderers only count down towards
 * ActiveReminder.unlockAt; gentle/guided modes set unlockAt to the start
 * time so every action is available immediately.
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
  /** Receives one event for each real reminder action or natural break. */
  onEvent?: (event: ReminderEvent) => void;
  /** Resolves the locally computed effective cycle while preserving the user's base settings. */
  getEffectiveIntervals?: (settings: Settings) => {
    eyeMinutes: number;
    walkMinutes: number;
  };
  getEffectiveMode?: (settings: Settings) => Settings['reminderMode'];
  /** One asynchronous scene check, invoked only when a real reminder is due. */
  beforeReminder?: (
    kind: ReminderKind,
    scheduledAt: number
  ) => Promise<ReminderGateDecision>;
  onContextNotification?: (decision: ReminderGateDecision) => void;
}

export interface ReminderGateDecision {
  action: 'show' | 'defer' | 'notify';
  /** Minutes to defer involved kinds; ignored for `show`. */
  deferMinutes?: number;
  reason?: string;
  foregroundApp?: string | null;
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
  /** Deadline value already pre-alerted, per kind; a rescheduled deadline
   * (different value) becomes eligible again automatically. */
  private preAlerted: Partial<Record<SingleReminderKind, number>> = {};
  /** The soft pre-alert currently on screen, if any. */
  private activePreAlert: { kind: SingleReminderKind; forAt: number } | null = null;
  private gatePending: { token: number; kind: ReminderKind; scheduledAt: number } | null = null;
  private gateSequence = 0;
  private consecutiveContextDeferrals = 0;
  /** Recently shown activity ids, to avoid back-to-back repeats. */
  private recentActivityIds: string[] = [];
  private readonly now: () => number;
  private readonly onPersist: ((snapshot: ReminderSnapshot) => void) | null;
  private readonly onEvent: ((event: ReminderEvent) => void) | null;
  private readonly getEffectiveIntervals:
    | ((settings: Settings) => { eyeMinutes: number; walkMinutes: number })
    | null;
  private readonly beforeReminder:
    | ((kind: ReminderKind, scheduledAt: number) => Promise<ReminderGateDecision>)
    | null;
  private readonly getEffectiveMode:
    | ((settings: Settings) => Settings['reminderMode'])
    | null;
  private readonly onContextNotification:
    | ((decision: ReminderGateDecision) => void)
    | null;

  constructor(settings: Settings, options: SchedulerOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
    this.onPersist = options.onPersist ?? null;
    this.onEvent = options.onEvent ?? null;
    this.getEffectiveIntervals = options.getEffectiveIntervals ?? null;
    this.getEffectiveMode = options.getEffectiveMode ?? null;
    this.onContextNotification = options.onContextNotification ?? null;
    this.beforeReminder = options.beforeReminder ?? null;
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
      activeReminder: this.status.activeReminder
        ? {
            ...this.status.activeReminder,
            activityIds: [...this.status.activeReminder.activityIds],
            breakTodo: this.status.activeReminder.breakTodo
              ? { ...this.status.activeReminder.breakTodo }
              : null
          }
        : null,
      preAlert: this.activePreAlert
        ? { kind: this.activePreAlert.kind, firesAt: this.activePreAlert.forAt }
        : null,
      contextDeferral: this.status.contextDeferral
        ? { ...this.status.contextDeferral }
        : null
    };
  }

  updateSettings(settings: Settings, previous: Settings): ReminderStatus {
    const now = this.now();
    const previousIntervals = this.effectiveIntervals(previous);
    this.settings = settings;
    const nextIntervals = this.effectiveIntervals(settings);

    if (!this.status.activeReminder) {
      if (nextIntervals.eyeMinutes !== previousIntervals.eyeMinutes) {
        this.status.nextEyeAt = now + nextIntervals.eyeMinutes * MINUTE;
      }
      if (nextIntervals.walkMinutes !== previousIntervals.walkMinutes) {
        this.status.nextWalkAt = now + nextIntervals.walkMinutes * MINUTE;
      }
    }
    // Deadlines may have moved (or the lead time changed): any pending
    // pre-alert refers to an old schedule.
    this.activePreAlert = null;
    this.cancelPendingGate();

    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  /**
   * Todo changes must not reschedule or broadcast reminder state. They only
   * refresh the pool used the next time a walk reminder selects an away task.
   */
  updateTodos(todos: TodoItem[]): void {
    this.settings = {
      ...this.settings,
      todos: todos.map((todo) => ({ ...todo }))
    };
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
      this.onEvent?.({
        timestamp: now,
        kind: active.kind,
        scheduledAt: active.scheduledAt,
        shownAt: active.startedAt,
        action,
        snoozeCount: action === 'snooze' ? active.snoozeCount + 1 : active.snoozeCount,
        mode: active.mode
      });
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

  /**
   * Act on the soft pre-alert bubble:
   * - 'start': open the real reminder right now (the other kind can still
   *   fold in through the combine window).
   * - 'snooze': push just that kind's deadline back a couple of minutes so
   *   the user can finish the sentence they were writing.
   * - 'dismiss': keep the plan; the deadline (and the marker) stay put, so
   *   the bubble does not reappear for the same cycle.
   * No-op when no pre-alert is showing.
   */
  handlePreAlertAction(action: PreAlertAction): ReminderStatus {
    const preAlert = this.activePreAlert;
    if (!preAlert) {
      return this.getStatus();
    }
    const now = this.now();
    this.activePreAlert = null;

    if (action === 'start') {
      this.beginReminder(preAlert.kind, false, preAlert.forAt);
    } else if (action === 'snooze') {
      this.scheduleKind(preAlert.kind, PRE_ALERT_SNOOZE_MINUTES, now);
    }

    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  triggerTest(kind: ReminderKind): ReminderStatus {
    // A settings-window test must never replace a real reminder that is
    // already in progress (or another test the user is currently handling).
    if (this.status.activeReminder) {
      return this.getStatus();
    }
    this.beginReminder(kind, true, this.now());
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
    this.beginReminder(kind, false, this.now());
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
    this.activePreAlert = null;
    this.cancelPendingGate();
    this.status.contextDeferral = null;
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
    // Deadlines moved earlier: drop a pre-alert aimed at the old schedule.
    this.activePreAlert = null;
    this.status.contextDeferral = null;
    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  /** Discard pause and progress; both cycles start over from now. */
  restartCycle(): ReminderStatus {
    const now = this.now();
    const intervals = this.effectiveIntervals();
    this.status.pausedUntil = null;
    this.frozen = null;
    this.snoozeCount = 0;
    this.status.activeReminder = null;
    this.activeIsTest = false;
    this.activePreAlert = null;
    this.cancelPendingGate();
    this.status.contextDeferral = null;
    this.status.nextEyeAt = now + intervals.eyeMinutes * MINUTE;
    this.status.nextWalkAt = now + intervals.walkMinutes * MINUTE;
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
    const intervals = this.effectiveIntervals();

    if (!this.status.pausedUntil && idleMs >= NATURAL_BREAK_MIN_MS) {
      const eyeDue = this.status.nextEyeAt <= now;
      const walkDue = this.status.nextWalkAt <= now;
      const naturalKind: ReminderKind =
        eyeDue && walkDue
          ? 'combined'
          : eyeDue
            ? 'eye'
            : walkDue
              ? 'walk'
              : this.status.nextEyeAt <= this.status.nextWalkAt
                ? 'eye'
                : 'walk';
      this.onEvent?.({
        timestamp: now,
        kind: naturalKind,
        scheduledAt:
          naturalKind === 'combined'
            ? Math.min(this.status.nextEyeAt, this.status.nextWalkAt)
            : this.nextAtFor(naturalKind),
        shownAt: now,
        action: 'natural-break',
        snoozeCount: this.snoozeCount,
        mode: this.settings.reminderMode
      });
      this.status.nextEyeAt = now + intervals.eyeMinutes * MINUTE;
      this.status.nextWalkAt = now + intervals.walkMinutes * MINUTE;
      this.snoozeCount = 0;
      this.status.activeReminder = null;
      this.activeIsTest = false;
      this.activePreAlert = null;
      this.cancelPendingGate();
      this.status.contextDeferral = null;
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
      return {
        nextEyeAt,
        nextWalkAt,
        pausedUntil,
        activeReminder: null,
        preAlert: null,
        contextDeferral: null
      };
    }

    const intervals = this.effectiveIntervals();
    return {
      nextEyeAt: now + intervals.eyeMinutes * MINUTE,
      nextWalkAt: now + intervals.walkMinutes * MINUTE,
      pausedUntil: null,
      activeReminder: null,
      preAlert: null,
      contextDeferral: null
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
    if (this.gatePending) {
      return null;
    }
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
      } else if (!this.activePreAlert) {
        // Soft pre-alert lead times. Excluded while paused (a lead time
        // before pause-end would re-arm a zero-delay timer forever) and
        // while a pre-alert is already up (we wait for the deadline or a
        // user action, not for the next kind's lead time).
        const preMs = this.preAlertMs();
        if (preMs > 0) {
          for (const kind of ['eye', 'walk'] as SingleReminderKind[]) {
            const at = this.nextAtFor(kind);
            if (this.preAlerted[kind] !== at) {
              candidates.push(at - preMs);
            }
          }
        }
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

    this.markAndMaybeShowPreAlert(now);

    const eyeDue = this.status.nextEyeAt <= now;
    const walkDue = this.status.nextWalkAt <= now;
    const eyeNear = this.status.nextEyeAt <= now + COMBINE_WINDOW_MS;
    const walkNear = this.status.nextWalkAt <= now + COMBINE_WINDOW_MS;

    if ((eyeDue && walkNear) || (walkDue && eyeNear)) {
      this.requestReminder(
        'combined',
        Math.min(this.status.nextEyeAt, this.status.nextWalkAt)
      );
      return;
    }

    if (eyeDue) {
      this.requestReminder('eye', this.status.nextEyeAt);
      return;
    }

    if (walkDue) {
      this.requestReminder('walk', this.status.nextWalkAt);
    }
  }

  /**
   * Soft pre-alert (USERPLAN §一.2): once per deadline, a bubble asks whether
   * to start the break early. Marking happens even when the lead window was
   * missed (late resume/unlock) so the stale candidate never re-arms a
   * zero-delay timer. When several kinds are eligible, the nearest deadline
   * gets the bubble.
   */
  private markAndMaybeShowPreAlert(now: number): void {
    const preMs = this.preAlertMs();
    if (preMs <= 0 || this.activePreAlert) {
      return;
    }
    let candidate: SingleReminderKind | null = null;
    for (const kind of ['eye', 'walk'] as SingleReminderKind[]) {
      const at = this.nextAtFor(kind);
      if (this.preAlerted[kind] === at || at - preMs > now) {
        continue;
      }
      this.preAlerted[kind] = at;
      if (at > now && (candidate === null || at < this.nextAtFor(candidate))) {
        candidate = kind;
      }
    }
    if (candidate) {
      this.activePreAlert = { kind: candidate, forAt: this.nextAtFor(candidate) };
      this.emitChanged();
    }
  }

  private preAlertMs(): number {
    const seconds = this.settings.preAlertSeconds;
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
  }

  private beginReminder(kind: ReminderKind, isTest: boolean, scheduledAt: number): void {
    this.cancelPendingGate();
    const now = this.now();
    const mode = this.getEffectiveMode?.(this.settings) ?? this.settings.reminderMode;
    // Only focused mode enforces the rest wait; gentle/guided unlock at once.
    const unlockAt = mode === 'focused' ? now + COMPLETE_WAIT_MS[kind] : now;
    const active: ActiveReminder = {
      id: `${now}-${++this.sequence}`,
      kind,
      kinds: reminderKindsFor(kind),
      startedAt: now,
      scheduledAt,
      unlockAt,
      // Focused mode: first snooze of a cycle is immediate, later ones wait
      // out the countdown. Other modes never lock snooze.
      snoozeAllowedAt: mode === 'focused' && !isTest && this.snoozeCount > 0 ? unlockAt : now,
      mode,
      snoozeCount: isTest ? 0 : this.snoozeCount,
      activityIds: this.pickActivities(kind),
      breakTodo: kind === 'walk' || kind === 'combined' ? this.pickBreakTodo() : null
    };
    this.activeIsTest = isTest;
    this.activePreAlert = null;
    this.status.contextDeferral = null;
    this.status.activeReminder = active;
    this.emitChanged();
  }

  /**
   * Real due reminders pass through one asynchronous scene check. Manual and
   * test reminders intentionally bypass this gate. After three consecutive
   * automatic deferrals we show the reminder gently instead of suppressing it
   * forever.
   */
  private requestReminder(kind: ReminderKind, scheduledAt: number): void {
    if (!this.beforeReminder) {
      this.consecutiveContextDeferrals = 0;
      this.beginReminder(kind, false, scheduledAt);
      return;
    }
    if (this.gatePending) {
      return;
    }
    const token = ++this.gateSequence;
    this.gatePending = { token, kind, scheduledAt };
    this.activePreAlert = null;
    void this.beforeReminder(kind, scheduledAt)
      .then((decision) => {
        if (this.gatePending?.token !== token || this.status.activeReminder) {
          return;
        }
        this.gatePending = null;
        const now = this.now();
        if (
          (decision.action === 'defer' || decision.action === 'notify') &&
          this.consecutiveContextDeferrals < 3
        ) {
          const deferMinutes = Math.min(
            24 * 60,
            Math.max(1, Math.round(decision.deferMinutes ?? 5))
          );
          for (const involvedKind of reminderKindsFor(kind)) {
            this.scheduleKind(involvedKind, deferMinutes, now);
          }
          this.consecutiveContextDeferrals += 1;
          this.status.contextDeferral = {
            until: now + deferMinutes * MINUTE,
            reason: decision.reason?.trim() || '当前场景已自动延后提醒',
            foregroundApp: decision.foregroundApp?.trim() || null,
            consecutiveCount: this.consecutiveContextDeferrals
          };
          if (decision.action === 'notify') {
            this.onContextNotification?.(decision);
          }
          this.emitChanged();
          this.persist();
          this.armTimer();
          return;
        }
        this.consecutiveContextDeferrals = 0;
        this.beginReminder(kind, false, scheduledAt);
        this.persist();
        this.armTimer();
      })
      .catch(() => {
        if (this.gatePending?.token !== token || this.status.activeReminder) {
          return;
        }
        this.gatePending = null;
        this.consecutiveContextDeferrals = 0;
        this.beginReminder(kind, false, scheduledAt);
        this.persist();
        this.armTimer();
      });
  }

  /** Pick one activity per involved kind, skipping recently shown ones. */
  private pickActivities(kind: ReminderKind): string[] {
    const ids = pickActivityIds(kind, this.recentActivityIds);
    this.recentActivityIds = [...this.recentActivityIds, ...ids].slice(-RECENT_ACTIVITY_CAP);
    return ids;
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
    active.scheduledAt = Math.min(
      active.scheduledAt,
      this.status.nextEyeAt,
      this.status.nextWalkAt
    );
    active.breakTodo ??= this.pickBreakTodo();
    // The absorbed kind gets its own activity suggestion too.
    const missing = active.kinds.filter(
      (kind) => !active.activityIds.some((id) => id.startsWith(kind))
    );
    for (const kind of missing) {
      active.activityIds = [...active.activityIds, ...this.pickActivities(kind)];
    }
    if (active.mode === 'focused') {
      // Extend the enforced rest to the combined duration (counted from the
      // reminder's start) — this is what the renderer countdown must reflect.
      // Gentle/guided reminders stay unlocked.
      const unlockAt = active.startedAt + COMPLETE_WAIT_MS.combined;
      if (unlockAt > active.unlockAt) {
        active.unlockAt = unlockAt;
      }
      if (active.snoozeCount > 0) {
        active.snoozeAllowedAt = Math.max(active.snoozeAllowedAt, active.unlockAt);
      }
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

  private pickBreakTodo(): Pick<TodoItem, 'id' | 'text'> | null {
    const priorityRank = { urgent: 0, important: 1, normal: 2 } as const;
    const todo = this.settings.todos
      .filter((entry) => !entry.completed && entry.remindOnBreak && entry.context === 'away')
      .sort(
        (a, b) =>
          priorityRank[a.priority] - priorityRank[b.priority] ||
          a.createdAt - b.createdAt
      )[0];
    return todo ? { id: todo.id, text: todo.text } : null;
  }

  private intervalFor(kind: SingleReminderKind): number {
    const intervals = this.effectiveIntervals();
    return kind === 'eye' ? intervals.eyeMinutes : intervals.walkMinutes;
  }

  private effectiveIntervals(settings: Settings = this.settings): {
    eyeMinutes: number;
    walkMinutes: number;
  } {
    const computed = this.getEffectiveIntervals?.(settings);
    return {
      eyeMinutes:
        computed && Number.isFinite(computed.eyeMinutes)
          ? Math.max(1, Math.round(computed.eyeMinutes))
          : settings.eyeIntervalMinutes,
      walkMinutes:
        computed && Number.isFinite(computed.walkMinutes)
          ? Math.max(1, Math.round(computed.walkMinutes))
          : settings.walkIntervalMinutes
    };
  }

  private cancelPendingGate(): void {
    if (this.gatePending) {
      this.gatePending = null;
      this.gateSequence += 1;
    }
  }

  private persist(): void {
    this.onPersist?.(this.serialize());
  }

  private emitChanged(): void {
    this.emit('changed', this.getStatus() satisfies ReminderChangedPayload);
  }
}
