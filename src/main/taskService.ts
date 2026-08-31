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
  TaskMoveInput,
  TaskStatus,
  TaskUpdateInput,
  TodoItem,
  UndoState
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
    // Delta stream pass-through (USERPLAN PR2): single-entity mutations travel
    // as task/project upsert+remove events; bulk operations (undo, import,
    // legacy migration) additionally carry a *-replaced full-list event.
    store.on('task-upserted', (task: Task) => this.emit('task-upserted', task));
    store.on('task-removed', (id: string) => this.emit('task-removed', id));
    store.on('project-upserted', (project: Project) => this.emit('project-upserted', project));
    store.on('project-removed', (id: string) => this.emit('project-removed', id));
    store.on('tasks-replaced', (tasks: Task[]) => this.emit('tasks-replaced', tasks));
    store.on('projects-replaced', (projects: Project[]) => this.emit('projects-replaced', projects));
    store.on('time-blocks-changed', () => this.emit('time-blocks-changed'));
    store.on('daily-plans-changed', (payload: { localDate: string | null }) =>
      this.emit('daily-plans-changed', payload)
    );
    store.on('project-sections-changed', (payload: { projectId: string | null }) =>
      this.emit('project-sections-changed', payload)
    );
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
    let undoOperation: UndoState | null = null;
    this.store.runInTransaction(() => {
      const before = this.store.getTask(id);
      const beforeIds = new Set(this.store.getTasks().map((entry) => entry.id));
      const previousActive = this.store.getActiveTaskId();
      const { status, ...fields } = input;
      this.store.updateTask(id, fields, now);
      const updated = this.store.getTask(id);
      if (status !== undefined && updated && status !== before?.status) {
        this.store.setTaskStatus(id, status, now);
        if (status === 'done' && updated.recurrence) {
          this.rolloverRecurrence(updated, now);
        }
        if (status === 'done' && before) {
          const generated = this.store.getTasks().filter((entry) => !beforeIds.has(entry.id)).map((entry) => entry.id);
          undoOperation = this.store.createUndoOperation('complete', before.title, [before], generated, previousActive, now);
        }
        this.emit('active-task-changed', this.store.getActiveTaskId());
      }
    });
    if (undoOperation) this.emit('undo-changed', undoOperation);
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  /**
   * Transition a task's status. When a recurring task is marked `done`, the
   * next occurrence is spawned as a fresh `open` instance anchored to the next
   * fire time; the just-completed instance stays `done`. Emits `tasks-changed`
   * exactly once with the full resulting list (completed task + new instance).
   */
  setTaskStatus(id: string, status: TaskStatus, now: number = Date.now()): Task[] {
    const task = this.store.getTask(id);
    if (!task) {
      this.emit('tasks-changed', this.store.getTasks());
      return this.store.getTasks();
    }

    let undoOperation: UndoState | null = null;
    this.store.runInTransaction(() => {
      const wasDone = task.status === 'done';
      const beforeIds = new Set(this.store.getTasks().map((entry) => entry.id));
      const previousActive = this.store.getActiveTaskId();
      this.store.setTaskStatus(id, status, now);

      // Rollover fires exactly once on the non-done -> done transition edge. A
      // done -> done re-trigger (double-click, IPC retry, stale UI) must not
      // spawn a duplicate next occurrence.
      if (status === 'done' && !wasDone && task.recurrence) {
        this.rolloverRecurrence(task, now);
      }
      if (status === 'done' && !wasDone) {
        const generated = this.store.getTasks().filter((entry) => !beforeIds.has(entry.id)).map((entry) => entry.id);
        undoOperation = this.store.createUndoOperation('complete', task.title, [task], generated, previousActive, now);
      }
    });

    if (undoOperation) this.emit('undo-changed', undoOperation);

    this.emit('active-task-changed', this.store.getActiveTaskId());
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  deleteTask(id: string, now: number = Date.now()): Task[] {
    const task = this.store.getTask(id);
    if (!task) return this.store.getTasks();
    const previousActive = this.store.getActiveTaskId();
    const removed = this.store.deleteTaskTree(id);
    const operation = this.store.createUndoOperation('delete', task.title, removed, [], previousActive, now);
    this.emit('undo-changed', operation);
    this.emit('active-task-changed', this.store.getActiveTaskId());
    this.emit('tasks-changed', this.store.getTasks());
    return this.store.getTasks();
  }

  getUndoState(now: number = Date.now()): UndoState | null {
    return this.store.getUndoState(now);
  }

  undo(operationId: string, now: number = Date.now()): Task[] {
    if (this.store.undoOperation(operationId, now)) {
      this.emit('active-task-changed', this.store.getActiveTaskId());
      this.emit('tasks-changed', this.store.getTasks());
    }
    this.emit('undo-changed', this.store.getUndoState(now));
    return this.store.getTasks();
  }

  moveTask(input: TaskMoveInput, now: number = Date.now()): Task[] {
    const tasks = this.store.moveTask(input, now);
    this.emit('tasks-changed', tasks);
    return tasks;
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
    // Database-backed claim is the final exactly-once defense. It is made
    // inside the same transaction as status, generated tree and undo record,
    // so a crash cannot leave either half committed.
    if (!this.store.claimRecurrenceRollover(task.id, nextFire, now)) {
      return;
    }

    const delta = nextFire - anchor;
    const hasScheduledField =
      task.plannedAt !== null || task.dueAt !== null || task.reminderAt !== null;
    const nextRoot = this.store.createTask(
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

    // A recurring parent is a checklist template: clone its complete descendant
    // tree into the next occurrence, reset every child to open, and shift any
    // explicit dates by the same delta. Descendant recurrence is intentionally
    // cleared so one tree has exactly one recurrence owner.
    const descendants = this.descendantsOf(task.id);
    const idMap = new Map<string, string>([[task.id, nextRoot.id]]);
    for (const child of descendants) {
      const clone = this.store.createTask({
        title: child.title,
        notes: child.notes,
        priority: child.priority,
        projectId: child.projectId,
        parentId: child.parentId ? idMap.get(child.parentId) ?? nextRoot.id : nextRoot.id,
        tags: child.tags,
        plannedAt: child.plannedAt === null ? null : child.plannedAt + delta,
        dueAt: child.dueAt === null ? null : child.dueAt + delta,
        reminderAt: child.reminderAt === null ? null : child.reminderAt + delta,
        recurrence: null,
        context: child.context,
        remindOnBreak: child.remindOnBreak,
        estimateMinutes: child.estimateMinutes
      }, now);
      idMap.set(child.id, clone.id);
    }
  }

  private descendantsOf(parentId: string): Task[] {
    const tasks = this.store.getTasks();
    const result: Task[] = [];
    // Defense-in-depth: a cyclic parent graph (which normalizeRelations and the
    // cycle guards should prevent) must not cause infinite traversal.
    const visited = new Set<string>();
    let frontier = tasks.filter((task) => task.parentId === parentId);
    while (frontier.length > 0) {
      const next: Task[] = [];
      for (const task of frontier.sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (visited.has(task.id)) continue;
        visited.add(task.id);
        result.push(task);
        next.push(...tasks.filter((candidate) => candidate.parentId === task.id));
      }
      frontier = next;
    }
    return result;
  }
}
