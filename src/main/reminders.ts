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
const TICK_MS = 1_000;
const COMBINE_WINDOW_MS = 60_000;

const reminderKindsFor = (kind: ReminderKind): SingleReminderKind[] => {
  if (kind === 'combined') {
    return ['eye', 'walk'];
  }
  return [kind];
};

export class ReminderScheduler extends EventEmitter {
  private settings: Settings;
  private status: ReminderStatus;
  private timer: NodeJS.Timeout | null = null;
  private sequence = 0;
  private activeIsTest = false;
  private snoozeCount = 0;

  constructor(settings: Settings) {
    super();
    const now = Date.now();
    this.settings = settings;
    this.status = {
      nextEyeAt: now + settings.eyeIntervalMinutes * MINUTE,
      nextWalkAt: now + settings.walkIntervalMinutes * MINUTE,
      pausedUntil: null,
      activeReminder: null
    };
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.checkDue(), TICK_MS);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): ReminderStatus {
    return {
      ...this.status,
      activeReminder: this.status.activeReminder ? { ...this.status.activeReminder } : null
    };
  }

  updateSettings(settings: Settings, previous: Settings): ReminderStatus {
    const now = Date.now();
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
    return this.getStatus();
  }

  handleAction(action: ReminderAction, reminderId: string): ReminderStatus {
    const active = this.status.activeReminder;
    if (!active || active.id !== reminderId) {
      return this.getStatus();
    }

    if (!this.activeIsTest) {
      const now = Date.now();
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
    return this.getStatus();
  }

  triggerTest(kind: ReminderKind): ReminderStatus {
    this.beginReminder(kind, true);
    return this.getStatus();
  }

  pause(minutes: number): ReminderStatus {
    const pauseMinutes = Math.min(24 * 60, Math.max(1, Math.round(minutes)));
    const now = Date.now();
    const pausedUntil = now + pauseMinutes * MINUTE;
    this.status.pausedUntil = pausedUntil;
    this.status.activeReminder = null;
    this.activeIsTest = false;
    this.snoozeCount = 0;
    this.status.nextEyeAt = pausedUntil + this.settings.eyeIntervalMinutes * MINUTE;
    this.status.nextWalkAt = pausedUntil + this.settings.walkIntervalMinutes * MINUTE;
    this.emitChanged();
    return this.getStatus();
  }

  /** Runs one scheduling pass. Exposed so tests can drive time deterministically. */
  tick(now: number = Date.now()): ReminderStatus {
    this.checkDue(now);
    return this.getStatus();
  }

  onChanged(callback: (payload: ReminderChangedPayload) => void): void {
    this.on('changed', callback);
  }

  private checkDue(now: number = Date.now()): void {
    if (this.status.activeReminder) {
      this.absorbDueKinds(this.status.activeReminder, now);
      return;
    }

    if (this.status.pausedUntil && now < this.status.pausedUntil) {
      return;
    }

    if (this.status.pausedUntil && now >= this.status.pausedUntil) {
      this.status.pausedUntil = null;
      this.emitChanged();
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
    const active: ActiveReminder = {
      id: `${Date.now()}-${++this.sequence}`,
      kind,
      kinds: reminderKindsFor(kind),
      startedAt: Date.now(),
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

  private emitChanged(): void {
    this.emit('changed', this.getStatus() satisfies ReminderChangedPayload);
  }
}
