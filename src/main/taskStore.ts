import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  sanitizeProject,
  sanitizeProjects,
  sanitizeTask,
  sanitizeTasks,
  sanitizeStandaloneReminder,
  sanitizeStandaloneReminderSchedule,
  type Project,
  type ProjectInput,
  type Alarm,
  type PersistedScheduledEvent,
  type StandaloneReminder,
  type StandaloneReminderInput,
  type Task,
  type TaskInput,
  type TaskMoveInput,
  type TaskUpdateInput,
  type TaskStatus,
  type UndoState,
  type CharacterCollectionState,
  type FailedDeliveryNotice,
  type TodoItem
} from '../shared/types';

const DATABASE_FILE = 'eyeprotect.db';
const LEGACY_TASKS_FILE = 'tasks.json';
const SCHEMA_VERSION = 3;

export interface TaskReminderOccurrence {
  taskId: string;
  fireAt: number;
  consumedAt: number | null;
}

export type DeliverySource = 'task' | 'standalone' | 'timebox';
export type DeliveryState = 'due' | 'presenting' | 'delivered' | 'clicked' | 'dismissed' | 'failed';

export interface NotificationDelivery {
  id: string;
  source: DeliverySource;
  sourceId: string;
  occurrenceAt: number;
  title: string;
  body: string;
  state: DeliveryState;
  attempts: number;
  firstDueAt: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  deliveredAt: number | null;
}

export interface TaskDatabaseRecovery {
  readOnly: boolean;
  snapshotPath: string | null;
  reason: string | null;
}

export interface TaskStoreOptions {
  allowTaskModelReset?: boolean;
}

interface LegacyTasksFile {
  version?: number;
  tasks?: unknown;
  projects?: unknown;
}

type SqlValue = string | number | bigint | null | Uint8Array;
type SqlRow = Record<string, SqlValue>;

/**
 * Main-process-only SQLite store for tasks and projects. The public methods keep
 * the previous TaskStore shape so the service and renderer migration can remain
 * incremental, while every mutation is now an atomic database transaction.
 */
export class TaskStore extends EventEmitter {
  private static readonly openStores = new Map<string, Set<TaskStore>>();
  private readonly filePath: string;
  private readonly allowTaskModelReset: boolean;
  private db: DatabaseSync;
  private transactionDepth = 0;
  private recovery: TaskDatabaseRecovery = { readOnly: false, snapshotPath: null, reason: null };

  constructor(dataDir: string, options: TaskStoreOptions = {}) {
    super();
    this.filePath = join(dataDir, DATABASE_FILE);
    this.allowTaskModelReset = options.allowTaskModelReset !== false;
    this.db = this.openDatabase();
    try {
      this.migrateSchema();
    } catch (error) {
      // SQLite may accept the file handle before discovering malformed pages.
      // Preserve the complete database family, then run an ephemeral recovery
      // session. The original path is never renamed or overwritten here.
      if (this.db.isOpen) {
        this.db.close();
      }
      const snapshotPath = this.snapshotDatabase();
      this.recovery = {
        readOnly: true,
        snapshotPath,
        reason: error instanceof Error ? error.message : '数据库迁移失败'
      };
      this.db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
      this.migrateSchema();
    }
    const stores = TaskStore.openStores.get(this.filePath) ?? new Set<TaskStore>();
    stores.add(this);
    TaskStore.openStores.set(this.filePath, stores);
  }

  static closeAllForDirectory(dataDir: string): void {
    const path = join(dataDir, DATABASE_FILE);
    for (const store of [...(TaskStore.openStores.get(path) ?? [])]) {
      store.close();
    }
  }

  static requiresTaskModelReset(dataDir: string): boolean {
    const path = join(dataDir, DATABASE_FILE);
    if (!existsSync(path)) return false;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`).get() as
        | SqlRow
        | undefined;
      const sql = typeof row?.sql === 'string' ? row.sql : '';
      return sql.includes("'inbox'") || sql.includes("'active'");
    } catch {
      return false;
    } finally {
      if (db?.isOpen) db.close();
    }
  }

  getDataDir(): string {
    return join(this.filePath, '..');
  }

  getRecoveryStatus(): TaskDatabaseRecovery {
    return { ...this.recovery };
  }

  getCharacterCollectionState(): CharacterCollectionState | null {
    const row = this.db.prepare('SELECT data_json FROM character_collection_state WHERE id = 1').get() as SqlRow | undefined;
    if (!row || typeof row.data_json !== 'string') return null;
    try {
      return JSON.parse(row.data_json) as CharacterCollectionState;
    } catch {
      return null;
    }
  }

  replaceCharacterCollectionState(state: CharacterCollectionState): CharacterCollectionState {
    this.db.prepare(`
      INSERT INTO character_collection_state(id, data_json, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(state), Date.now());
    this.emit('character-collection-changed', state);
    return structuredClone(state);
  }

  close(): void {
    if (this.db.isOpen) {
      this.db.close();
    }
    TaskStore.openStores.get(this.filePath)?.delete(this);
  }

  getTasks(): Task[] {
    const rows = this.db.prepare(`
      SELECT id, title, notes, status, priority, project_id, parent_id,
             planned_at, due_at, reminder_at, recurrence_json, context,
             remind_on_break, estimate_minutes, sort_order, created_at, updated_at, completed_at
      FROM tasks
      ORDER BY sort_order, created_at, id
    `).all() as SqlRow[];
    const tagsByTask = this.readTagsByTask();
    return rows.map((row) => rowToTask(row, tagsByTask.get(String(row.id)) ?? []));
  }

  getProjects(): Project[] {
    return (this.db.prepare(`
      SELECT id, name, color, parent_id, sort_order, created_at, updated_at
      FROM projects
      ORDER BY sort_order, created_at, id
    `).all() as SqlRow[]).map(rowToProject);
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare(`
      SELECT id, title, notes, status, priority, project_id, parent_id,
             planned_at, due_at, reminder_at, recurrence_json, context,
             remind_on_break, estimate_minutes, sort_order, created_at, updated_at, completed_at
      FROM tasks WHERE id = ?
    `).get(id) as SqlRow | undefined;
    if (!row) {
      return null;
    }
    const tags = (this.db.prepare(`
      SELECT tags.name FROM tags
      JOIN task_tags ON task_tags.tag_id = tags.id
      WHERE task_tags.task_id = ? ORDER BY tags.name COLLATE NOCASE
    `).all(id) as SqlRow[]).map((entry) => String(entry.name));
    return rowToTask(row, tags);
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare(`
      SELECT id, name, color, parent_id, sort_order, created_at, updated_at
      FROM projects WHERE id = ?
    `).get(id) as SqlRow | undefined;
    return row ? rowToProject(row) : null;
  }

  getActiveTaskId(): string | null {
    const row = this.db.prepare("SELECT value FROM app_state WHERE key = 'active_task_id'").get() as
      | SqlRow
      | undefined;
    return row && typeof row.value === 'string' && this.getTask(row.value) ? row.value : null;
  }

  setActiveTaskId(id: string | null, _now: number = Date.now()): string | null {
    const validId = id && this.getTask(id) && !['done', 'archived'].includes(this.getTask(id)?.status ?? '') ? id : null;
    this.transaction(() => {
      if (validId) {
        this.db.prepare(`
          INSERT INTO app_state(key, value) VALUES ('active_task_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(validId);
      } else {
        this.db.prepare("DELETE FROM app_state WHERE key = 'active_task_id'").run();
      }
    });
    return validId;
  }

  createTask(input: TaskInput, now: number = Date.now()): Task {
    const seed = sanitizeTask({
      id: randomUUID(),
      title: typeof input.title === 'string' && input.title.trim() ? input.title : '(untitled)',
      notes: input.notes,
      priority: input.priority,
      projectId: input.projectId,
      parentId: input.parentId,
      tags: input.tags,
      plannedAt: input.plannedAt,
      dueAt: input.dueAt,
      reminderAt: input.reminderAt,
      recurrence: input.recurrence,
      context: input.context,
      remindOnBreak: input.remindOnBreak,
      estimateMinutes: input.estimateMinutes,
      sortOrder: this.nextSortOrder(),
      createdAt: now,
      updatedAt: now
    })!;
    const task = this.normalizeRelations(seed);
    this.transaction(() => {
      this.insertTask(task);
      this.writeTaskTags(task.id, task.tags);
    });
    const result = this.getTask(task.id)!;
    this.emit('tasks-changed', this.getTasks());
    return result;
  }

  updateTask(id: string, input: TaskUpdateInput, now: number = Date.now()): Task | null {
    const current = this.getTask(id);
    if (!current) {
      return null;
    }
    const candidate = sanitizeTask({ ...current, ...input, id, updatedAt: now });
    if (!candidate) {
      return current;
    }
    const next = this.normalizeRelations({
      ...candidate,
      completedAt: candidate.status === 'done' ? current.completedAt ?? now : null
    });
    if (next.parentId && this.wouldCreateTaskCycle(id, next.parentId)) {
      next.parentId = current.parentId;
    }
    this.transaction(() => {
      this.db.prepare(`
        UPDATE tasks SET title = ?, notes = ?, status = ?, priority = ?, project_id = ?,
          parent_id = ?, planned_at = ?, due_at = ?, reminder_at = ?, recurrence_json = ?,
          context = ?, remind_on_break = ?, estimate_minutes = ?, sort_order = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(...taskSqlValues(next).slice(1, 15), next.updatedAt, next.completedAt, id);
      this.writeTaskTags(id, next.tags);
      if (next.status === 'done' || next.status === 'archived') {
        this.db.prepare("DELETE FROM app_state WHERE key = 'active_task_id' AND value = ?").run(id);
      }
    });
    const result = this.getTask(id);
    this.emit('tasks-changed', this.getTasks());
    return result;
  }

  setTaskStatus(id: string, status: TaskStatus, now: number = Date.now()): Task | null {
    return this.updateTask(id, { status }, now);
  }

  /**
   * Execute a multi-method domain transition atomically. Store methods may use
   * their own transactions; nested calls join this outer transaction.
   */
  runInTransaction<T>(action: () => T): T {
    return this.transaction(action);
  }

  /** Exactly-once claim for one completed recurring task instance. */
  claimRecurrenceRollover(sourceTaskId: string, occurrenceAt: number, now: number = Date.now()): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO task_recurrence_rollovers(source_task_id, occurrence_at, created_at)
      VALUES (?, ?, ?)
    `).run(sourceTaskId, occurrenceAt, now);
    return Number(result.changes) === 1;
  }

  moveTask(input: TaskMoveInput, now: number = Date.now()): Task[] {
    const inContainer = (task: Task): boolean =>
      task.status === 'open' &&
      (input.scope.type === 'inbox'
        ? task.projectId === null
        : task.projectId === input.scope.projectId);
    const task = this.getTask(input.taskId);
    if (!task || !inContainer(task)) return this.getTasks();
    // Manual order is scoped to siblings. Moving a child must never silently
    // reorder unrelated roots or children of another parent.
    const inScope = (candidate: Task): boolean =>
      inContainer(candidate) && candidate.parentId === task.parentId;
    const ordered = this.getTasks().filter(inScope).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
    const moving = ordered.find((entry) => entry.id === input.taskId)!;
    const rest = ordered.filter((entry) => entry.id !== input.taskId);
    const beforeIndex = input.beforeTaskId === null
      ? rest.length
      : rest.findIndex((entry) => entry.id === input.beforeTaskId);
    if (beforeIndex < 0) return this.getTasks();
    rest.splice(beforeIndex, 0, moving);
    this.transaction(() => {
      const statement = this.db.prepare('UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ?');
      rest.forEach((entry, index) => statement.run(index, now, entry.id));
    });
    this.emit('tasks-changed', this.getTasks());
    return this.getTasks();
  }

  deleteTask(id: string, now: number = Date.now()): boolean {
    if (!this.getTask(id)) {
      return false;
    }
    this.transaction(() => {
      this.db.prepare('UPDATE tasks SET parent_id = NULL, updated_at = ? WHERE parent_id = ?').run(now, id);
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      this.db.prepare("DELETE FROM app_state WHERE key = 'active_task_id' AND value = ?").run(id);
    });
    this.emit('tasks-changed', this.getTasks());
    return true;
  }

  deleteTaskTree(id: string): Task[] {
    const tasks = this.getTasks();
    const ids = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of tasks) {
        if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) {
          ids.add(task.id);
          changed = true;
        }
      }
    }
    const removed = tasks.filter((task) => ids.has(task.id));
    if (removed.length === 0) return [];
    this.transaction(() => {
      for (const taskId of [...ids].reverse()) {
        this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
        this.db.prepare("DELETE FROM app_state WHERE key = 'active_task_id' AND value = ?").run(taskId);
      }
    });
    this.emit('tasks-changed', this.getTasks());
    return removed;
  }

  createUndoOperation(
    kind: 'complete' | 'delete',
    taskTitle: string,
    tasks: Task[],
    removeIds: string[],
    activeTaskId: string | null,
    now: number = Date.now()
  ): UndoState {
    this.purgeExpiredUndo(now);
    const operation: UndoState = { operationId: randomUUID(), kind, taskTitle, expiresAt: now + 10_000 };
    const sessions = tasks.length === 0 ? [] : this.db.prepare(`
      SELECT * FROM work_sessions WHERE task_id IN (${tasks.map(() => '?').join(',')})
    `).all(...tasks.map((task) => task.id));
    this.db.prepare(`
      INSERT INTO undo_operations(id, kind, task_title, payload_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(operation.operationId, kind, taskTitle, JSON.stringify({ tasks, removeIds, activeTaskId, sessions }), operation.expiresAt, now);
    return operation;
  }

  getUndoState(now: number = Date.now()): UndoState | null {
    this.purgeExpiredUndo(now);
    const row = this.db.prepare(`
      SELECT id, kind, task_title, expires_at FROM undo_operations
      WHERE expires_at >= ? ORDER BY created_at DESC LIMIT 1
    `).get(now) as SqlRow | undefined;
    return row ? {
      operationId: String(row.id),
      kind: String(row.kind) as UndoState['kind'],
      taskTitle: String(row.task_title),
      expiresAt: Number(row.expires_at)
    } : null;
  }

  undoOperation(operationId: string, now: number = Date.now()): boolean {
    const row = this.db.prepare(`SELECT payload_json, expires_at FROM undo_operations WHERE id = ?`).get(operationId) as SqlRow | undefined;
    if (!row || Number(row.expires_at) < now || typeof row.payload_json !== 'string') {
      this.purgeExpiredUndo(now);
      return false;
    }
    const payload = JSON.parse(row.payload_json) as {
      tasks: Task[];
      removeIds: string[];
      activeTaskId: string | null;
      sessions: SqlRow[];
    };
    const tasks = sanitizeTasks(payload.tasks, now);
    this.transaction(() => {
      for (const id of payload.removeIds ?? []) this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      for (const task of tasks) {
        // Undoing completion restores the source instance to its pre-complete
        // state; release its exactly-once claim so a later genuine completion
        // may generate the recurrence again.
        this.db.prepare('DELETE FROM task_recurrence_rollovers WHERE source_task_id = ?').run(task.id);
        this.upsertTask(task);
        this.writeTaskTags(task.id, task.tags);
      }
      for (const session of payload.sessions ?? []) {
        this.db.prepare(`INSERT OR IGNORE INTO work_sessions(id, task_id, started_at, ended_at, active_ms) VALUES (?, ?, ?, ?, ?)`)
          .run(session.id, session.task_id, session.started_at, session.ended_at, session.active_ms);
      }
      if (payload.activeTaskId && this.getTask(payload.activeTaskId)) {
        this.db.prepare(`INSERT INTO app_state(key, value) VALUES ('active_task_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(payload.activeTaskId);
      }
      this.db.prepare('DELETE FROM undo_operations WHERE id = ?').run(operationId);
    });
    this.emit('tasks-changed', this.getTasks());
    return true;
  }

  private purgeExpiredUndo(now: number): void {
    this.db.prepare('DELETE FROM undo_operations WHERE expires_at < ?').run(now);
  }

  createProject(input: ProjectInput, now: number = Date.now()): Project {
    const project = sanitizeProject({
      id: randomUUID(),
      name: typeof input.name === 'string' && input.name.trim() ? input.name : 'Untitled',
      color: input.color,
      parentId: input.parentId,
      sortOrder: this.nextProjectSortOrder(),
      createdAt: now,
      updatedAt: now
    })!;
    const parentId = project.parentId && this.getProject(project.parentId) ? project.parentId : null;
    this.db.prepare(`
      INSERT INTO projects(id, name, color, parent_id, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(project.id, project.name, project.color, parentId, project.sortOrder, project.createdAt, project.updatedAt);
    const result = this.getProject(project.id)!;
    this.emit('projects-changed', this.getProjects());
    return result;
  }

  updateProject(id: string, input: Partial<ProjectInput>, now: number = Date.now()): Project | null {
    const current = this.getProject(id);
    if (!current) {
      return null;
    }
    const next = sanitizeProject({ ...current, ...input, id, updatedAt: now });
    if (!next) {
      return current;
    }
    const parentId = next.parentId && next.parentId !== id && this.getProject(next.parentId) &&
      !this.wouldCreateProjectCycle(id, next.parentId)
      ? next.parentId
      : current.parentId;
    this.db.prepare(`
      UPDATE projects SET name = ?, color = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?
    `).run(next.name, next.color, parentId, next.sortOrder, now, id);
    const result = this.getProject(id);
    this.emit('projects-changed', this.getProjects());
    return result;
  }

  deleteProject(id: string, now: number = Date.now()): boolean {
    if (!this.getProject(id)) {
      return false;
    }
    this.transaction(() => {
      this.db.prepare('UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?').run(now, id);
      this.db.prepare('UPDATE projects SET parent_id = NULL, updated_at = ? WHERE parent_id = ?').run(now, id);
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    });
    this.emit('projects-changed', this.getProjects());
    this.emit('tasks-changed', this.getTasks());
    return true;
  }

  replaceAll(tasks: Task[], now: number = Date.now()): Task[] {
    const safe = sanitizeTasks(tasks).map((task, sortOrder) => ({ ...task, sortOrder, updatedAt: task.updatedAt || now }));
    if (hasRelationCycle(safe)) {
      throw new Error('Task hierarchy must be acyclic');
    }
    this.transaction(() => {
      this.db.exec('DELETE FROM task_tags; DELETE FROM task_reminders; DELETE FROM tasks;');
      for (const raw of safe) {
        const task = this.normalizeRelations({ ...raw, parentId: null });
        this.insertTask(task);
        this.writeTaskTags(task.id, task.tags);
      }
      // Restore parent links, but never write a cycle. wouldCreateRelationCycle
      // also returns true when the parent is missing, so a dangling parent is
      // safely left NULL instead of corrupting the hierarchy.
      const byId = new Map(safe.map((task) => [task.id, task]));
      for (const raw of safe) {
        if (raw.parentId && raw.parentId !== raw.id && byId.has(raw.parentId) &&
            !wouldCreateRelationCycle(raw.id, raw.parentId, byId)) {
          this.db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(raw.parentId, raw.id);
        }
      }
    });
    this.emit('tasks-changed', this.getTasks());
    return this.getTasks();
  }

  replaceProjects(projects: Project[]): Project[] {
    const safe = sanitizeProjects(projects);
    if (hasRelationCycle(safe)) {
      throw new Error('Project hierarchy must be acyclic');
    }
    this.transaction(() => {
      this.db.exec('UPDATE tasks SET project_id = NULL; DELETE FROM projects;');
      for (const project of safe) {
        this.db.prepare(`
          INSERT INTO projects(id, name, color, parent_id, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?)
        `).run(project.id, project.name, project.color, project.sortOrder, project.createdAt, project.updatedAt);
      }
      // Same cycle guard as replaceAll: skip any parent link that would close a
      // loop (or point at a missing project), leaving parent_id NULL instead.
      const projectsById = new Map(safe.map((project) => [project.id, project]));
      for (const project of safe) {
        if (project.parentId && project.parentId !== project.id && projectsById.has(project.parentId) &&
            !wouldCreateRelationCycle(project.id, project.parentId, projectsById)) {
          this.db.prepare('UPDATE projects SET parent_id = ? WHERE id = ?').run(project.parentId, project.id);
        }
      }
    });
    this.emit('projects-changed', this.getProjects());
    this.emit('tasks-changed', this.getTasks());
    return this.getProjects();
  }

  replaceStandaloneReminders(reminders: StandaloneReminder[]): StandaloneReminder[] {
    const safe = reminders.map((entry) => sanitizeStandaloneReminder(entry)).filter((entry): entry is StandaloneReminder => Boolean(entry));
    this.transaction(() => {
      this.db.exec("DELETE FROM scheduled_events WHERE owner = 'standalone'; DELETE FROM standalone_reminders;");
      const insert = this.db.prepare(`
        INSERT INTO standalone_reminders(id, label, schedule_json, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const reminder of safe) {
        insert.run(reminder.id, reminder.label, JSON.stringify(reminder.schedule), reminder.enabled ? 1 : 0, reminder.createdAt, reminder.updatedAt);
      }
    });
    this.emit('standalone-reminders-changed', this.getStandaloneReminders());
    return this.getStandaloneReminders();
  }

  /** Import richer tasks.json plus legacy Todo items exactly once, then delete the JSON source. */
  migrateLegacy(legacyTodos: TodoItem[], legacyAlarms: Alarm[] = [], now: number = Date.now()): Task[] {
    if (this.migrationCompleted()) {
      return this.getTasks();
    }
    const legacyPath = join(this.getDataDir(), LEGACY_TASKS_FILE);
    let fileTasks: Task[] = [];
    let fileProjects: Project[] = [];
    if (existsSync(legacyPath)) {
      const parsed = JSON.parse(readFileSync(legacyPath, 'utf8')) as LegacyTasksFile;
      if (parsed.version !== 1) {
        throw new Error('Unsupported legacy task schema');
      }
      fileTasks = sanitizeTasks(parsed.tasks);
      fileProjects = sanitizeProjects(parsed.projects);
    }
    // Merge without dropping work that may already have landed in SQLite.
    // Rich tasks.json entries win ID collisions; a legacy Todo only fills a
    // missing id. This makes a retried first launch deterministic.
    const byId = new Map(this.getTasks().map((task) => [task.id, task]));
    for (const [sortOrder, todo] of legacyTodos.entries()) {
      if (!byId.has(todo.id)) {
        byId.set(todo.id, migrateTodo(todo, sortOrder, now));
      }
    }
    for (const task of fileTasks) {
      byId.set(task.id, task);
    }
    const projectsById = new Map(this.getProjects().map((project) => [project.id, project]));
    for (const project of fileProjects) {
      projectsById.set(project.id, project);
    }
    this.transaction(() => {
      for (const project of projectsById.values()) {
        this.db.prepare(`
          INSERT INTO projects(id, name, color, parent_id, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
            parent_id = NULL, sort_order = excluded.sort_order,
            created_at = excluded.created_at, updated_at = excluded.updated_at
        `).run(project.id, project.name, project.color, project.sortOrder, project.createdAt, project.updatedAt);
      }
      for (const task of byId.values()) {
        const normalized = this.normalizeRelations({ ...task, parentId: null });
        this.upsertTask(normalized);
        this.writeTaskTags(normalized.id, normalized.tags);
      }
      const insertReminder = this.db.prepare(`
        INSERT OR IGNORE INTO standalone_reminders(id, label, schedule_json, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const alarm of legacyAlarms) {
        const schedule = alarm.repeat === 'daily'
          ? { type: 'daily' as const, hour: alarm.hour, minute: alarm.minute }
          : { type: 'once' as const, fireAt: nextLegacyAlarmFireAt(alarm, now) };
        insertReminder.run(
          alarm.id,
          alarm.label ?? '',
          JSON.stringify(schedule),
          alarm.enabled ? 1 : 0,
          alarm.createdAt,
          now
        );
      }
      for (const task of byId.values()) {
        if (task.parentId && !wouldCreateRelationCycle(task.id, task.parentId, byId)) {
          this.db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(task.parentId, task.id);
        }
      }
      for (const project of projectsById.values()) {
        if (project.parentId && !wouldCreateRelationCycle(project.id, project.parentId, projectsById)) {
          this.db.prepare('UPDATE projects SET parent_id = ? WHERE id = ?').run(project.parentId, project.id);
        }
      }
      this.db.prepare(`
        DELETE FROM app_state WHERE key = 'active_task_id' AND value NOT IN (
          SELECT id FROM tasks WHERE status = 'open'
        )
      `).run();
      this.db.prepare(`
        INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)
        ON CONFLICT(version) DO UPDATE SET applied_at = excluded.applied_at
      `).run(1001, now);
    });
    if (existsSync(legacyPath)) {
      unlinkSync(legacyPath);
    }
    const result = this.getTasks();
    if (result.length > 0) {
      this.emit('tasks-changed', result);
    }
    return result;
  }

  getStandaloneReminders(): StandaloneReminder[] {
    return (this.db.prepare(`
      SELECT id, label, schedule_json, enabled, created_at, updated_at
      FROM standalone_reminders ORDER BY created_at, id
    `).all() as SqlRow[]).map((row) => sanitizeStandaloneReminder({
      id: String(row.id),
      label: String(row.label),
      schedule: parseJson(row.schedule_json),
      enabled: Number(row.enabled) === 1,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    })!).filter(Boolean);
  }

  createStandaloneReminder(input: StandaloneReminderInput, now: number = Date.now()): StandaloneReminder {
    const schedule = sanitizeStandaloneReminderSchedule(input.schedule);
    if (!schedule) {
      throw new Error('Invalid standalone reminder schedule');
    }
    const reminder: StandaloneReminder = {
      id: randomUUID(),
      label: typeof input.label === 'string' ? input.label.trim().slice(0, 80) : '',
      schedule,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(`
      INSERT INTO standalone_reminders(id, label, schedule_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(reminder.id, reminder.label, JSON.stringify(reminder.schedule), reminder.enabled ? 1 : 0, now, now);
    this.emit('standalone-reminders-changed', this.getStandaloneReminders());
    return reminder;
  }

  updateStandaloneReminder(id: string, input: Partial<StandaloneReminderInput>, now: number = Date.now()): StandaloneReminder | null {
    const current = this.getStandaloneReminders().find((entry) => entry.id === id);
    if (!current) {
      return null;
    }
    const schedule = input.schedule === undefined ? current.schedule : sanitizeStandaloneReminderSchedule(input.schedule);
    if (!schedule) {
      throw new Error('Invalid standalone reminder schedule');
    }
    const next: StandaloneReminder = {
      ...current,
      label: input.label === undefined ? current.label : input.label.trim().slice(0, 80),
      schedule,
      enabled: input.enabled === undefined ? current.enabled : input.enabled,
      updatedAt: now
    };
    this.db.prepare(`
      UPDATE standalone_reminders SET label = ?, schedule_json = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(next.label, JSON.stringify(next.schedule), next.enabled ? 1 : 0, now, id);
    // A schedule edit invalidates the occurrence selected from the old rule.
    this.db.prepare("DELETE FROM scheduled_events WHERE owner = 'standalone' AND payload_ref = ?").run(id);
    this.emit('standalone-reminders-changed', this.getStandaloneReminders());
    return next;
  }

  deleteStandaloneReminder(id: string): boolean {
    const result = this.db.prepare('DELETE FROM standalone_reminders WHERE id = ?').run(id);
    this.db.prepare("DELETE FROM scheduled_events WHERE owner = 'standalone' AND payload_ref = ?").run(id);
    if (Number(result.changes) === 0) {
      return false;
    }
    this.emit('standalone-reminders-changed', this.getStandaloneReminders());
    return true;
  }

  replaceScheduledEvents(owner: PersistedScheduledEvent['owner'], events: PersistedScheduledEvent[]): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM scheduled_events WHERE owner = ?').run(owner);
      const insert = this.db.prepare(`
        INSERT INTO scheduled_events(id, owner, type, fire_at, revision, payload_ref)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        insert.run(event.id, owner, event.type, event.fireAt, event.revision, event.payloadRef);
      }
    });
  }

  getScheduledEvents(owner?: PersistedScheduledEvent['owner']): PersistedScheduledEvent[] {
    const rows = owner
      ? this.db.prepare('SELECT * FROM scheduled_events WHERE owner = ? ORDER BY fire_at').all(owner)
      : this.db.prepare('SELECT * FROM scheduled_events ORDER BY fire_at').all();
    return (rows as SqlRow[]).map((row) => ({
      id: String(row.id),
      owner: String(row.owner) as PersistedScheduledEvent['owner'],
      type: String(row.type),
      fireAt: Number(row.fire_at),
      revision: Number(row.revision),
      payloadRef: typeof row.payload_ref === 'string' ? row.payload_ref : null
    }));
  }

  isTaskReminderConsumed(taskId: string, fireAt: number): boolean {
    const row = this.db.prepare(`
      SELECT consumed_at FROM task_reminders WHERE task_id = ? AND fire_at = ?
    `).get(taskId, fireAt) as SqlRow | undefined;
    return row?.consumed_at !== null && row?.consumed_at !== undefined;
  }

  consumeTaskReminder(taskId: string, fireAt: number, consumedAt: number = Date.now()): void {
    this.db.prepare(`
      UPDATE task_reminders SET consumed_at = ? WHERE task_id = ? AND fire_at = ?
    `).run(consumedAt, taskId, fireAt);
  }

  enqueueDelivery(
    source: DeliverySource,
    sourceId: string,
    occurrenceAt: number,
    title: string,
    body: string,
    now: number = Date.now()
  ): NotificationDelivery {
    const id = randomUUID();
    // A re-enqueue of a (source, source_id, occurrence_at) whose row is in a
    // terminal `failed` state atomically resurrects it to `due`. The WHERE
    // clause leaves due/presenting/delivered rows untouched, preserving dedup
    // for in-flight deliveries instead of silently returning the stuck row.
    this.db.prepare(`
      INSERT INTO reminder_delivery(
        id, source, source_id, occurrence_at, title, body, state, attempts,
        first_due_at, next_attempt_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'due', 0, ?, ?)
      ON CONFLICT(source, source_id, occurrence_at) DO UPDATE SET
        state = 'due',
        next_attempt_at = excluded.next_attempt_at,
        attempts = 0,
        last_attempt_at = NULL,
        first_due_at = excluded.first_due_at
      WHERE state = 'failed'
    `).run(id, source, sourceId, occurrenceAt, title, body, now, now);
    return this.getDeliveryByOccurrence(source, sourceId, occurrenceAt)!;
  }

  getDueDeliveries(now: number = Date.now()): NotificationDelivery[] {
    return (this.db.prepare(`
      SELECT * FROM reminder_delivery
      WHERE (state = 'due' AND next_attempt_at <= ?)
         OR (state = 'presenting' AND last_attempt_at <= ?)
      ORDER BY first_due_at, id
    `).all(now, now - 30_000) as SqlRow[]).map(rowToDelivery);
  }

  beginDelivery(id: string, now: number = Date.now()): NotificationDelivery | null {
    this.db.prepare(`
      UPDATE reminder_delivery
      SET state = 'presenting', attempts = attempts + 1, last_attempt_at = ?, next_attempt_at = NULL
      WHERE id = ? AND state IN ('due', 'presenting')
    `).run(now, id);
    return this.getDelivery(id);
  }

  markDeliveryDelivered(id: string, now: number = Date.now()): void {
    this.db.prepare(`UPDATE reminder_delivery SET state = 'delivered', delivered_at = ?, next_attempt_at = NULL WHERE id = ?`)
      .run(now, id);
  }

  markDeliveryOutcome(id: string, state: 'clicked' | 'dismissed'): void {
    this.db.prepare(`UPDATE reminder_delivery SET state = ? WHERE id = ? AND state = 'delivered'`).run(state, id);
  }

  failDelivery(id: string, now: number = Date.now()): NotificationDelivery | null {
    const delivery = this.getDelivery(id);
    if (!delivery) return null;
    const delays = [30_000, 120_000, 300_000];
    const retryDelay = delays[delivery.attempts - 1];
    if (retryDelay === undefined) {
      this.db.prepare(`UPDATE reminder_delivery SET state = 'failed', next_attempt_at = NULL WHERE id = ?`).run(id);
    } else {
      this.db.prepare(`UPDATE reminder_delivery SET state = 'due', next_attempt_at = ? WHERE id = ?`)
        .run(now + retryDelay, id);
    }
    return this.getDelivery(id);
  }

  getFailedDeliveryCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS value FROM reminder_delivery WHERE state = 'failed'`).get() as SqlRow;
    return Number(row.value);
  }

  /**
   * Startup dead-letter recovery. Resets ANY terminal `failed` delivery back to
   * `due` so deliveries that exhausted their retry budget before a crash are
   * re-attempted instead of being silently dropped. Idempotent and safe: a
   * truly-failed delivery should be retried, not forgotten.
   *
   * Wiring (one line, called after deliveryQueue.start() at startup):
   *   deliveryQueue.start();
   *   taskStore.reconcileFailedDeliveries();
   */
  reconcileFailedDeliveries(now: number = Date.now()): void {
    this.db.prepare(`
      UPDATE reminder_delivery
      SET state = 'due', next_attempt_at = ?, attempts = 0,
          last_attempt_at = NULL, first_due_at = ?
      WHERE state = 'failed'
    `).run(now, now);
  }

  recordWorkSegment(taskId: string, startedAt: number, endedAt: number, activeMs: number): void {
    if (!this.getTask(taskId) || activeMs <= 0) return;
    this.db.prepare(`
      INSERT INTO work_sessions(id, task_id, started_at, ended_at, active_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), taskId, startedAt, endedAt, Math.round(activeMs));
  }

  getTaskWorkMs(taskId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(SUM(active_ms), 0) AS value FROM work_sessions WHERE task_id = ?`)
      .get(taskId) as SqlRow;
    return Number(row.value);
  }

  isTimeboxNotified(taskId: string): boolean {
    const row = this.db.prepare('SELECT timebox_notified FROM task_work_state WHERE task_id = ?').get(taskId) as SqlRow | undefined;
    return Number(row?.timebox_notified ?? 0) === 1;
  }

  setTimeboxNotified(taskId: string, notified: boolean): void {
    this.db.prepare(`
      INSERT INTO task_work_state(task_id, timebox_notified) VALUES (?, ?)
      ON CONFLICT(task_id) DO UPDATE SET timebox_notified = excluded.timebox_notified
    `).run(taskId, notified ? 1 : 0);
  }

  getContinuousActiveMs(): number {
    const row = this.db.prepare("SELECT value FROM app_state WHERE key = 'continuous_active_ms'").get() as SqlRow | undefined;
    return Math.max(0, Number(row?.value ?? 0));
  }

  setContinuousActiveMs(value: number): void {
    this.db.prepare(`
      INSERT INTO app_state(key, value) VALUES ('continuous_active_ms', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(Math.max(0, Math.round(value))));
  }

  getNextDeliveryAt(): number | null {
    const row = this.db.prepare(`
      SELECT MIN(CASE WHEN state = 'presenting' THEN last_attempt_at + 30000 ELSE next_attempt_at END) AS value
      FROM reminder_delivery WHERE state IN ('due', 'presenting')
    `).get() as SqlRow;
    return row.value === null ? null : Number(row.value);
  }

  private getDelivery(id: string): NotificationDelivery | null {
    const row = this.db.prepare(`SELECT * FROM reminder_delivery WHERE id = ?`).get(id) as SqlRow | undefined;
    return row ? rowToDelivery(row) : null;
  }

  private getDeliveryByOccurrence(source: DeliverySource, sourceId: string, occurrenceAt: number): NotificationDelivery | null {
    const row = this.db.prepare(`
      SELECT * FROM reminder_delivery WHERE source = ? AND source_id = ? AND occurrence_at = ?
    `).get(source, sourceId, occurrenceAt) as SqlRow | undefined;
    return row ? rowToDelivery(row) : null;
  }

  getTaskReminderOccurrences(): TaskReminderOccurrence[] {
    return (this.db.prepare(`
      SELECT task_id, fire_at, consumed_at FROM task_reminders ORDER BY task_id
    `).all() as SqlRow[]).map((row) => ({
      taskId: String(row.task_id),
      fireAt: Number(row.fire_at),
      consumedAt: nullableNumber(row.consumed_at)
    }));
  }

  replaceTaskReminderOccurrences(occurrences: TaskReminderOccurrence[]): void {
    const tasks = new Map(this.getTasks().map((task) => [task.id, task]));
    this.transaction(() => {
      this.db.prepare('UPDATE task_reminders SET consumed_at = NULL').run();
      const consume = this.db.prepare(`
        UPDATE task_reminders SET consumed_at = ? WHERE task_id = ? AND fire_at = ?
      `);
      for (const occurrence of occurrences) {
        const task = tasks.get(occurrence.taskId);
        if (
          task?.reminderAt === occurrence.fireAt &&
          typeof occurrence.consumedAt === 'number' &&
          Number.isFinite(occurrence.consumedAt)
        ) {
          consume.run(occurrence.consumedAt, occurrence.taskId, occurrence.fireAt);
        }
      }
    });
  }

  private openDatabase(): DatabaseSync {
    try {
      // Electron's embedded node:sqlite build on Windows can fail with
      // SQLITE_CANTOPEN when asked to create the first database file itself.
      // Creating the empty file through Node's filesystem API keeps first-run
      // packaged installs reliable; SQLite still owns all subsequent content.
      if (!existsSync(this.filePath)) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        closeSync(openSync(this.filePath, 'a'));
      }
      return new DatabaseSync(this.filePath, { enableForeignKeyConstraints: true });
    } catch (error) {
      const snapshotPath = this.snapshotDatabase();
      this.recovery = {
        readOnly: true,
        snapshotPath,
        reason: error instanceof Error ? error.message : '无法打开任务数据库'
      };
      return new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    }
  }

  private snapshotDatabase(kind: 'recovery' | 'pre-model-reset' = 'recovery'): string | null {
    const suffix = `.${kind}-${Date.now()}`;
    let snapshotPath: string | null = null;
    for (const path of [this.filePath, `${this.filePath}-wal`, `${this.filePath}-shm`]) {
      if (existsSync(path)) {
        const target = `${path}${suffix}`;
        copyFileSync(path, target);
        if (path === this.filePath) snapshotPath = target;
      }
    }
    return snapshotPath;
  }

  private migrateSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        parent_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL CHECK(status IN ('open','done','archived')),
        priority TEXT NOT NULL CHECK(priority IN ('normal','important','urgent')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        planned_at INTEGER,
        due_at INTEGER,
        reminder_at INTEGER,
        recurrence_json TEXT,
        context TEXT NOT NULL CHECK(context IN ('desk','away','any')),
        remind_on_break INTEGER NOT NULL DEFAULT 0,
        estimate_minutes INTEGER,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS tasks_status_sort ON tasks(status, sort_order);
      CREATE INDEX IF NOT EXISTS tasks_reminder ON tasks(reminder_at) WHERE reminder_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(task_id, tag_id)
      );
      CREATE TABLE IF NOT EXISTS task_reminders (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        fire_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS task_recurrence_rollovers (
        source_task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        occurrence_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(source_task_id, occurrence_at)
      );
      CREATE TABLE IF NOT EXISTS standalone_reminders (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        schedule_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scheduled_events (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        type TEXT NOT NULL,
        fire_at INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        payload_ref TEXT
      );
      CREATE INDEX IF NOT EXISTS scheduled_events_fire ON scheduled_events(fire_at);
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reminder_delivery (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('task','standalone','timebox')),
        source_id TEXT NOT NULL,
        occurrence_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('due','presenting','delivered','clicked','dismissed','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        first_due_at INTEGER NOT NULL,
        last_attempt_at INTEGER,
        next_attempt_at INTEGER,
        delivered_at INTEGER,
        UNIQUE(source, source_id, occurrence_at)
      );
      CREATE INDEX IF NOT EXISTS reminder_delivery_due ON reminder_delivery(state, next_attempt_at);
      CREATE TABLE IF NOT EXISTS work_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        active_ms INTEGER NOT NULL CHECK(active_ms >= 0)
      );
      CREATE INDEX IF NOT EXISTS work_sessions_task ON work_sessions(task_id, started_at);
      CREATE TABLE IF NOT EXISTS task_work_state (
        task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        timebox_notified INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS undo_operations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('complete','delete')),
        task_title TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS character_collection_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        data_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.migrateTaskStatusModel();
    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as SqlRow[];
    if (!taskColumns.some((column) => column.name === 'remind_on_break')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN remind_on_break INTEGER NOT NULL DEFAULT 0');
    }
    const reminderColumns = this.db.prepare('PRAGMA table_info(task_reminders)').all() as SqlRow[];
    if (!reminderColumns.some((column) => column.name === 'consumed_at')) {
      this.db.exec('ALTER TABLE task_reminders ADD COLUMN consumed_at INTEGER');
    }
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, Date.now());
    const defensiveDb = this.db as DatabaseSync & { enableDefensive?: (active: boolean) => void };
    defensiveDb.enableDefensive?.(true);
  }

  private migrationCompleted(): boolean {
    return Boolean(this.db.prepare('SELECT 1 AS ok FROM schema_migrations WHERE version = 1001').get());
  }

  private migrateTaskStatusModel(): void {
    const row = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`).get() as
      | SqlRow
      | undefined;
    const sql = typeof row?.sql === 'string' ? row.sql : '';
    if (!sql.includes("'inbox'") && !sql.includes("'active'")) return;
    if (!this.allowTaskModelReset) {
      throw new Error('用户取消了任务模型迁移；数据库以恢复模式打开');
    }
    this.snapshotDatabase('pre-model-reset');

    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE tasks_v2 (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            notes TEXT,
            status TEXT NOT NULL CHECK(status IN ('open','done','archived')),
            priority TEXT NOT NULL CHECK(priority IN ('normal','important','urgent')),
            project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
            parent_id TEXT REFERENCES tasks_v2(id) ON DELETE SET NULL,
            planned_at INTEGER,
            due_at INTEGER,
            reminder_at INTEGER,
            recurrence_json TEXT,
            context TEXT NOT NULL CHECK(context IN ('desk','away','any')),
            remind_on_break INTEGER NOT NULL DEFAULT 0,
            estimate_minutes INTEGER,
            sort_order INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            completed_at INTEGER
          );
          INSERT INTO tasks_v2
          SELECT id, title, notes,
            CASE WHEN status IN ('inbox','active') THEN 'open' ELSE status END,
            priority, project_id, parent_id, planned_at, due_at, reminder_at,
            recurrence_json, context, remind_on_break, estimate_minutes,
            sort_order, created_at, updated_at, completed_at
          FROM tasks;
          DROP TABLE tasks;
          ALTER TABLE tasks_v2 RENAME TO tasks;
          CREATE INDEX tasks_status_sort ON tasks(status, sort_order);
          CREATE INDEX tasks_reminder ON tasks(reminder_at) WHERE reminder_at IS NOT NULL;
        `);
      });
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }

  private transaction<T>(action: () => T): T {
    if (this.transactionDepth > 0) {
      return action();
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  getFailedDeliveries(): FailedDeliveryNotice[] {
    return (this.db.prepare(`
      SELECT id, source, source_id, occurrence_at, title, body, last_attempt_at
      FROM reminder_delivery WHERE state = 'failed'
      ORDER BY COALESCE(last_attempt_at, first_due_at) DESC
    `).all() as SqlRow[]).map((row) => ({
      id: String(row.id),
      source: String(row.source) as FailedDeliveryNotice['source'],
      sourceId: String(row.source_id),
      occurrenceAt: Number(row.occurrence_at),
      title: String(row.title),
      body: String(row.body),
      failedAt: nullableNumber(row.last_attempt_at)
    }));
  }

  retryFailedDelivery(id: string, now: number = Date.now()): boolean {
    const result = this.db.prepare(`
      UPDATE reminder_delivery SET state = 'due', attempts = 0,
        next_attempt_at = ?, last_attempt_at = NULL
      WHERE id = ? AND state = 'failed'
    `).run(now, id);
    return Number(result.changes) === 1;
  }

  dismissFailedDelivery(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE reminder_delivery SET state = 'dismissed', next_attempt_at = NULL
      WHERE id = ? AND state = 'failed'
    `).run(id);
    return Number(result.changes) === 1;
  }

  private nextSortOrder(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM tasks').get() as SqlRow;
    return Number(row.value);
  }

  private nextProjectSortOrder(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM projects').get() as SqlRow;
    return Number(row.value);
  }

  private normalizeRelations(task: Task): Task {
    return {
      ...task,
      projectId: task.projectId && this.getProject(task.projectId) ? task.projectId : null,
      parentId: task.parentId && task.parentId !== task.id && this.getTask(task.parentId) ? task.parentId : null
    };
  }

  private wouldCreateTaskCycle(id: string, parentId: string): boolean {
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (cursor === id) {
        return true;
      }
      visited.add(cursor);
      cursor = this.getTask(cursor)?.parentId ?? null;
    }
    return false;
  }

  private wouldCreateProjectCycle(id: string, parentId: string): boolean {
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (cursor === id) {
        return true;
      }
      visited.add(cursor);
      cursor = this.getProject(cursor)?.parentId ?? null;
    }
    return false;
  }

  private insertTask(task: Task): void {
    this.db.prepare(`
      INSERT INTO tasks(id, title, notes, status, priority, project_id, parent_id,
        planned_at, due_at, reminder_at, recurrence_json, context, remind_on_break,
        estimate_minutes, sort_order, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...taskSqlValues(task));
    if (task.reminderAt !== null) {
      this.db.prepare('INSERT OR IGNORE INTO task_reminders(task_id, fire_at, consumed_at) VALUES (?, ?, NULL)')
        .run(task.id, task.reminderAt);
    }
  }

  private upsertTask(task: Task): void {
    this.db.prepare(`
      INSERT INTO tasks(id, title, notes, status, priority, project_id, parent_id,
        planned_at, due_at, reminder_at, recurrence_json, context, remind_on_break,
        estimate_minutes, sort_order, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, notes = excluded.notes,
        status = excluded.status, priority = excluded.priority,
        project_id = excluded.project_id, parent_id = excluded.parent_id,
        planned_at = excluded.planned_at, due_at = excluded.due_at,
        reminder_at = excluded.reminder_at, recurrence_json = excluded.recurrence_json,
        context = excluded.context, remind_on_break = excluded.remind_on_break,
        estimate_minutes = excluded.estimate_minutes,
        sort_order = excluded.sort_order, created_at = excluded.created_at,
        updated_at = excluded.updated_at, completed_at = excluded.completed_at
    `).run(...taskSqlValues(task));
  }

  private writeTaskTags(taskId: string, tags: string[]): void {
    this.db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
    const task = this.db.prepare('SELECT reminder_at FROM tasks WHERE id = ?').get(taskId) as SqlRow | undefined;
    if (task?.reminder_at !== null && task?.reminder_at !== undefined) {
      this.db.prepare('DELETE FROM task_reminders WHERE task_id = ? AND fire_at <> ?').run(taskId, task.reminder_at);
      this.db.prepare(`
        INSERT OR IGNORE INTO task_reminders(task_id, fire_at, consumed_at) VALUES (?, ?, NULL)
      `).run(taskId, task.reminder_at);
    } else {
      this.db.prepare('DELETE FROM task_reminders WHERE task_id = ?').run(taskId);
    }
    for (const tag of tags) {
      this.db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)').run(tag);
      this.db.prepare(`
        INSERT OR IGNORE INTO task_tags(task_id, tag_id)
        SELECT ?, id FROM tags WHERE name = ? COLLATE NOCASE
      `).run(taskId, tag);
    }
  }

  private readTagsByTask(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const rows = this.db.prepare(`
      SELECT task_tags.task_id, tags.name FROM task_tags
      JOIN tags ON tags.id = task_tags.tag_id
      ORDER BY tags.name COLLATE NOCASE
    `).all() as SqlRow[];
    for (const row of rows) {
      const taskId = String(row.task_id);
      map.set(taskId, [...(map.get(taskId) ?? []), String(row.name)]);
    }
    return map;
  }
}

const taskSqlValues = (task: Task): SqlValue[] => [
  task.id,
  task.title,
  task.notes,
  task.status,
  task.priority,
  task.projectId,
  task.parentId,
  task.plannedAt,
  task.dueAt,
  task.reminderAt,
  task.recurrence ? JSON.stringify(task.recurrence) : null,
  task.context,
  task.remindOnBreak ? 1 : 0,
  task.estimateMinutes,
  task.sortOrder,
  task.createdAt,
  task.updatedAt,
  task.completedAt
];

const rowToTask = (row: SqlRow, tags: string[]): Task => sanitizeTask({
  id: String(row.id),
  title: String(row.title),
  notes: typeof row.notes === 'string' ? row.notes : null,
  status: String(row.status),
  priority: String(row.priority),
  projectId: typeof row.project_id === 'string' ? row.project_id : null,
  parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
  tags,
  plannedAt: nullableNumber(row.planned_at),
  dueAt: nullableNumber(row.due_at),
  reminderAt: nullableNumber(row.reminder_at),
  recurrence: parseJson(row.recurrence_json),
  context: String(row.context),
  remindOnBreak: Number(row.remind_on_break) === 1,
  estimateMinutes: nullableNumber(row.estimate_minutes),
  sortOrder: Number(row.sort_order),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
  completedAt: nullableNumber(row.completed_at)
})!;

const rowToProject = (row: SqlRow): Project => sanitizeProject({
  id: String(row.id),
  name: String(row.name),
  color: typeof row.color === 'string' ? row.color : null,
  parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
  sortOrder: Number(row.sort_order),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at)
})!;

const nullableNumber = (value: SqlValue | undefined): number | null =>
  typeof value === 'number' || typeof value === 'bigint' ? Number(value) : null;

const parseJson = (value: SqlValue | undefined): unknown => {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const wouldCreateRelationCycle = <T extends { id: string; parentId: string | null }>(
  id: string,
  parentId: string,
  entries: Map<string, T>
): boolean => {
  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    if (cursor === id) {
      return true;
    }
    visited.add(cursor);
    cursor = entries.get(cursor)?.parentId ?? null;
  }
  return !entries.has(parentId);
};

const hasRelationCycle = <T extends { id: string; parentId: string | null }>(entries: T[]): boolean => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return entries.some((entry) =>
    Boolean(entry.parentId) &&
    byId.has(entry.parentId!) &&
    wouldCreateRelationCycle(entry.id, entry.parentId!, byId)
  );
};

const migrateTodo = (todo: TodoItem, sortOrder: number, now: number): Task => ({
  id: todo.id,
  title: todo.text,
  notes: null,
  status: todo.completed ? 'done' : 'open',
  priority: todo.priority,
  projectId: null,
  parentId: null,
  tags: [],
  plannedAt: null,
  dueAt: null,
  reminderAt: null,
  recurrence: null,
  context: todo.remindOnBreak || todo.context === 'away' ? 'away' : 'desk',
  remindOnBreak: todo.remindOnBreak === true,
  estimateMinutes: null,
  sortOrder,
  createdAt: todo.createdAt,
  updatedAt: now,
  completedAt: todo.completed ? todo.completedAt ?? todo.createdAt : null
});

const rowToDelivery = (row: SqlRow): NotificationDelivery => ({
  id: String(row.id),
  source: String(row.source) as DeliverySource,
  sourceId: String(row.source_id),
  occurrenceAt: Number(row.occurrence_at),
  title: String(row.title),
  body: String(row.body),
  state: String(row.state) as DeliveryState,
  attempts: Number(row.attempts),
  firstDueAt: Number(row.first_due_at),
  lastAttemptAt: row.last_attempt_at === null ? null : Number(row.last_attempt_at),
  nextAttemptAt: row.next_attempt_at === null ? null : Number(row.next_attempt_at),
  deliveredAt: row.delivered_at === null ? null : Number(row.delivered_at)
});

const nextLegacyAlarmFireAt = (alarm: Alarm, now: number): number => {
  const date = new Date(now);
  date.setHours(alarm.hour, alarm.minute, 0, 0);
  if (date.getTime() <= now) {
    date.setDate(date.getDate() + 1);
  }
  return date.getTime();
};
