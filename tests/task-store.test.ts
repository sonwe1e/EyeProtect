import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TaskStore } from '../src/main/taskStore';
import {
  PROJECT_GOAL_MAX,
  PROJECT_NAME_MAX,
  TASK_TITLE_MAX,
  sanitizeTask,
  type Task,
  type TodoItem
} from '../src/shared/types';

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

const withTempStore = (fn: (store: TaskStore, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-ts-'));
  try {
    fn(new TaskStore(dir), dir);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

const sampleTask = (over: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: '写论文',
    notes: null,
    status: 'open',
    priority: 'normal',
    projectId: null,
    parentId: null,
    tags: [],
    plannedAt: null,
    dueAt: null,
    reminderAt: null,
    recurrence: null,
    context: 'desk',
    remindOnBreak: false,
    estimateMinutes: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...over
  }) as Task;

// ── Construction & deep-copy isolation ────────────────────────────────────────

test('constructor starts with empty tasks and projects', () => {
  withTempStore((store) => {
    assert.equal(store.getTasks().length, 0);
    assert.equal(store.getProjects().length, 0);
  });
});

test('getTasks returns a deep copy; mutating it does not affect the store', () => {
  withTempStore((store) => {
    store.createTask({ title: 'original' }, NOW);
    const tasks = store.getTasks();
    tasks[0].title = 'mutated';
    tasks.push(sampleTask({ id: 'ghost', title: 'ghost' }));

    assert.equal(store.getTasks().length, 1);
    assert.equal(store.getTasks()[0].title, 'original');
  });
});

test('getTask returns null for unknown ids and a copy for known ones', () => {
  withTempStore((store) => {
    const created = store.createTask({ title: 'find me' }, NOW);
    assert.equal(store.getTask('nope'), null);

    const found = store.getTask(created.id);
    assert.ok(found);
    assert.notEqual(found, store.getTask(found.id), 'each call returns a fresh copy');
  });
});

// ── createTask ────────────────────────────────────────────────────────────────

test('createTask sanitizes the title and fills defaults', () => {
  withTempStore((store) => {
    const task = store.createTask(
      {
        title: '  喝水  ',
        notes: 'with lemon',
        priority: 'urgent',
        tags: ['health', 'health', 'way-too-long-tag-name-here'],
        plannedAt: NOW + DAY,
        dueAt: NOW + 2 * DAY,
        reminderAt: NOW + DAY / 2,
        context: 'away',
        estimateMinutes: 5.7
      },
      NOW
    );

    assert.equal(task.title, '喝水');
    assert.equal(task.notes, 'with lemon');
    assert.equal(task.status, 'open');
    assert.equal(task.priority, 'urgent');
    assert.equal(task.tags.length, 2, 'duplicates dropped');
    assert.ok(task.tags[0].length <= 24);
    assert.equal(task.plannedAt, NOW + DAY);
    assert.equal(task.dueAt, NOW + 2 * DAY);
    assert.equal(task.reminderAt, NOW + DAY / 2);
    assert.equal(task.context, 'away');
    assert.equal(task.estimateMinutes, 6, 'rounded to an integer');
    assert.equal(task.sortOrder, 0);
    assert.equal(task.createdAt, NOW);
    assert.equal(task.updatedAt, NOW);
    assert.equal(task.completedAt, null);
    assert.ok(task.id, 'an id is assigned');
  });
});

test('createTask assigns increasing sortOrder', () => {
  withTempStore((store) => {
    const first = store.createTask({ title: 'first' }, NOW);
    const second = store.createTask({ title: 'second' }, NOW);
    assert.equal(first.sortOrder, 0);
    assert.equal(second.sortOrder, 1);
  });
});

test('createTask falls back to a sane title for blank input', () => {
  withTempStore((store) => {
    const task = store.createTask({ title: '    ' }, NOW);
    assert.equal(task.title, '(untitled)');
  });
});

test('createTask emits tasks-changed carrying the current list', () => {
  withTempStore((store) => {
    const events: Task[][] = [];
    store.on('tasks-changed', (tasks) => events.push(tasks));

    const created = store.createTask({ title: 'emit me' }, NOW);
    assert.equal(events.length, 1);
    assert.equal(events[0].length, 1);
    assert.deepEqual(events[0][0].id, created.id);
  });
});

// ── updateTask ────────────────────────────────────────────────────────────────

test('updateTask applies only the supplied fields and bumps updatedAt', () => {
  withTempStore((store) => {
    const task = store.createTask({ title: 'draft' }, NOW);
    const updated = store.updateTask(task.id, { title: 'final', priority: 'important' }, NOW + 1000);
    assert.ok(updated);
    assert.equal(updated!.title, 'final');
    assert.equal(updated!.priority, 'important');
    assert.equal(updated!.notes, null, 'untouched fields keep their value');
    assert.equal(updated!.updatedAt, NOW + 1000);
  });
});

test('updateTask returns null for an unknown id and does not emit', () => {
  withTempStore((store) => {
    store.createTask({ title: 'keep' }, NOW);
    const events: Task[][] = [];
    store.on('tasks-changed', (tasks) => events.push(tasks));

    assert.equal(store.updateTask('missing', { title: 'x' }, NOW), null);
    assert.equal(events.length, 0);
  });
});

test('updateTask with status done stamps completedAt', () => {
  withTempStore((store) => {
    const task = store.createTask({ title: 'do it' }, NOW);
    const updated = store.updateTask(task.id, { status: 'done' }, NOW + 500);
    assert.equal(updated!.status, 'done');
    assert.equal(updated!.completedAt, NOW + 500);
  });
});

// ── setTaskStatus / deleteTask ────────────────────────────────────────────────

test('setTaskStatus transitions and emits once', () => {
  withTempStore((store) => {
    const task = store.createTask({ title: 'progress' }, NOW);

    // Listen only for the status transition, not the creation above.
    const events: Task[][] = [];
    store.on('tasks-changed', (tasks) => events.push(tasks));

    const result = store.setTaskStatus(task.id, 'done', NOW + 1);
    assert.equal(result!.status, 'done');
    assert.equal(events.length, 1);
  });
});

test('deleteTask removes the task, reparents children, and emits', () => {
  withTempStore((store) => {
    const parent = store.createTask({ title: 'parent' }, NOW);
    const child = store.createTask({ title: 'child', parentId: parent.id }, NOW);
    const events: Task[][] = [];
    store.on('tasks-changed', (tasks) => events.push(tasks));

    assert.equal(store.deleteTask(parent.id, NOW + 1), true);
    assert.equal(store.getTasks().length, 1);
    assert.equal(store.getTask(child.id)!.parentId, null, 'child reparented');
    assert.equal(events.length, 1);
  });
});

test('deleteTask returns false for an unknown id without emitting', () => {
  withTempStore((store) => {
    store.createTask({ title: 'keep' }, NOW);
    const events: Task[][] = [];
    store.on('tasks-changed', (tasks) => events.push(tasks));

    assert.equal(store.deleteTask('missing', NOW), false);
    assert.equal(events.length, 0);
  });
});

// ── Projects ──────────────────────────────────────────────────────────────────

test('createProject sanitizes name and color, defaults invalid color to null', () => {
  withTempStore((store) => {
    const project = store.createProject({ name: '  Work  ', color: 'red' }, NOW);
    assert.equal(project.name, 'Work');
    assert.equal(project.color, null, 'non-hex color rejected');

    const ok = store.createProject({ name: 'Play', color: '#2f8f6f' }, NOW);
    assert.equal(ok.color, '#2f8f6f');
  });
});

test('project goal and view mode persist and update', () => {
  withTempStore((store, dir) => {
    const project = store.createProject({
      name: 'Research',
      goal: `  ${'g'.repeat(PROJECT_GOAL_MAX + 5)}  `,
      viewMode: 'board'
    }, NOW);
    assert.equal(project.goal?.length, PROJECT_GOAL_MAX);
    assert.equal(project.viewMode, 'board');

    const updated = store.updateProject(project.id, { goal: 'Ship the paper', viewMode: 'list' }, NOW + 1)!;
    assert.equal(updated.goal, 'Ship the paper');
    assert.equal(updated.viewMode, 'list');

    const reloaded = new TaskStore(dir).getProject(project.id)!;
    assert.equal(reloaded.goal, 'Ship the paper');
    assert.equal(reloaded.viewMode, 'list');
  });
});

test('createProject truncates name to PROJECT_NAME_MAX and rejects blank names', () => {
  withTempStore((store) => {
    const long = store.createProject({ name: 'a'.repeat(PROJECT_NAME_MAX + 5) }, NOW);
    assert.equal(long.name.length, PROJECT_NAME_MAX);

    const blank = store.createProject({ name: '   ' }, NOW);
    assert.equal(blank.name, 'Untitled');
  });
});

test('updateProject and deleteProject emit projects-changed', () => {
  withTempStore((store) => {
    const events: import('../src/shared/types').Project[][] = [];
    store.on('projects-changed', (projects) => events.push(projects));

    const project = store.createProject({ name: 'Draft' }, NOW);
    store.updateProject(project.id, { name: 'Final' }, NOW + 1);
    assert.equal(events.length, 2, 'create + update each emit');

    store.deleteProject(project.id, NOW + 2);
    assert.equal(events.length, 3);
    assert.equal(store.getProjects().length, 0);
  });
});

test('deleteProject detaches tasks that belonged to it and emits tasks-changed too', () => {
  withTempStore((store) => {
    const project = store.createProject({ name: 'Someday' }, NOW);
    store.createTask({ title: 'maybe', projectId: project.id }, NOW);
    const taskEvents: Task[][] = [];
    store.on('tasks-changed', (tasks) => taskEvents.push(tasks));

    store.deleteProject(project.id, NOW + 1);
    assert.equal(store.getTasks()[0].projectId, null, 'task detached');
    assert.ok(taskEvents.length >= 1);
  });
});

test('deleteProject returns false for an unknown id', () => {
  withTempStore((store) => {
    const events: import('../src/shared/types').Project[][] = [];
    store.on('projects-changed', (projects) => events.push(projects));
    assert.equal(store.deleteProject('missing', NOW), false);
    assert.equal(events.length, 0);
  });
});

// ── Persistence round-trip ─────────────────────────────────────────────────────

test('tasks and projects survive a reload from disk', () => {
  withTempStore((store, dir) => {
    store.createTask({ title: 'persist me', tags: ['a', 'b'], reminderAt: NOW + DAY }, NOW);
    store.createProject({ name: 'Persist', goal: 'Keep context', viewMode: 'board', color: '#abc' }, NOW);

    const reloaded = new TaskStore(dir);
    const tasks = reloaded.getTasks();
    const projects = reloaded.getProjects();

    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'persist me');
    assert.deepEqual(tasks[0].tags, ['a', 'b']);
    assert.equal(tasks[0].reminderAt, NOW + DAY);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'Persist');
    assert.equal(projects[0].color, '#abc');
    assert.equal(projects[0].goal, 'Keep context');
    assert.equal(projects[0].viewMode, 'board');
  });
});

test('replaceAll rewrites the task list and reassigns sort order, then persists', () => {
  withTempStore((store, dir) => {
    store.createTask({ title: 'old' }, NOW);
    const incoming = [sampleTask({ id: 'a', title: 'A' }), sampleTask({ id: 'b', title: 'B' })];
    store.replaceAll(incoming, NOW);

    assert.equal(store.getTasks().length, 2);
    const reloaded = new TaskStore(dir);
    assert.equal(reloaded.getTasks().length, 2);
    assert.equal(reloaded.getTask('a')!.title, 'A');
  });
});

// ── Corrupt / unknown-schema quarantine ────────────────────────────────────────

test('a corrupt tasks.json aborts migration and remains available for recovery', () => {
  withTempStore((store, dir) => {
    writeFileSync(join(dir, 'tasks.json'), '{ not valid json', 'utf8');
    assert.throws(() => store.migrateLegacy([]));
    assert.equal(store.getTasks().length, 0);
    assert.equal(existsSync(join(dir, 'tasks.json')), true, 'failed migration keeps the source');
  });
});

test('an unknown schema version is quarantined and starts fresh', () => {
  withTempStore((store, dir) => {
    writeFileSync(
      join(dir, 'tasks.json'),
      JSON.stringify({ version: 999, tasks: [], projects: [] }),
      'utf8'
    );
    assert.throws(() => store.migrateLegacy([]));
    assert.equal(store.getTasks().length, 0);
    assert.equal(existsSync(join(dir, 'tasks.json')), true);
  });
});

test('load sanitizes stored tasks so corrupt disk data never propagates', () => {
  withTempStore((store, dir) => {
    const good = sampleTask({ id: 'good', title: 'good' });
    const bad = { id: 'bad', title: 123, priority: 'bogus' };
    writeFileSync(
      join(dir, 'tasks.json'),
      JSON.stringify({ version: 1, tasks: [good, bad], projects: [] }),
      'utf8'
    );

    store.migrateLegacy([]);
    assert.equal(store.getTasks().length, 1, 'malformed entry dropped');
    assert.equal(store.getTasks()[0].id, 'good');
    assert.equal(existsSync(join(dir, 'tasks.json')), false, 'successful migration deletes the source');
  });
});

test('legacy migration merges into an existing database and tasks.json wins id collisions', () => {
  withTempStore((store, dir) => {
    const existing = store.createTask({ title: 'SQLite 旧标题' }, NOW);
    const fileTask = { ...existing, title: 'tasks.json 新标题', updatedAt: NOW + 10 };
    writeFileSync(
      join(dir, 'tasks.json'),
      JSON.stringify({ version: 1, tasks: [fileTask], projects: [] }),
      'utf8'
    );
    store.migrateLegacy([
      {
        id: 'legacy-extra',
        text: '旧待办补充项',
        createdAt: NOW,
        completed: false,
        priority: 'normal',
        context: 'desk',
        remindOnBreak: false
      }
    ]);

    assert.equal(store.getTask(existing.id)?.title, 'tasks.json 新标题');
    assert.equal(store.getTask('legacy-extra')?.title, '旧待办补充项');
    assert.equal(existsSync(join(dir, 'tasks.json')), false);
  });
});

test('a malformed SQLite database is preserved and opens an ephemeral recovery store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-corrupt-db-'));
  try {
    writeFileSync(join(dir, 'eyeprotect.db'), 'this is not sqlite', 'utf8');
    const store = new TaskStore(dir);
    assert.deepEqual(store.getTasks(), []);
    assert.equal(store.getRecoveryStatus().readOnly, true);
    assert.ok(store.getRecoveryStatus().snapshotPath?.includes('.recovery-'));
    store.close();
    assert.ok(
      existsSync(join(dir, 'eyeprotect.db')),
      'the original malformed database is not overwritten'
    );
    const quarantined = readdirSync(dir)
      .some((name: string) => name.startsWith('eyeprotect.db.recovery-'));
    assert.equal(quarantined, true);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy status migration requires permission and preserves a pre-reset snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-status-reset-'));
  const path = join(dir, 'eyeprotect.db');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT,
        status TEXT NOT NULL CHECK(status IN ('inbox','active','done','archived')),
        priority TEXT NOT NULL, project_id TEXT, parent_id TEXT, planned_at INTEGER,
        due_at INTEGER, reminder_at INTEGER, recurrence_json TEXT, context TEXT NOT NULL,
        remind_on_break INTEGER NOT NULL DEFAULT 0, estimate_minutes INTEGER,
        sort_order INTEGER NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, completed_at INTEGER
      );
    `);
    legacy.close();
    assert.equal(TaskStore.requiresTaskModelReset(dir), true);

    const store = new TaskStore(dir);
    assert.equal(store.getRecoveryStatus().readOnly, false);
    store.close();
    assert.equal(TaskStore.requiresTaskModelReset(dir), false);
    assert.equal(readdirSync(dir).some((name) => name.includes('.pre-model-reset-')), true);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('declining legacy status migration keeps the original database untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-status-decline-'));
  const path = join(dir, 'eyeprotect.db');
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT,
      status TEXT NOT NULL CHECK(status IN ('inbox','active','done','archived')),
      priority TEXT NOT NULL, project_id TEXT, parent_id TEXT, planned_at INTEGER,
      due_at INTEGER, reminder_at INTEGER, recurrence_json TEXT, context TEXT NOT NULL,
      remind_on_break INTEGER NOT NULL DEFAULT 0, estimate_minutes INTEGER,
      sort_order INTEGER NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, completed_at INTEGER
    );`);
    legacy.close();

    const store = new TaskStore(dir, { allowTaskModelReset: false });
    assert.equal(store.getRecoveryStatus().readOnly, true);
    store.close();
    assert.equal(TaskStore.requiresTaskModelReset(dir), true);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Input length caps (title/notes) ────────────────────────────────────────────

test('createTask caps title at TASK_TITLE_MAX', () => {
  withTempStore((store) => {
    const task = store.createTask({ title: 'x'.repeat(TASK_TITLE_MAX + 50) }, NOW);
    assert.equal(task.title.length, TASK_TITLE_MAX);
  });
});

test('createTask caps notes at the shared TASK_NOTES_MAX via sanitizeTask', () => {
  withTempStore((store) => {
    const notes = 'y'.repeat(5000);
    const task = store.createTask({ title: 'note heavy', notes }, NOW);
    assert.ok(task.notes);
    assert.equal(task.notes!.length, 2000);
  });
});

// ── Sanity re-export check ─────────────────────────────────────────────────────

test('sanitizeTask rejects a bare completed flag into done status', () => {
  const result = sanitizeTask({ id: 'a', title: 'x', completed: true }, NOW);
  assert.equal(result!.status, 'done');
});

// ── Todo migration shape ───────────────────────────────────────────────────────

test('a migrated TodoItem becomes a Task with the expected mapping', () => {
  withTempStore((store) => {
    const todo: TodoItem = {
      id: 'legacy-1',
      text: '接一杯水',
      createdAt: NOW,
      completed: false,
      priority: 'important',
      context: 'desk',
      remindOnBreak: false
    };
    const tasks = [migrateShape(todo)];
    store.replaceAll(tasks, NOW);

    const loaded = store.getTask('legacy-1');
    assert.ok(loaded);
    assert.equal(loaded!.title, '接一杯水');
    assert.equal(loaded!.status, 'open');
    assert.equal(loaded!.priority, 'important');
    assert.equal(loaded!.context, 'desk');
    assert.equal(loaded!.projectId, null);
    assert.equal(loaded!.createdAt, NOW);
  });
});

test('active task state is exclusive and survives reopening the database', () => {
  withTempStore((store, dir) => {
    const first = store.createTask({ title: '第一项' }, NOW);
    const second = store.createTask({ title: '第二项' }, NOW + 1);
    assert.equal(store.setActiveTaskId(first.id, NOW + 2), first.id);
    assert.equal(store.setActiveTaskId(second.id, NOW + 3), second.id);
    assert.equal(store.getTask(first.id)?.status, 'open');
    assert.equal(store.getTask(second.id)?.status, 'open');
    assert.equal(store.getTasks().filter((task) => task.status === 'open').length, 2);

    store.close();
    const reopened = new TaskStore(dir);
    assert.equal(reopened.getActiveTaskId(), second.id);
  });
});

test('break opt-in and reminder consumption persist without being reset by unrelated edits', () => {
  withTempStore((store, dir) => {
    const created = store.createTask({
      title: '顺路接水',
      context: 'away',
      remindOnBreak: true,
      reminderAt: NOW + 60_000
    }, NOW);
    store.consumeTaskReminder(created.id, created.reminderAt!, NOW + 60_000);
    store.updateTask(created.id, { title: '顺路接两杯水' }, NOW + 70_000);
    assert.equal(store.getTask(created.id)?.remindOnBreak, true);
    assert.equal(store.isTaskReminderConsumed(created.id, created.reminderAt!), true);

    const nextFire = NOW + 120_000;
    store.updateTask(created.id, { reminderAt: nextFire }, NOW + 80_000);
    assert.equal(store.isTaskReminderConsumed(created.id, nextFire), false, 'a changed time creates a fresh occurrence');

    store.close();
    const reopened = new TaskStore(dir);
    assert.equal(reopened.getTask(created.id)?.remindOnBreak, true);
    assert.equal(reopened.isTaskReminderConsumed(created.id, nextFire), false);
  });
});

test('task and project parent updates reject hierarchy cycles', () => {
  withTempStore((store) => {
    const parent = store.createTask({ title: '父任务' }, NOW);
    const child = store.createTask({ title: '子任务', parentId: parent.id }, NOW + 1);
    store.updateTask(parent.id, { parentId: child.id }, NOW + 2);
    assert.equal(store.getTask(parent.id)?.parentId, null);
    assert.equal(store.getTask(child.id)?.parentId, parent.id);

    const rootProject = store.createProject({ name: '父项目' }, NOW);
    const childProject = store.createProject({ name: '子项目', parentId: rootProject.id }, NOW + 1);
    store.updateProject(rootProject.id, { parentId: childProject.id }, NOW + 2);
    assert.equal(store.getProject(rootProject.id)?.parentId, null);
    assert.equal(store.getProject(childProject.id)?.parentId, rootProject.id);
  });
});

/** Local mirror of the service migration mapping for isolated store tests. */
const migrateShape = (todo: TodoItem): Task => ({
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
  sortOrder: 0,
  createdAt: todo.createdAt,
  updatedAt: todo.createdAt,
  completedAt: todo.completed ? todo.completedAt ?? todo.createdAt : null
});
