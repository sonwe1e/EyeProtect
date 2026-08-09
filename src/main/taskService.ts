import { EventEmitter } from 'node:events';
import { nextRecurrenceFireAt } from '../shared/types';
import type { TaskStore } from './taskStore';
import type {
  Project,
  Alarm,
  ProjectInput,
  ProjectUpdateInput,
  RecurrenceRule,
  Task,
  TaskInput,
  TaskStatus,
  TaskUpdateInput,
  TodoItem
} from '../shared/types';

/**
 * Higher-level coordinator that owns a TaskStore and exposes the operations the
 * IPC layer calls. It wraps every store mutation and re-emits the domain events
 * so the IPC layer can broadcast to windows, and it owns the recurrence rollover
 * policy: completing a recurring task spawns the next instance instead of
 * rescheduling in place (an audit-friendly, append-only history of instances).
 */
export class TaskService extends EventEmitter {
  constructor(private readonly store: TaskStore) {
    super();
  }

  // ── Read pass-throughs ─────────────────────────────────────────────────────

  getTasks(): Task[] {
    return this.store.getTasks();
  }

  getProjects(): Project[] {
    return this.store.getProjects();
  }

  getTask(id: string): Task | null {
    return this.store.getTask(id);
  }

  getProject(id: string): Project | null {
    return this.store.getProject(id);
  }

  getActiveTaskId(): string | null {
    return this.store.getActiveTaskId();
  }

  setActiveTask(id: string | null, now: number = Date.now()): Task[] {
    this.store.setActiveTaskId(id, now);
    this.emit('active-task-changed', this.store.getActiveTaskId());
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  // ── Task operations ─────────────────────────────────────────────────────────

  createTask(input: TaskInput, now: number = Date.now()): Task[] {
    this.store.createTask(input, now);
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  updateTask(id: string, input: TaskUpdateInput, now: number = Date.now()): Task[] {
    const before = this.store.getTask(id);
    const { status, ...fields } = input;
    this.store.updateTask(id, fields, now);
    const updated = this.store.getTask(id);
    if (status !== undefined && updated && status !== before?.status) {
      if (status === 'active') {
        this.store.setActiveTaskId(id, now);
      } else {
        this.store.setTaskStatus(id, status, now);
      }
      if (status === 'done' && updated.recurrence) {
        this.rolloverRecurrence(updated, now);
      }
      this.emit('active-task-changed', this.store.getActiveTaskId());
    }
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  /**
   * Transition a task's status. When a recurring task is marked `done`, the
   * next occurrence is spawned as a fresh `inbox` instance anchored to the next
   * fire time; the just-completed instance stays `done`. Emits `tasks-changed`
   * exactly once with the full resulting list (completed task + new instance).
   */
  setTaskStatus(id: string, status: TaskStatus, now: number = Date.now()): Task[] {
    const task = this.store.getTask(id);
    if (!task) {
      this.emit('tasks-changed', this.store.getTasks());
      return this.store.getTasks();
    }

    if (status === 'active') {
      this.store.setActiveTaskId(id, now);
    } else {
      this.store.setTaskStatus(id, status, now);
    }

    if (status === 'done' && task.recurrence) {
      this.rolloverRecurrence(task, now);
    }

    this.emit('active-task-changed', this.store.getActiveTaskId());
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  deleteTask(id: string, now: number = Date.now()): Task[] {
    this.store.deleteTask(id, now);
    this.emit('active-task-changed', this.store.getActiveTaskId());
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  // ── Project operations ────────────────────────────────────────────────────

  createProject(input: ProjectInput, now: number = Date.now()): Project[] {
    this.store.createProject(input, now);
    this.emit('projects-changed', this.store.getProjects());
    return this.store.getProjects();
  }

  updateProject(id: string, input: ProjectUpdateInput, now: number = Date.now()): Project[] {
    this.store.updateProject(id, input, now);
    this.emit('projects-changed', this.store.getProjects());
    return this.store.getProjects();
  }

  deleteProject(id: string, now: number = Date.now()): Project[] {
    this.store.deleteProject(id, now);
    // Deleting a project detaches its tasks, so both domain events fire.
    this.emit('projects-changed', this.store.getProjects());
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getProjects();
  }

  // ── First-run migration ─────────────────────────────────────────────────────

  /**
   * Convert legacy TodoItems and alarms exactly once. The SQLite transaction
   * commits before SettingsStore removes the old fields and tasks.json source.
   */
  migrateFromTodos(legacyTodos: TodoItem[], now: number = Date.now(), legacyAlarms: Alarm[] = []): Task[] {
    const tasks = this.store.migrateLegacy(legacyTodos, legacyAlarms, now);
    this.emit('tasks-changed', this.store.getTasks());
    return tasks;
  }

  // ── Recurrence rollover ────────────────────────────────────────────────────

  /**
   * Spawn the next instance of a just-completed recurring task. The next fire
   * is computed from the scheduled anchor (reminderAt) for calendar-based rules
   * and from the completion time for `after-completion`, then plannedAt/dueAt
   * are shifted by the same delta so their offset from the reminder is kept.
   */
  private rolloverRecurrence(task: Task, now: number): void {
    const rule: RecurrenceRule = task.recurrence!;
    const completedAt = task.completedAt ?? now;

    // Calendar-based rules step from their scheduled anchor; the after-completion
    // rule is explicitly anchored to the moment of completion.
    const anchor =
      rule.type === 'after-completion'
        ? completedAt
        : task.reminderAt ?? task.dueAt ?? task.plannedAt ?? completedAt;

    // A rollover always advances beyond the current occurrence. A due time
    // later today must not become another same-day instance merely because the
    // user completed the current task before that time.
    const nextFire = nextRecurrenceFireAt(rule, anchor, Math.max(now, anchor + 1));
    if (nextFire === null) {
      // Rule cannot produce a future occurrence (e.g. weekly with no weekdays).
      return;
    }

    const delta = nextFire - anchor;
    const hasScheduledField =
      task.plannedAt !== null || task.dueAt !== null || task.reminderAt !== null;
    this.store.createTask(
      {
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        projectId: task.projectId,
        parentId: task.parentId,
        tags: task.tags,
        // Shift the planned/due/reminder dates together so their relative
        // spacing is preserved across occurrences.
        plannedAt: task.plannedAt !== null
          ? task.plannedAt + delta
          : hasScheduledField
            ? null
            : nextFire,
        dueAt: task.dueAt !== null ? task.dueAt + delta : null,
        reminderAt: task.reminderAt !== null ? task.reminderAt + delta : null,
        recurrence: task.recurrence,
        context: task.context,
        remindOnBreak: task.remindOnBreak,
        estimateMinutes: task.estimateMinutes
      },
      now
    );
  }
}
