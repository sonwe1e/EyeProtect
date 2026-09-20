import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';
import { SIMPLE_SETTING_LIMITS } from '../shared/types';
import type { PomodoroState } from '../shared/types';
import type { SchedulerKernel, ScheduledEvent } from './scheduling/kernel';

export interface PomodoroOptions {
  now?: () => number;
  monotonic?: () => number;
  taskAvailable: (id: string) => boolean;
  healthBreakActive: () => boolean;
  breakMinutes: () => number;
}
const idle = (): PomodoroState => ({ phase: 'idle', taskId: null, running: false, remainingMs: 0, revision: 0 });

export class PomodoroService extends EventEmitter {
  private state = idle();
  private sampledMono = 0;
  private sequence = 0;
  private readonly path: string;
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private readonly wake: (owner: string, events: ScheduledEvent[]) => void;

  constructor(directory: string, private readonly kernel: SchedulerKernel, private readonly options: PomodoroOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.monotonic = options.monotonic ?? (() => performance.now());
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'pomodoro-state.json');
    if (existsSync(this.path)) {
      try {
        const data = JSON.parse(readFileSync(this.path, 'utf8')) as PomodoroState;
        if (!['idle', 'ready', 'focus', 'break', 'focus-finished', 'break-finished'].includes(data.phase) ||
          typeof data.remainingMs !== 'number' || !Number.isFinite(data.remainingMs) || data.remainingMs < 0 || data.remainingMs > 180 * 60_000 ||
          !(data.taskId === null || typeof data.taskId === 'string')) throw new Error('无效番茄钟快照');
        this.state = { ...data, revision: 0, running: false };
        if (data.taskId && !options.taskAvailable(data.taskId)) this.state = idle();
      } catch (error) {
        logger.warn('quarantining invalid pomodoro snapshot', error);
        try { renameSync(this.path, `${this.path}.corrupt-${this.now()}`); }
        catch (quarantineError) { logger.error('cannot quarantine pomodoro snapshot; keeping original file', quarantineError); }
      }
    }
    this.sampledMono = this.monotonic();
    this.wake = (owner, events) => {
      if (owner !== 'pomodoro' || !this.state.running || !events.some((event) => event.revision === this.sequence)) return;
      if (this.getState().remainingMs <= 0) {
        this.commit({ ...this.getState(), phase: this.state.phase === 'focus' ? 'focus-finished' : 'break-finished', running: false, remainingMs: 0 });
      } else {
        this.commit(this.getState());
      }
    };
    kernel.on('wake', this.wake);
  }

  getState(): PomodoroState {
    return { ...this.state, remainingMs: this.state.running ? Math.max(0, this.state.remainingMs - (this.monotonic() - this.sampledMono)) : this.state.remainingMs };
  }

  prepare(taskId: string | null, replace = false): PomodoroState {
    if (taskId && !this.options.taskAvailable(taskId)) throw new Error('只能专注未完成主任务');
    if (['focus', 'break'].includes(this.state.phase) && !replace) throw new Error('请先确认结束当前计时');
    return this.commit({ phase: 'ready', taskId, running: false, remainingMs: 0, revision: this.state.revision });
  }

  start(taskId: string | null, minutes: number, replace = false): PomodoroState {
    if (!Number.isInteger(minutes) || minutes < SIMPLE_SETTING_LIMITS.pomodoroMinutes.min || minutes > SIMPLE_SETTING_LIMITS.pomodoroMinutes.max) throw new Error('专注时长需要在 1–180 分钟之间');
    if (taskId && !this.options.taskAvailable(taskId)) throw new Error('只能专注未完成的主任务');
    if (this.options.healthBreakActive()) throw new Error('请先完成当前休息');
    if (this.state.phase !== 'idle' && !replace) throw new Error('已有计时，请先确认结束');
    return this.commit({ phase: 'focus', taskId, running: true, remainingMs: Math.round(minutes * 60_000), revision: this.state.revision });
  }

  act(action: 'pause' | 'resume' | 'stop' | 'break'): PomodoroState {
    const current = this.getState();
    if (action === 'stop') return this.commit(idle());
    if (action === 'pause') return current.running ? this.commit({ ...current, running: false }) : current;
    if (action === 'resume') {
      if (this.options.healthBreakActive()) throw new Error('请先完成当前休息');
      if (current.running || !['focus', 'break'].includes(current.phase)) return current;
      return this.commit({ ...current, running: true });
    }
    if (current.phase !== 'focus-finished') return current;
    return this.commit({ ...current, phase: 'break', running: true, remainingMs: this.options.breakMinutes() * 60_000 });
  }

  beginHealthRest(): void {
    const current = this.getState();
    if (current.phase === 'focus' && current.remainingMs <= 0) {
      this.commit({ ...current, phase: 'focus-finished', running: false });
    }
    if (this.state.phase === 'focus') this.act('pause');
    else if (this.state.phase === 'focus-finished') this.act('break');
    else if (this.state.phase === 'break' && !this.state.running) this.commit({ ...this.getState(), running: true });
    // A running short rest continues under the single health surface.
    // Only an explicit health completion can record an eye/walk break.
  }

  reconcileTask(): void {
    if (this.state.taskId && !this.options.taskAvailable(this.state.taskId)) this.act('stop');
  }

  dispose(): void {
    this.act('pause');
    this.kernel.clear('pomodoro');
    this.kernel.removeListener('wake', this.wake);
  }

  private commit(next: PomodoroState): PomodoroState {
    const snapshot = { ...next, revision: this.state.revision + 1 };
    // Persist before publishing state or arming a timer. A failed write does
    // not falsely acknowledge an action that cannot survive a restart.
    writeFileSync(`${this.path}.tmp`, JSON.stringify(snapshot), 'utf8');
    renameSync(`${this.path}.tmp`, this.path);
    this.state = snapshot;
    this.sampledMono = this.monotonic();
    const revision = ++this.sequence;
    const events: ScheduledEvent[] = snapshot.running ? [
      { id: 'pomodoro-end', owner: 'pomodoro', type: 'end', clock: 'elapsed', fireAt: this.now() + snapshot.remainingMs, revision },
      { id: 'pomodoro-checkpoint', owner: 'pomodoro', type: 'checkpoint', clock: 'elapsed', fireAt: this.now() + Math.min(10_000, snapshot.remainingMs), revision }
    ] : [];
    this.kernel.set('pomodoro', events);
    this.emit('changed', this.getState());
    return this.getState();
  }
}
