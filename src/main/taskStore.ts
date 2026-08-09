import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
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
  type TaskUpdateInput,
  type TaskStatus,
  type TodoItem
} from '../shared/types';

const DATABASE_FILE = 'eyeprotect.db';
const LEGACY_TASKS_FILE = 'tasks.json';
const SCHEMA_VERSION = 2;

export interface TaskReminderOccurrence {
  taskId: string;
  fireAt: number;
  consumedAt: number | null;
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
  private db: DatabaseSync;

  constructor(dataDir: string) {
    super();
    this.filePath = join(dataDir, DATABASE_FILE);
    this.db = this.openDatabase();
    try {
      this.migrateSchema();
    } catch {
      // SQLite may accept the file handle before discovering malformed pages.
      // Quarantine the full database family and start clean only after closing
      // every handle, so Windows never leaves a locked, half-recovered store.
      if (this.db.isOpen) {
        this.db.close();
      }
      this.quarantineDatabase();
      this.db = new DatabaseSync(this.filePath, { enableForeignKeyConstraints: true });
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

  getDataDir(): string {
    return join(this.filePath, '..');
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

  setActiveTaskId(id: string | null, now: number = Date.now()): string | null {
    const validId = id && this.getTask(id) && !['done', 'archived'].includes(this.getTask(id)?.status ?? '') ? id : null;
    this.transaction(() => {
      if (validId) {
        this.db.prepare(`
          INSERT INTO app_state(key, value) VALUES ('active_task_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(validId);
        this.db.prepare("UPDATE tasks SET status = 'inbox', updated_at = ? WHERE status = 'active' AND id <> ?")
          .run(now, validId);
        this.db.prepare("UPDATE tasks SET status = 'active', completed_at = NULL, updated_at = ? WHERE id = ?")
          .run(now, validId);
      } else {
        this.db.prepare("DELETE FROM app_state WHERE key = 'active_task_id'").run();
        this.db.prepare("UPDATE tasks SET status = 'inbox', updated_at = ? WHERE status = 'active'").run(now);
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
    this.transaction(() => {
      this.db.exec('DELETE FROM task_tags; DELETE FROM task_reminders; DELETE FROM tasks;');
      for (const raw of safe) {
        const task = this.normalizeRelations({ ...raw, parentId: null });
        this.insertTask(task);
        this.writeTaskTags(task.id, task.tags);
      }
      for (const raw of safe) {
        if (raw.parentId && raw.parentId !== raw.id && safe.some((task) => task.id === raw.parentId)) {
          this.db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(raw.parentId, raw.id);
        }
      }
    });
    this.emit('tasks-changed', this.getTasks());
    return this.getTasks();
  }

  replaceProjects(projects: Project[]): Project[] {
    const safe = sanitizeProjects(projects);
    this.transaction(() => {
      this.db.exec('UPDATE tasks SET project_id = NULL; DELETE FROM projects;');
      for (const project of safe) {
        this.db.prepare(`
          INSERT INTO projects(id, name, color, parent_id, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, NULL, ?, ?, ?)
        `).run(project.id, project.name, project.color, project.sortOrder, project.createdAt, project.updatedAt);
      }
      for (const project of safe) {
        if (project.parentId && project.parentId !== project.id && safe.some((entry) => entry.id === project.parentId)) {
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
          SELECT id FROM tasks WHERE status = 'active'
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
      return new DatabaseSync(this.filePath, { enableForeignKeyConstraints: true });
    } catch {
      if (existsSync(this.filePath)) {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      }
      return new DatabaseSync(this.filePath, { enableForeignKeyConstraints: true });
    }
  }

  private quarantineDatabase(): void {
    const suffix = `.corrupt-${Date.now()}`;
    for (const path of [this.filePath, `${this.filePath}-wal`, `${this.filePath}-shm`]) {
      if (existsSync(path)) {
        renameSync(path, `${path}${suffix}`);
      }
    }
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
        status TEXT NOT NULL CHECK(status IN ('inbox','active','done','archived')),
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
    `);
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

  private transaction(action: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      action();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
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

const migrateTodo = (todo: TodoItem, sortOrder: number, now: number): Task => ({
  id: todo.id,
  title: todo.text,
  notes: null,
  status: todo.completed ? 'done' : 'inbox',
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

const nextLegacyAlarmFireAt = (alarm: Alarm, now: number): number => {
  const date = new Date(now);
  date.setHours(alarm.hour, alarm.minute, 0, 0);
  if (date.getTime() <= now) {
    date.setDate(date.getDate() + 1);
  }
  return date.getTime();
};
