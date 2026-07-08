import { EventEmitter } from 'node:events';
import type { Alarm, AlarmRepeat } from '../shared/types';

export interface AlarmInput {
  hour: number;
  minute: number;
  label?: string;
  repeat: AlarmRepeat;
  enabled: boolean;
}

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

  constructor(now: () => number = Date.now) {
    super();
    this.now = now;
  }

  getAlarms(): Alarm[] {
    return this.alarms.map((alarm) => ({ ...alarm }));
  }

  hydrate(alarms: Alarm[]): void {
    const restored = alarms.map((alarm) => ({ ...alarm }));
    for (const alarm of restored) {
      if (alarm.enabled) {
        const delay = nextFireAt(alarm.hour, alarm.minute, this.now()) - this.now();
        this.arm(alarm, delay);
      }
    }
    this.alarms = restored;
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
    this.emit('changed', this.getAlarms());
    return this.getAlarms();
  }

  private arm(alarm: Alarm, delayMs: number): void {
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
    }
  }

  private clearTimer(id: string): void {
    const existing = this.timers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(id);
    }
  }
}
