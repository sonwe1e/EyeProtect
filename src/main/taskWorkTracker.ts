import { EventEmitter } from 'node:events';
import type { Task, TaskWorkSummary } from '../shared/types';
import type { TaskStore } from './taskStore';

export interface TaskWorkTrackerOptions {
  now?: () => number;
  monotonic?: () => number;
  checkpointMs?: number;
}

/** Tracks only active-use time; inactive intervals never enter SQLite. */
export class TaskWorkTracker extends EventEmitter {
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private readonly checkpointMs: number;
  private taskId: string | null = null;
  private active = true;
  private segmentWallAt = 0;
  private segmentMonoAt: number | null = null;
  private continuousMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: TaskStore,
    private readonly getTask: (id: string) => Task | null,
    options: TaskWorkTrackerOptions = {}
  ) {
    super();
    this.now = options.now ?? Date.now;
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.checkpointMs = options.checkpointMs ?? 30_000;
    this.continuousMs = store.getContinuousActiveMs();
  }

  start(taskId: string | null): void {
    this.setActiveTask(taskId);
    this.timer = setInterval(() => this.checkpoint(), this.checkpointMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.checkpoint();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Persist the current tail before another runtime state machine changes. */
  flush(): void {
    this.checkpoint();
  }

  setActiveTask(taskId: string | null): void {
    this.checkpoint();
    this.taskId = taskId && this.getTask(taskId)?.status === 'open' ? taskId : null;
    this.beginSegment();
    this.emitSummary();
  }

  pause(): void {
    if (!this.active) return;
    this.checkpoint();
    this.active = false;
    this.emitSummary();
  }

  resume(naturalBreak: boolean = false): void {
    if (naturalBreak) {
      this.continuousMs = 0;
      this.store.setContinuousActiveMs(0);
    }
    if (this.active) return;
    this.active = true;
    this.beginSegment();
    this.emitSummary();
  }

  resetContinuous(): void {
    if (this.continuousMs === 0) return;
    this.continuousMs = 0;
    this.store.setContinuousActiveMs(0);
    this.emitSummary();
  }

  getSummary(): TaskWorkSummary {
    const live = this.active && this.segmentMonoAt !== null
      ? Math.max(0, this.monotonic() - this.segmentMonoAt)
      : 0;
    return {
      taskId: this.taskId,
      tracking: this.active && this.taskId !== null,
      taskActiveMs: this.taskId ? this.store.getTaskWorkMs(this.taskId) + live : 0,
      currentSessionMs: this.taskId ? live : 0,
      continuousActiveMs: this.continuousMs + live,
      timeboxNotified: this.taskId ? this.store.isTimeboxNotified(this.taskId) : false
    };
  }

  private checkpoint(): void {
    if (!this.active || this.segmentMonoAt === null) return;
    const endedAt = this.now();
    const activeMs = Math.max(0, this.monotonic() - this.segmentMonoAt);
    if (this.taskId && activeMs > 0) {
      this.store.recordWorkSegment(this.taskId, this.segmentWallAt, endedAt, activeMs);
      // Feed the logical focus session (USERPLAN PR6): segments are the
      // precise layer; the session accumulates only its own task's work.
      this.emit('segment', { taskId: this.taskId, activeMs });
      const task = this.getTask(this.taskId);
      const total = this.store.getTaskWorkMs(this.taskId);
      if (task?.estimateMinutes && !this.store.isTimeboxNotified(task.id) && total >= task.estimateMinutes * 60_000) {
        this.store.setTimeboxNotified(task.id, true);
        this.emit('timebox', task, total);
      }
    }
    this.continuousMs += activeMs;
    this.store.setContinuousActiveMs(this.continuousMs);
    this.beginSegment();
    this.emitSummary();
  }

  private beginSegment(): void {
    if (!this.active) {
      this.segmentMonoAt = null;
      return;
    }
    this.segmentWallAt = this.now();
    this.segmentMonoAt = this.monotonic();
  }

  private emitSummary(): void {
    this.emit('changed', this.getSummary());
  }
}
