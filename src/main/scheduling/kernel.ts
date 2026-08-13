import { EventEmitter } from 'node:events';

/**
 * SchedulerKernel — the single deadline queue behind every timed event in the
 * app (eye/walk reminders, standalone reminders, task reminders, pause expiry).
 * It owns ONE
 * `setTimeout` fired at the nearest deadline, plus a low-frequency watchdog
 * that detects wall-clock drift and reconciles after suspend/resume/unlock.
 *
 * Design (see USERPLAN §四.A):
 *   nearest deadline → one setTimeout
 *     + wall-clock / monotonic-clock drift detection (watchdog)
 *     + powerMonitor resume/unlock reconcile
 *     + startup reconcile
 *
 * Services (breaks, task reminders, standalone reminders, …) report their next
 * deadline; the kernel never knows what a deadline *means* — only when the
 * next one is and who to wake.
 */

/** A deadline owned by some service. */
export interface ScheduledEvent {
  /** Stable per-deadline id so a service can replace/cancel a specific one. */
  id: string
  /** Which service owns this deadline; routes the wake callback. */
  owner: string
  /** Machine-readable kind, scoped to the owner (e.g. 'eye', 'walk', 'alarm'). */
  type: string
  /** Epoch ms at which this deadline fires. */
  fireAt: number
  /**
   * Wall events follow the civil clock. Elapsed events retain the amount of
   * active-use time that remained when they were registered and are immune to
   * wall-clock corrections. Omitted for backwards compatibility with the
   * existing wall-clock services.
   */
  clock?: 'wall' | 'elapsed'
  /**
   * Bumped every time the service re-registers the same id. Lets the kernel
   * ignore a wake that targets a deadline the service has already superseded.
   */
  revision: number
}

/** Monotonic+wall clock pair, injected so tests stay deterministic. */
export interface KernelClock {
  /** Wall-clock epoch ms (Date.now semantics). */
  now: () => number
  /** Monotonic ms since an arbitrary origin; must never go backwards. */
  monotonic: () => number
}

export interface SchedulerKernelOptions {
  clock?: KernelClock
  /**
   * How often the watchdog recomputes drift. 30s is plenty: the exact timer
   * handles precision, the watchdog only catches the cases the timer can't
   * (wall-clock changes, a suspended system that skipped a deadline).
   */
  watchdogIntervalMs?: number
  /**
   * Drift (ms) between wall-clock elapsed and monotonic elapsed beyond which
   * we treat the wall clock as having jumped and force a reconcile. Must be
   * larger than the watchdog interval so normal ticks don't false-positive.
   */
  driftThresholdMs?: number
  /** Receives a rolling trace of kernel decisions for diagnostics/telemetry. */
  trace?: (message: string, data?: Record<string, unknown>) => void
  /** Local timezone offset source, injectable for deterministic tests. */
  getTimezoneOffset?: () => number
}

interface RegisteredEvent extends ScheduledEvent {
  /** Absolute monotonic ms used by elapsed-domain deadlines. */
  monotonicFireAt: number
}

const DEFAULT_WATCHDOG_INTERVAL_MS = 30_000;
const DEFAULT_DRIFT_THRESHOLD_MS = 10_000;
/** setTimeout cannot wait past ~24.8 days; clamp for safety. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export class SchedulerKernel extends EventEmitter {
  private readonly clock: KernelClock;
  private readonly watchdogIntervalMs: number;
  private readonly driftThresholdMs: number;
  private readonly trace: (message: string, data?: Record<string, unknown>) => void;
  private readonly getTimezoneOffset: () => number;

  /** All currently pending deadlines. */
  private events: RegisteredEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private running = false;
  /** When suspended, set()/clear() mutate state but never re-arm the timer. */
  private suspended = false;
  /** Monotonic instant at which active-use time was frozen. */
  private elapsedPausedAt: number | null = null;

  /** Baseline for drift detection, refreshed on every arm and watchdog tick. */
  private lastWall = 0;
  private lastMonotonic = 0;
  private lastTimezoneOffset = 0;

  constructor(options: SchedulerKernelOptions = {}) {
    super();
    this.clock = options.clock ?? {
      now: Date.now,
      monotonic: monotonicNow
    };
    this.watchdogIntervalMs = Math.min(
      MAX_TIMEOUT_MS,
      options.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS
    );
    this.driftThresholdMs = options.driftThresholdMs ?? DEFAULT_DRIFT_THRESHOLD_MS;
    this.trace = options.trace ?? (() => {});
    this.getTimezoneOffset = options.getTimezoneOffset ?? (() => new Date().getTimezoneOffset());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastWall = this.clock.now();
    this.lastMonotonic = this.clock.monotonic();
    this.lastTimezoneOffset = this.getTimezoneOffset();
    this.trace('kernel start');
    this.arm();
    this.startWatchdog();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.stopWatchdog();
    this.disarm();
    this.trace('kernel stop');
  }

  /**
   * Replace the full set of deadlines for one owner (the service's canonical
   * "here is everything I'm waiting on" snapshot). Simpler and less error-prone
   * than incremental add/remove across every state transition.
   */
  set(owner: string, events: ScheduledEvent[]): void {
    this.events = [
      ...this.events.filter((event) => event.owner !== owner),
      ...events.map((event) => this.registered(event))
    ];
    this.trace('kernel set', { owner, count: events.length });
    this.arm();
  }

  /** Drop every deadline owned by `owner` (e.g. on dispose). */
  clear(owner: string): void {
    const before = this.events.length;
    this.events = this.events.filter((event) => event.owner !== owner);
    if (this.events.length !== before) {
      this.trace('kernel clear', { owner, removed: before - this.events.length });
      this.arm();
    }
  }

  /** All currently pending deadlines (deep-ish copy for inspection/tests). */
  peek(): ScheduledEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  /**
   * System is about to sleep. Drop the timer — it would either misfire or fire
   * at the wrong wall-clock time mid-suspend. Events stay registered so resume()
   * can reconcile whatever the sleep skipped. The watchdog is left running; it
   * is frozen along with the event loop during sleep and harmless on wake.
   */
  suspend(): void {
    this.disarm();
    this.suspended = true;
    this.pauseElapsed();
    this.trace('kernel suspend');
  }

  /**
   * System woke up. idleMs is how long the user was away; reconcile fires any
   * deadline the sleep skipped (so a reminder or alarm that came due while the
   * machine slept is not silently dropped) and re-arms the exact timer.
   */
  resume(idleMs: number): void {
    this.suspended = false;
    this.resumeElapsed();
    this.trace('kernel resume', { idleMs });
    this.reconcile();
  }

  /** Freeze elapsed-domain deadlines while leaving wall events eligible. */
  pauseElapsed(): void {
    if (this.elapsedPausedAt !== null) {
      return;
    }
    this.elapsedPausedAt = this.clock.monotonic();
    this.trace('kernel elapsed pause');
    this.arm();
  }

  /** Continue elapsed deadlines without counting the frozen duration. */
  resumeElapsed(): void {
    if (this.elapsedPausedAt === null) {
      return;
    }
    const pausedFor = Math.max(0, this.clock.monotonic() - this.elapsedPausedAt);
    for (const event of this.events) {
      if (event.clock === 'elapsed') {
        event.monotonicFireAt += pausedFor;
        event.fireAt += pausedFor;
      }
    }
    this.elapsedPausedAt = null;
    this.trace('kernel elapsed resume', { pausedFor });
    this.arm();
  }

  /**
   * Force a reconcile pass right now: fire every deadline that is due. Used
   * after the wall clock jumps or the system resumes and the exact timer may
   * have nothing armed for the new "now".
   */
  reconcile(): void {
    this.trace('kernel reconcile');
    this.fireDue();
    this.arm();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private registered(event: ScheduledEvent): RegisteredEvent {
    const fireAt = event.fireAt;
    // Map the wall-clock fire time onto the monotonic timeline so the watchdog
    // can detect when wall and monotonic diverge.
    const monotonicFireAt =
      this.clock.monotonic() + Math.max(0, fireAt - this.clock.now());
    return { ...event, clock: event.clock ?? 'wall', monotonicFireAt };
  }

  private remaining(event: RegisteredEvent): number {
    return event.clock === 'elapsed'
      ? event.monotonicFireAt - (this.elapsedPausedAt ?? this.clock.monotonic())
      : event.fireAt - this.clock.now();
  }

  /** Arm (or re-arm) the single timer to the nearest due deadline. */
  private arm(): void {
    this.disarm();
    // While suspended the event loop is about to freeze; a timer armed now would
    // either misfire or fire at the wrong wall-clock time. set()/clear() still
    // record state, but the actual timer is (re-)armed only on resume().
    if (this.suspended || !this.running || this.events.length === 0) {
      return;
    }
    let delay = Infinity;
    for (const event of this.events) {
      if (event.clock === 'elapsed' && this.elapsedPausedAt !== null) {
        continue;
      }
      delay = Math.min(delay, Math.max(0, this.remaining(event)));
    }
    if (delay === Infinity) {
      return;
    }
    delay = Math.min(MAX_TIMEOUT_MS, delay);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fireDue();
      this.arm();
    }, delay);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  private disarm(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Fire every deadline whose time has come, then let callers re-arm via set(). */
  private fireDue(): void {
    // A stopped kernel is inert: its timer is disarmed and it must not fire,
    // even if reconcile() is called after stop(). start() re-enables firing.
    if (!this.running || this.events.length === 0) {
      return;
    }
    const due: RegisteredEvent[] = [];
    const remaining: RegisteredEvent[] = [];
    for (const event of this.events) {
      // Past deadlines (including ones the wall clock jumped past) always fire;
      // a service that no longer cares for one drops it on its next set().
      const elapsedFrozen = event.clock === 'elapsed' && this.elapsedPausedAt !== null;
      if (!elapsedFrozen && this.remaining(event) <= 0) {
        due.push(event);
      } else {
        remaining.push(event);
      }
    }
    if (due.length === 0) {
      return;
    }
    this.events = remaining;
    this.trace('kernel fire', { due: due.length, remaining: remaining.length });
    // Group by owner so each service reconciles its own due deadlines once.
    const byOwner = new Map<string, ScheduledEvent[]>();
    for (const event of due) {
      const list = byOwner.get(event.owner) ?? [];
      list.push(event);
      byOwner.set(event.owner, list);
    }
    for (const [owner, list] of byOwner) {
      this.emit('wake', owner, list);
    }
  }

  // ── Watchdog ──────────────────────────────────────────────────────────────

  private startWatchdog(): void {
    if (this.watchdog || !this.running) {
      return;
    }
    this.watchdog = setInterval(() => this.checkDrift(), this.watchdogIntervalMs);
    if (typeof this.watchdog.unref === 'function') {
      this.watchdog.unref();
    }
  }

  private stopWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  /**
   * Compare wall-clock elapsed against monotonic elapsed since the last tick.
   * Under normal operation these stay within the watchdog interval of each
   * other. A wall-clock jump (user changed the time, NTP sync, DST, or a
   * suspended system that skipped a deadline) shows up as a divergence and
   * forces a reconcile so no deadline is silently missed.
   */
  private checkDrift(): void {
    const wall = this.clock.now();
    const mono = this.clock.monotonic();
    const timezoneOffset = this.getTimezoneOffset();
    const wallElapsed = wall - this.lastWall;
    const monoElapsed = mono - this.lastMonotonic;
    this.lastWall = wall;
    this.lastMonotonic = mono;

    if (timezoneOffset !== this.lastTimezoneOffset) {
      const previousOffset = this.lastTimezoneOffset;
      this.lastTimezoneOffset = timezoneOffset;
      this.trace('kernel timezone changed', { previousOffset, timezoneOffset });
      // Services owning civil-time schedules must recompute their epochs. An
      // absolute one-shot timestamp remains unchanged; only its owner can make
      // that distinction, so the kernel emits a dedicated signal.
      this.emit('timezone-change', { previousOffset, timezoneOffset });
      this.reconcile();
      return;
    }

    if (Math.abs(wallElapsed - monoElapsed) > this.driftThresholdMs) {
      this.trace('kernel drift detected', {
        wallElapsed,
        monoElapsed,
        delta: wallElapsed - monoElapsed
      });
      // The wall clock moved meaningfully relative to monotonic time: recompute
      // every deadline against the now-current wall clock and fire anything due.
      this.emit('drift', wallElapsed - monoElapsed);
      this.reconcile();
      return;
    }

    // No drift, but guard against a timer that should have fired by now (e.g. a
    // deadline landed in the gap between ticks). If the nearest deadline is
    // already past, the exact timer is either late or disarmed — reconcile.
    const nearestDelay = this.events.reduce((min, event) => {
      if (event.clock === 'elapsed' && this.elapsedPausedAt !== null) {
        return min;
      }
      return Math.min(min, this.remaining(event));
    }, Infinity);
    if (nearestDelay < 0) {
      this.trace('kernel missed deadline', { nearestDelay, now: wall });
      this.reconcile();
    }
  }
}

/**
 * Monotonic clock source. `performance.now()` is monotonic and unaffected by
 * wall-clock changes, which is exactly what drift detection needs. Falls back
 * to Date.now if unavailable (it always is in Node, but be defensive).
 */
function monotonicNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
