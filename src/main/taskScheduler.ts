import { EventEmitter } from 'node:events';
import type { ScheduledEvent, SchedulerKernel } from './scheduling/kernel';
import type { Task } from '../shared/types';
import type { PersistedScheduledEvent } from '../shared/types';

export interface TaskSchedulerOptions {
  persist?: (events: PersistedScheduledEvent[]) => void;
  isConsumed?: (task: Task) => boolean;
  acknowledge?: (task: Task, fireAt: number) => void;
}

/**
 * Wires task `reminderAt` deadlines into the shared SchedulerKernel under the
 * `'task'` owner alongside breaks and standalone reminders. The kernel owns
 * the single timer + watchdog; this class only decides
 * which task reminder is nearest and reacts when one fires.
 *
 * Only non-done/non-archived tasks with an unconsumed `reminderAt` are armed;
 * an overdue persisted occurrence is deliberately reconciled on startup.
 */
export class TaskScheduler extends EventEmitter {
  private readonly kernel: SchedulerKernel;
  private readonly getTasks: () => Task[];
  private readonly now: () => number;
  private sequence = 0;
  private readonly consumed = new Map<string, number>();
  private readonly persist: (events: PersistedScheduledEvent[]) => void;
  private readonly isConsumed: (task: Task) => boolean;
  private readonly onWake: (owner: string, events: ScheduledEvent[]) => void;
  /** Signature of the last persisted/kernel-armed pending set (see arm). */
  private lastArmSignature = '';

  constructor(kernel: SchedulerKernel, getTasks: () => Task[], now: () => number = Date.now, options: TaskSchedulerOptions = {}) {
    super();
    this.kernel = kernel;
    this.getTasks = getTasks;
    this.now = now;
    this.persist = options.persist ?? (() => undefined);
    this.isConsumed = options.isConsumed ?? (() => false);
    this.onWake = (owner, events) => {
      if (owner !== 'task') {
        return;
      }
      this.handleWake(events);
    };
    this.kernel.on('wake', this.onWake);
  }

  /**
   * Scan every task for the nearest future `reminderAt` and register a single
   * shared deadline with the kernel. Called after any task mutation and on
   * resume; the kernel coalesces it into its one timer.
   */
  arm(now: number = this.now()): void {
    const tasks = this.getTasks();
    const events: ScheduledEvent[] = [];
    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'archived') {
        continue;
      }
      // Narrow the reminderAt locally so the comparison and capture are typed.
      if (typeof task.reminderAt !== 'number') {
        continue;
      }
      events.push({
        id: `task-reminder-${task.id}`,
        owner: 'task',
        type: 'task-reminder',
        fireAt: task.reminderAt,
        revision: ++this.sequence
      });
    }
    const byId = new Map(tasks.map((task) => [task.id, task]));
    // Drop consumed markers for tasks that no longer exist; the map would
    // otherwise grow for the whole process lifetime.
    for (const key of this.consumed.keys()) {
      if (!byId.has(key.replace('task-reminder-', ''))) {
        this.consumed.delete(key);
      }
    }
    const pending = events.filter((event) => {
      const task = byId.get(event.id.replace('task-reminder-', ''));
      return this.consumed.get(event.id) !== event.fireAt && !(task && this.isConsumed(task));
    });
    // Most task edits do not touch reminderAt; skip the scheduled-events rewrite
    // and kernel re-arm when the pending deadline set is unchanged. This keeps a
    // per-keystroke autosave from deleting+reinserting rows for nothing.
    const signature = pending
      .map((event) => `${event.id}:${event.fireAt}`)
      .sort()
      .join('|');
    if (signature === this.lastArmSignature) {
      return;
    }
    this.lastArmSignature = signature;
    this.persist(pending.map((event) => ({ ...event, owner: 'task', payloadRef: event.id.replace('task-reminder-', '') })));
    const nearest = pending.sort((a, b) => a.fireAt - b.fireAt)[0];
    this.kernel.set('task', nearest ? [nearest] : []);
  }

  /** Re-arm after the kernel resumes from suspend (deadlines may have been skipped). */
  resume(now: number = this.now()): void {
    this.arm(now);
  }

  /** Drop the registered deadline; the kernel keeps running for other owners. */
  suspend(): void {
    this.kernel.set('task', []);
    // The kernel now has nothing registered for 'task'; the next arm() must
    // re-register even if the deadline set is otherwise unchanged.
    this.lastArmSignature = '';
  }

  /** Unsubscribe from the kernel and clear our deadline. Call on shutdown. */
  dispose(): void {
    this.kernel.off('wake', this.onWake);
    this.kernel.clear('task');
  }

  /**
   * The kernel woke us for one or more `task-reminder` events. Collect every task
   * whose reminder is now due (there can be more than one if several landed in
   * the same suspend window) and emit `task-reminder` with the due list so the
   * IPC layer can surface it (native notification / queue), then re-arm.
   */
  private handleWake(events: ScheduledEvent[], now: number = this.now()): void {
    if (events.length === 0) {
      return;
    }
    const latestFireAt = events.reduce((max, event) => Math.max(max, fireAtOf(event)), now);
    const due = this.getTasks().filter(
      (task) =>
        task.status !== 'done' &&
        task.status !== 'archived' &&
        typeof task.reminderAt === 'number' &&
        task.reminderAt <= latestFireAt &&
        this.consumed.get(`task-reminder-${task.id}`) !== task.reminderAt &&
        !this.isConsumed(task)
    );
    if (due.length > 0) {
      for (const task of due) {
        if (task.reminderAt !== null) {
          this.consumed.set(`task-reminder-${task.id}`, task.reminderAt);
        }
      }
      this.emit('task-reminder', due);
    }
    this.arm(now);
  }
}

// The event's fireAt is the authoritative due instant; fall back to 0 only if
// it is somehow missing (should never happen for a real kernel event).
const fireAtOf = (event: ScheduledEvent): number =>
  typeof event.fireAt === 'number' ? event.fireAt : 0;
