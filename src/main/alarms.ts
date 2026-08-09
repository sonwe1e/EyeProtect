import { EventEmitter } from 'node:events';
import type { ScheduledEvent, SchedulerKernel } from './scheduling/kernel';
import type { Alarm, AlarmRepeat } from '../shared/types';

export interface AlarmInput {
  hour: number;
  minute: number;
  label?: string;
  repeat: AlarmRepeat;
  enabled: boolean;
}

export interface AlarmClockOptions {
  now?: () => number;
  /**
   * Shared deadline queue. When provided, the alarm clock reports its next
   * fire time to the kernel instead of managing per-alarm `setTimeout`s, so
   * alarms share the break timer and the watchdog, and get reconciled after
   * suspend/resume/unlock (which standalone timers would otherwise skip).
   */
  kernel?: SchedulerKernel;
}

/**
 * Injectable clock for deterministic tests (defaults to Date.now). For
 * backwards compatibility the constructor also accepts the clock function
 * directly, so existing call sites `new AlarmClock(now)` keep working.
 */
export type AlarmClockOptionsArg = AlarmClockOptions | (() => number);

// DST-safe: rolls over using the local-date calendar so 23h / 25h DST days
// stay correct (never add a raw +86_400_000 ms).
export const nextFireAt = (hour: number, minute: number, now = Date.now()): number => {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
};

const MINUTE = 60_000;

export class AlarmClock extends EventEmitter {
  private alarms: Alarm[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private sequence = 0;
  private readonly now: () => number;
  private readonly kernel: SchedulerKernel | null;
  /** Revision bumped on every kernel report so stale 'alarm' events are ignored. */
  private kernelRevision = 0;
  /**
   * Kernel path only: the most recent occurrence (epoch ms) each alarm has
   * already fired for. Stops a daily alarm firing twice for the same
   * occurrence when reconcile() is called more than once in the same minute
   * (e.g. a drift check landing on the fire time).
   */
  private lastFiredAt = new Map<string, number>();

  constructor(options: AlarmClockOptionsArg = {}) {
    super();
    const normalized = typeof options === 'function' ? { now: options } : options;
    this.now = normalized.now ?? Date.now;
    this.kernel = normalized.kernel ?? null;
    if (this.kernel) {
      this.kernel.on('wake', (owner) => {
        if (owner === 'alarm') {
          this.reconcile();
        }
      });
    }
  }

  getAlarms(): Alarm[] {
    return this.alarms.map((alarm) => ({ ...alarm }));
  }

  hydrate(alarms: Alarm[]): void {
    // Re-hydrating (e.g. settings reload) must not stack a second timer on an
    // alarm that is already armed.
    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id);
    }
    const restored = alarms.map((alarm) => ({ ...alarm }));
    this.alarms = restored;
    this.lastFiredAt.clear();
    if (this.kernel) {
      // One shared deadline for the whole alarm set instead of per-alarm timers.
      this.reportNextToKernel();
      return;
    }
    for (const alarm of restored) {
      if (alarm.enabled) {
        const delay = nextFireAt(alarm.hour, alarm.minute, this.now()) - this.now();
        this.arm(alarm, delay);
      }
    }
  }

  /** Cancels every pending timer (or clears the kernel deadline). Call on exit. */
  dispose(): void {
    if (this.kernel) {
      this.kernel.set('alarm', []);
      return;
    }
    for (const id of [...this.timers.keys()]) {
      this.clearTimer(id);
    }
  }

  setAlarm(input: AlarmInput): Alarm[] {
    const now = this.now();
    const alarm: Alarm = {
      id: `${now}-${++this.sequence}`,
      hour: input.hour,
      minute: input.minute,
      label: input.label,
      repeat: input.repeat,
      enabled: input.enabled,
      createdAt: now
    };

    this.alarms = [...this.alarms, alarm];
    if (alarm.enabled) {
      this.arm(alarm, nextFireAt(alarm.hour, alarm.minute, now) - now);
    }

    this.emit('changed', this.getAlarms());
    return this.getAlarms();
  }

  cancelAlarm(id: string): Alarm[] {
    this.clearTimer(id);
    this.alarms = this.alarms.filter((alarm) => alarm.id !== id);
    this.lastFiredAt.delete(id);
    // The nearest pending deadline may have changed.
    if (this.kernel) {
      this.reportNextToKernel();
    }
    this.emit('changed', this.getAlarms());
    return this.getAlarms();
  }

  /**
   * Fire every alarm whose scheduled occurrence is at/before `now` and that has
   * not already fired for that occurrence, then re-arm the nearest one. Called
   * by the kernel on wake; also exposed for tests to drive time deterministically.
   */
  reconcile(now: number = this.now()): void {
    if (!this.kernel) {
      return;
    }
    let fired = false;
    for (const alarm of this.alarms) {
      if (!alarm.enabled) {
        continue;
      }
      const occurrence = mostRecentOccurrence(alarm.hour, alarm.minute, now);
      if (occurrence > now) {
        continue; // this occurrence is still in the future
      }
      if (this.lastFiredAt.get(alarm.id) === occurrence) {
        continue; // already fired this exact occurrence
      }
      this.lastFiredAt.set(alarm.id, occurrence);
      fired = true;
      this.fire(alarm.id);
    }
    if (fired) {
      this.reportNextToKernel();
    }
  }

  private arm(alarm: Alarm, delayMs: number): void {
    if (this.kernel) {
      // The kernel owns the timer: (re)report the nearest deadline across all
      // alarms. The single-fire resolution happens in reconcile().
      this.reportNextToKernel();
      return;
    }
    if (delayMs <= 0) {
      // Exact-ms boundary → fire on the next tick rather than silently expiring.
      delayMs = 0;
    }
    this.clearTimer(alarm.id);
    // One-shot setTimeout; longest delay is < 24h (86.4M ms), comfortably under
    // the 2^31-1 (~24.8 days) overflow limit.
    const timer = setTimeout(() => this.fire(alarm.id), delayMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.timers.set(alarm.id, timer);
  }

  private fire(id: string): void {
    const alarm = this.alarms.find((entry) => entry.id === id);
    this.timers.delete(id);
    if (!alarm) {
      return;
    }

    this.emit('fired', { ...alarm });

    if (alarm.repeat === 'daily' && alarm.enabled) {
      // Re-arm for the next day at the same wall-clock time.
      this.arm(alarm, nextFireAt(alarm.hour, alarm.minute, this.now()) - this.now());
      return;
    }

    // A once alarm must not survive its own firing: drop it from the list and
    // emit 'changed' so the store persists the removal — otherwise a restart
    // would rehydrate it and fire it again the next day.
    this.alarms = this.alarms.filter((entry) => entry.id !== id);
    this.lastFiredAt.delete(id);
    this.emit('changed', this.getAlarms());
  }

  /** Report the single nearest pending deadline to the kernel (kernel path). */
  private reportNextToKernel(): void {
    if (!this.kernel) {
      return;
    }
    let nearest = Infinity;
    for (const alarm of this.alarms) {
      if (!alarm.enabled) {
        continue;
      }
      nearest = Math.min(nearest, nextFireAt(alarm.hour, alarm.minute, this.now()));
    }
    if (nearest === Infinity) {
      this.kernel.set('alarm', []);
      return;
    }
    this.kernel.set('alarm', [
      {
        id: 'alarm-next',
        owner: 'alarm',
        type: 'alarm',
        fireAt: nearest,
        revision: ++this.kernelRevision
      }
    ]);
  }

  private clearTimer(id: string): void {
    const existing = this.timers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(id);
    }
  }
}

/**
 * The most recent wall-clock occurrence of `hour:minute` at or before `now`
 * (local time, DST-safe). Unlike nextFireAt (which always returns a FUTURE
 * time), this returns the occurrence the user actually "meant" — the one an
 * alarm should fire for at instant `now`. Used by the kernel path to decide
 * which alarms are due without double-firing.
 */
const mostRecentOccurrence = (hour: number, minute: number, now: number): number => {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() > now) {
    d.setDate(d.getDate() - 1);
  }
  return d.getTime();
};
