import { EventEmitter } from 'node:events';

export type ActivityState = 'active' | 'idle' | 'locked' | 'suspended';

export interface ActivityResume {
  previous: Exclude<ActivityState, 'active'>;
  inactiveMs: number;
  naturalBreak: boolean;
}

export interface ActivityMonitorOptions {
  getIdleSeconds: () => number;
  naturalBreakMs: () => number;
  now?: () => number;
  pollIntervalMs?: number;
}

/**
 * Converts Electron's sampled idle/lock/power signals into one activity state.
 * The start timestamp is backdated from getSystemIdleTime(), so the seconds
 * before a polling tick are not accidentally counted as active work.
 */
export class ActivityMonitor extends EventEmitter {
  private readonly getIdleSeconds: () => number;
  private readonly naturalBreakMs: () => number;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private state: ActivityState = 'active';
  private inactiveSince: number | null = null;

  constructor(options: ActivityMonitorOptions) {
    super();
    this.getIdleSeconds = options.getIdleSeconds;
    this.naturalBreakMs = options.naturalBreakMs;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  start(): void {
    if (this.timer) return;
    this.sample();
    this.timer = setInterval(() => this.sample(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getState(): ActivityState {
    return this.state;
  }

  lock(): void {
    this.enterInactive('locked', this.now());
  }

  unlock(): void {
    this.returnActive();
  }

  suspend(): void {
    this.enterInactive('suspended', this.now());
  }

  resume(idleSeconds: number = this.getIdleSeconds()): void {
    const inferredStart = this.now() - Math.max(0, idleSeconds) * 1_000;
    if (this.inactiveSince === null || inferredStart < this.inactiveSince) {
      this.inactiveSince = inferredStart;
    }
    this.returnActive();
  }

  sample(): void {
    if (this.state === 'locked' || this.state === 'suspended') return;
    const idleMs = Math.max(0, this.getIdleSeconds()) * 1_000;
    if (idleMs >= 1_000) {
      this.enterInactive('idle', this.now() - idleMs);
    } else if (this.state === 'idle') {
      this.returnActive();
    }
  }

  private enterInactive(state: Exclude<ActivityState, 'active'>, since: number): void {
    if (this.state === 'active') {
      this.inactiveSince = since;
      this.emit('inactive', { state, since });
    } else if (this.inactiveSince === null || since < this.inactiveSince) {
      this.inactiveSince = since;
    }
    this.state = state;
  }

  private returnActive(): void {
    if (this.state === 'active') return;
    const previous = this.state;
    const inactiveMs = Math.max(0, this.now() - (this.inactiveSince ?? this.now()));
    this.state = 'active';
    this.inactiveSince = null;
    const payload: ActivityResume = {
      previous,
      inactiveMs,
      naturalBreak: inactiveMs >= this.naturalBreakMs()
    };
    this.emit('active', payload);
  }
}
