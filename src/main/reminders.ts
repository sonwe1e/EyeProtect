import { EventEmitter } from 'node:events';
import { pickActivityIds } from '../shared/breakActivities';
import type { ScheduledEvent, SchedulerKernel } from './scheduling/kernel';
import type { AppWindows } from './windows';
import type {
  ActiveReminder,
  PersistedBreakSession,
  PreAlertAction,
  ReminderAction,
  ReminderEvent,
  ReminderKind,
  ReminderStatus,
  Settings,
  SingleReminderKind,
  Task,
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
/** Restore sanity bound: anything scheduled further out than this is corrupt. */
const MAX_SCHEDULE_AHEAD_MS = 48 * 60 * MINUTE;
/**
 * A persisted break session is only worth recovering while the enforcement
 * window is still live. Past this past unlockAt the user has either long since
 * rested or walked away, so the session is dropped and the normal deadline
 * reconcile fires instead (a focused eye break's wait is 30s, walk 60s).
 */
const ACTIVE_SESSION_RECOVERY_GRACE_MS = 10 * MINUTE;

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
  /**
   * The in-progress break session at the time of the last write, if any. Lets a
   * restart recover a focused break mid-enforcement instead of recomputing from
   * a stale deadline (USERPLAN §一.3). Null when no reminder is active.
   */
  active?: PersistedBreakSession | null;
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
  /**
   * Shared deadline queue. When provided, the scheduler delegates its single
   * timer to the kernel instead of managing its own `setTimeout`, so break,
   * alarm and task deadlines share one timer and one watchdog. The scheduler
   * keeps all its business logic; it only reports its next deadline and gets
   * woken to reconcile. When omitted, the scheduler manages its own timer
   * exactly as before (so existing behaviour and tests are unchanged).
   */
  kernel?: SchedulerKernel;
  /** Structured lifecycle trace for missed-reminder diagnostics. */
  trace?: (event: string, data?: Record<string, unknown>) => void;
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
  private kernelRevision = 0;
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
  private tasks: Task[] = [];
  private readonly kernel: SchedulerKernel | null;
  private readonly kernelEvents: ScheduledEvent[] = [];
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
  private readonly trace: (event: string, data?: Record<string, unknown>) => void;

  constructor(settings: Settings, options: SchedulerOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
    this.onPersist = options.onPersist ?? null;
    this.onEvent = options.onEvent ?? null;
    this.getEffectiveIntervals = options.getEffectiveIntervals ?? null;
    this.getEffectiveMode = options.getEffectiveMode ?? null;
    this.onContextNotification = options.onContextNotification ?? null;
    this.beforeReminder = options.beforeReminder ?? null;
    this.trace = options.trace ?? (() => {});
    this.kernel = options.kernel ?? null;
    this.settings = settings;
    this.status = this.initialStatus(options.restore ?? null);
    if (this.kernel) {
      // The kernel wakes us to reconcile; the scheduler then re-reports its
      // next deadline via armTimer(). No per-deadline handler registration:
      // the scheduler always reports a single "next" candidate.
      this.kernel.on('wake', (owner, due) => {
        if (owner === 'break') {
          this.reconcile();
        }
      });
      this.kernel.on('drift', (delta: number) => this.handleWallClockDrift(delta));
    }
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
            breakTask: this.status.activeReminder.breakTask
              ? { ...this.status.activeReminder.breakTask }
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
    void previous;
    this.settings = settings;
    // A cycle is fixed when it starts. Interval edits are preferences for the
    // next complete cycle; restartCycle() is the explicit "apply now" action.
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

  updateTasks(tasks: Task[]): void {
    this.tasks = tasks.map((task) => ({ ...task, tags: [...task.tags] }));
  }

  handleAction(action: ReminderAction, reminderId: string): ReminderStatus {
    const active = this.status.activeReminder;
    if (!active || active.id !== reminderId) {
      return this.getStatus();
    }

    const now = this.now();
    this.trace('action', { reminderId, action, kind: active.kind });
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

    this.emit('action', { action, reminder: { ...active }, isTest: this.activeIsTest });

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
    // already in progress (or another test the user is currently handling),
    // and must not pull the user out of a pause they deliberately started.
    if (this.status.activeReminder || this.status.pausedUntil) {
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
    // "Take a break now" is suppressed while one is already in progress or
    // while a pause is active: a paused schedule should stay paused until the
    // user explicitly resumes, not be overridden by the manual trigger.
    if (this.status.activeReminder || this.status.pausedUntil) {
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
    const pausedUntil = now + pauseMinutes * MINUTE;

    // Already paused: extend the hold instead of recomputing the frozen
    // remainder. Recomputing from nextEyeAt/nextWalkAt would fold the first
    // pause's extension back into frozen and inflate the remainder (a second
    // pause while paused must never push the deadline further out than the
    // new pause-end plus the original frozen time).
    if (this.status.pausedUntil && this.frozen) {
      this.status.pausedUntil = Math.max(this.status.pausedUntil, pausedUntil);
      this.status.nextEyeAt = this.status.pausedUntil + this.frozen.eyeMs;
      this.status.nextWalkAt = this.status.pausedUntil + this.frozen.walkMs;
      this.status.activeReminder = null;
      this.activeIsTest = false;
      this.activePreAlert = null;
      this.cancelPendingGate();
      this.status.contextDeferral = null;
      this.snoozeCount = 0;
      this.emitChanged();
      this.persist();
      this.armTimer();
      return this.getStatus();
    }

    this.frozen = {
      eyeMs: Math.max(0, this.status.nextEyeAt - now),
      walkMs: Math.max(0, this.status.nextWalkAt - now)
    };
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
    const idleMs = Math.max(0, idleSeconds) * 1_000;
    return this.handleActivityResume(idleMs);
  }

  /** Continue after idle/lock/suspend without counting inactive time. */
  handleActivityResume(inactiveMs: number): ReminderStatus {
    const now = this.now();
    const safeInactiveMs = Math.max(0, inactiveMs);
    const intervals = this.effectiveIntervals();

    if (safeInactiveMs >= (this.settings.naturalBreakMinutes ?? 5) * MINUTE) {
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
      this.status.pausedUntil = null;
      this.frozen = null;
    } else if (!this.status.activeReminder && safeInactiveMs > 0) {
      this.status.nextEyeAt += safeInactiveMs;
      this.status.nextWalkAt += safeInactiveMs;
      if (this.status.pausedUntil !== null) {
        this.status.pausedUntil += safeInactiveMs;
      }
      if (this.activePreAlert) {
        this.activePreAlert.forAt += safeInactiveMs;
      }
    }

    this.quietUntil = now + SYSTEM_GRACE_MS;
    this.emitChanged();
    this.persist();
    this.armTimer();
    return this.getStatus();
  }

  /** Keep renderer-facing epoch timestamps aligned when the civil clock jumps. */
  private handleWallClockDrift(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    this.status.nextEyeAt += delta;
    this.status.nextWalkAt += delta;
    if (this.status.pausedUntil !== null) {
      this.status.pausedUntil += delta;
    }
    if (this.activePreAlert) {
      this.activePreAlert.forAt += delta;
    }
    if (this.status.activeReminder) {
      this.status.activeReminder.startedAt += delta;
      this.status.activeReminder.scheduledAt += delta;
      this.status.activeReminder.unlockAt += delta;
      this.status.activeReminder.snoozeAllowedAt += delta;
    }
    this.quietUntil += delta;
    this.emitChanged();
    this.persist();
    this.armTimer();
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
      frozenWalkMs: this.frozen?.walkMs ?? null,
      active: this.activeSession()
    };
  }

  /**
   * Snapshot the active reminder for persistence, dropping the transient
   * per-event id. Returns null when nothing is active. Persisted separately
   * from the deadlines so a restart can recover a break mid-enforcement.
   */
  activeSession(): PersistedBreakSession | null {
    const active = this.status.activeReminder;
    if (!active) {
      return null;
    }
    return {
      kind: active.kind,
      kinds: [...active.kinds],
      startedAt: active.startedAt,
      scheduledAt: active.scheduledAt,
      unlockAt: active.unlockAt,
      snoozeAllowedAt: active.snoozeAllowedAt,
      mode: active.mode,
      snoozeCount: active.snoozeCount,
      activityIds: [...active.activityIds],
      breakTask: active.breakTask ? { ...active.breakTask } : null
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
      // A paused schedule never coexists with an active break.
      const activeReminder = pausedUntil === null ? this.restoreActiveSession(restore, now) : null;
      return {
        nextEyeAt,
        nextWalkAt,
        pausedUntil,
        activeReminder,
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

  /**
   * Reconstruct an ActiveReminder from a persisted break session, or null if the
   * session is corrupt or its enforcement window has lapsed (the user has long
   * since rested, so recovering it would be surprising). A recovered session
   * keeps its original timing but gets a fresh per-event id.
   */
  private restoreActiveSession(
    snapshot: ReminderSnapshot,
    now: number
  ): ActiveReminder | null {
    const persisted = snapshot.active;
    if (!persisted) {
      return null;
    }
    const recovered = this.sanitizePersistedSession(persisted);
    if (!recovered) {
      return null;
    }
    // Only recover while the enforcement window is still live: a focused break
    // that unlocked minutes ago is stale, and the normal deadline reconcile is
    // the right recovery path then.
    if (recovered.unlockAt + ACTIVE_SESSION_RECOVERY_GRACE_MS < now) {
      return null;
    }
    return {
      ...recovered,
      id: `${now}-${++this.sequence}`
    };
  }

  /** Validate and normalize a persisted break session; null if unusable. */
  private sanitizePersistedSession(
    value: PersistedBreakSession | null | undefined
  ): PersistedBreakSession | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    if (
      !Number.isFinite(value.startedAt) ||
      !Number.isFinite(value.scheduledAt) ||
      !Number.isFinite(value.unlockAt) ||
      !Number.isFinite(value.snoozeAllowedAt)
    ) {
      return null;
    }
    const kinds = Array.isArray(value.kinds)
      ? value.kinds.filter((k): k is SingleReminderKind => k === 'eye' || k === 'walk')
      : [];
    const activityIds = Array.isArray(value.activityIds)
      ? value.activityIds.filter((id): id is string => typeof id === 'string')
      : [];
    const breakTask =
      value.breakTask && typeof value.breakTask === 'object' && typeof value.breakTask.id === 'string'
        ? { id: value.breakTask.id, title: String(value.breakTask.title ?? '') }
        : null;
    return {
      kind: value.kind === 'walk' || value.kind === 'combined' ? value.kind : 'eye',
      kinds: kinds.length > 0 ? kinds : (value.kind === 'combined' ? ['eye', 'walk'] : [value.kind]),
      startedAt: value.startedAt,
      scheduledAt: value.scheduledAt,
      unlockAt: value.unlockAt,
      snoozeAllowedAt: value.snoozeAllowedAt,
      mode: value.mode === 'gentle' || value.mode === 'guided' || value.mode === 'focused' ? value.mode : 'guided',
      snoozeCount: Number.isInteger(value.snoozeCount) && value.snoozeCount >= 0 ? value.snoozeCount : 0,
      activityIds,
      breakTask
    };
  }

  private disarm(): void {
    if (this.kernel) {
      // The kernel owns the timer; clearing our deadlines disarms it.
      this.kernel.set('break', []);
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private armTimer(): void {
    const now = this.now();
    const deadline = this.nextDeadline(now);

    if (this.kernel) {
      // Delegate timing to the shared kernel: report the single nearest
      // candidate as a 'break' deadline and let the kernel own the actual
      // setTimeout. When nothing is pending (gate in flight) report nothing;
      // the kernel disarms until we re-arm after the gate resolves.
      if (deadline === null) {
        this.kernel.set('break', []);
        return;
      }
      this.kernelEvents.length = 0;
      this.kernelEvents.push({
        id: 'break-next',
        owner: 'break',
        type: 'deadline',
        clock: 'elapsed',
        fireAt: deadline,
        revision: ++this.kernelRevision
      });
      this.kernel.set('break', this.kernelEvents);
      this.trace('scheduled', { owner: 'break', fireAt: deadline });
      return;
    }

    this.disarm();
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
      breakTask: kind === 'walk' || kind === 'combined' ? this.pickBreakTask() : null
    };
    this.activeIsTest = isTest;
    this.activePreAlert = null;
    this.status.contextDeferral = null;
    this.status.activeReminder = active;
    this.trace('shown-requested', {
      reminderId: active.id,
      kind,
      scheduledAt,
      shownAt: now,
      mode
    });
    this.emitChanged();
  }

  /**
   * Real due reminders pass through one asynchronous scene check. Manual and
   * test reminders intentionally bypass this gate. After three consecutive
   * automatic deferrals we show the reminder gently instead of suppressing it
   * forever.
   */
  private requestReminder(kind: ReminderKind, scheduledAt: number): void {
    this.trace('gate', { kind, scheduledAt, enabled: Boolean(this.beforeReminder) });
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
          this.trace('deferred', {
            kind,
            scheduledAt,
            until: now + deferMinutes * MINUTE,
            action: decision.action,
            reason: decision.reason
          });
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
    active.breakTask ??= this.pickBreakTask();
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
    this.trace('rescheduled', { kind, minutes, from, fireAt: nextAt });
  }

  private pickBreakTask(): Pick<Task, 'id' | 'title'> | null {
    const priorityRank = { urgent: 0, important: 1, normal: 2 } as const;
    const task = this.tasks
      .filter((entry) =>
        entry.status !== 'done' &&
        entry.status !== 'archived' &&
        entry.remindOnBreak &&
        (entry.context === 'away' || entry.context === 'any')
      )
      .sort(
        (a, b) =>
          priorityRank[a.priority] - priorityRank[b.priority] ||
          (a.plannedAt ?? Infinity) - (b.plannedAt ?? Infinity) ||
          a.sortOrder - b.sortOrder
      )[0];
    return task ? { id: task.id, title: task.title } : null;
  }

  /**
   * v1.1 Rhythm integration (USERPLAN §四). A task's `reminderAt` fired. Task
   * reminders never steal focus from an in-flight break: if a reminder is active
   * we fold the task copy into it (a walk/combined reminder can surface an
   * away-context task) and/or emit a native notification; otherwise we just
   * notify. This is the plan's "task + walk should not fight for focus" rule.
   *
   * `getAwayTasks` supplies live away-context tasks so a walk reminder can
   * suggest one even when the legacy todo list is empty.
   */
  queueTaskReminders(
    due: Task[],
    windows: AppWindows,
    getAwayTasks: () => Task[] = () => []
  ): void {
    if (due.length === 0) {
      return;
    }
    const active = this.status.activeReminder;
    if (active && (active.kind === 'walk' || active.kind === 'combined')) {
      // A walk is already up: if it lacks an away suggestion and one of the due
      // tasks is an away/any-context task, attach it so the card shows the
      // "while you're up, consider…" prompt without opening a second surface.
      if (!active.breakTask) {
        const suggestion = due.find((task) =>
          task.remindOnBreak && (task.context === 'away' || task.context === 'any')
        );
        if (suggestion) {
          active.breakTask = { id: suggestion.id, title: suggestion.title };
          windows.broadcastReminderStatus(this.getStatus());
        }
      }
      return;
    }
    // No in-flight break (or an eye-only break): surface via native
    // notification so we never pop a window over the user's current work.
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
