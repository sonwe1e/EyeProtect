import { EventEmitter } from 'node:events';
import { localDateKey, startOfLocalDate } from '../shared/calendar';
import type { FocusSession, FocusStatus, TimeBlock } from '../shared/types';
import type { TaskStore } from './taskStore';

export interface FocusSessionServiceOptions {
  now?: () => number;
}

/**
 * Focus session state machine (USERPLAN 1.2 PR6, ADR-005).
 *
 * One logical focus run: start → work segments accumulate → health breaks
 * pause accumulation WITHOUT ending the session → resume → pause/complete.
 * The precise low-level segments stay in work_sessions; this service owns
 * the logical layer the Focus surface displays:
 *
 *   本次专注 = live session activeMs   今日实际 = task work since midnight
 *   任务累计 = all-time task work      计划     = today's plan ?? estimate
 *
 * Invariants come from the store (one live session globally, on_break
 * accumulation guard) — the service only orchestrates transitions.
 */
export class FocusSessionService extends EventEmitter {
  private readonly now: () => number;

  constructor(private readonly store: TaskStore, options: FocusSessionServiceOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
  }

  getStatus(): FocusStatus {
    const session = this.store.getLiveFocusSession();
    const taskId = session?.taskId ?? this.store.getActiveTaskId();
    const now = this.now();
    let todayTaskMs = 0;
    let totalTaskMs = 0;
    let plannedMinutes: number | null = null;
    let block: TimeBlock | null = null;
    if (taskId) {
      todayTaskMs = this.store.getTaskWorkMsSince(taskId, startOfLocalDate(now));
      totalTaskMs = this.store.getTaskWorkMs(taskId);
      const task = this.store.getTask(taskId);
      const plan = this.store
        .getDailyPlans(localDateKey(now))
        .find((entry) => entry.taskId === taskId);
      plannedMinutes = plan?.plannedMinutes ?? task?.estimateMinutes ?? null;
    }
    if (session?.timeBlockId) {
      block = this.store.getTimeBlocks().find((entry) => entry.id === session.timeBlockId) ?? null;
    }
    return { session, todayTaskMs, totalTaskMs, plannedMinutes, block };
  }

  /**
   * Start focusing a task. Starting another task interrupts the live session
   * (append-only history); starting the same task is idempotent.
   */
  start(taskId: string, timeBlockId: string | null = null): FocusStatus {
    const live = this.store.getLiveFocusSession();
    if (live) {
      if (live.taskId === taskId) {
        if (live.onBreak) this.store.setFocusSessionOnBreak(live.id, false);
        return this.emitAndReturn();
      }
      this.store.endFocusSession(live.id, 'interrupted', this.now());
    }
    this.store.startFocusSession({ taskId, timeBlockId }, this.now());
    this.store.setActiveTaskId(taskId, this.now());
    return this.emitAndReturn();
  }

  /**
   * Resume work after a break or restart a lost session.
   *
   * - If a live session exists and is in break mode, end the break so
   *   accumulation resumes immediately (§十五).
   * - If a live session exists but already running, keep it as-is and return
   *   the current status.
   * - If no live session exists, restart one from the active task (if any),
   *   matching the "return to the previous task" user expectation.
   */
  resume(): FocusStatus {
    const live = this.store.getLiveFocusSession();
    if (live) {
      if (live.onBreak) {
        this.store.setFocusSessionOnBreak(live.id, false);
      }
      return this.emitAndReturn();
    }
    const activeTaskId = this.store.getActiveTaskId();
    if (!activeTaskId) {
      return this.emitAndReturn();
    }
    this.start(activeTaskId);
    return this.emitAndReturn();
  }

  /** Pause: the session ends as `paused`; the active task is released. */
  pause(): FocusStatus {
    const live = this.store.getLiveFocusSession();
    if (live) {
      this.store.endFocusSession(live.id, 'paused', this.now());
      this.store.setActiveTaskId(null, this.now());
    }
    return this.emitAndReturn();
  }

  /** Complete: the session ends as `completed`; the active task is released. */
  complete(): FocusStatus {
    const live = this.store.getLiveFocusSession();
    if (live) {
      this.store.endFocusSession(live.id, 'completed', this.now());
      this.store.setActiveTaskId(null, this.now());
    }
    return this.emitAndReturn();
  }

  /** A health break started: keep the session, stop accumulating. */
  beginBreak(): FocusStatus {
    const live = this.store.getLiveFocusSession();
    if (live && !live.onBreak) {
      this.store.setFocusSessionOnBreak(live.id, true);
    }
    return this.emitAndReturn();
  }

  /** The break ended: resume accumulating the same session (§十五 resume). */
  endBreak(): FocusStatus {
    const live = this.store.getLiveFocusSession();
    if (live && live.onBreak) {
      this.store.setFocusSessionOnBreak(live.id, false);
    }
    return this.emitAndReturn();
  }

  /**
   * Work-tracker checkpoint feed. Only the live session's own task outside a
   * break accumulates; the store enforces the guard at the SQL level too.
   */
  addWorkSegment(taskId: string, activeMs: number): void {
    const live = this.store.getLiveFocusSession();
    if (!live || live.taskId !== taskId || live.onBreak || activeMs <= 0) return;
    this.store.addFocusSessionActiveMs(live.id, activeMs, this.now());
    this.emit('changed', this.getStatus());
  }

  private emitAndReturn(): FocusStatus {
    const status = this.getStatus();
    this.emit('changed', status);
    return status;
  }
}

export type FocusSessionEntity = FocusSession;
