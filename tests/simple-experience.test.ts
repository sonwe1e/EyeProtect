import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TaskStore } from '../src/main/taskStore';
import { TaskService } from '../src/main/taskService';
import { createBackup, parseBackup } from '../src/main/backup';
import { DEFAULT_SETTINGS, sanitizeTask, isLocalDateKey, nextTodoPriority } from '../src/shared/types';
import { openQueueTasks, orderSimpleQueue, queueTasksForToday, taskSteps } from '../src/shared/simpleTasks';
import { daysBetweenLocalDateKeys, localDateKey } from '../src/shared/calendar';
import { asSimpleTaskInput, asSimpleTaskUpdateInput } from '../src/main/ipcTaskInput';

const withStore = (fn: (store: TaskStore, directory: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-simple-'));
  try { fn(new TaskStore(directory), directory); }
  finally { TaskStore.closeAllForDirectory(directory); rmSync(directory, { recursive: true, force: true }); }
};

test('v4 migration snapshots data, converts deadlines once, and never revives cleared dates', () => {
  withStore((store, directory) => {
    const stamp = new Date(2026, 11, 31, 21, 30).getTime();
    const task = store.createTask({ title: 'legacy', dueAt: stamp, plannedAt: stamp - 86400000 });
    store.close();
    const db = new DatabaseSync(join(directory, 'eyeprotect.db'));
    db.exec('ALTER TABLE tasks DROP COLUMN due_date; DELETE FROM schema_migrations WHERE version IN (5, 5001)');
    db.close();
    const upgraded = new TaskStore(directory);
    assert.equal(upgraded.getTask(task.id)?.dueDate, localDateKey(stamp));
    assert.equal(upgraded.getTask(task.id)?.dueAt, stamp);
    assert.ok(readdirSync(directory).some((name) => name.includes('.recovery-')));
    upgraded.updateTask(task.id, { dueDate: null });
    upgraded.close();
    const reopened = new TaskStore(directory);
    assert.equal(reopened.getTask(task.id)?.dueDate, null);
    assert.equal(reopened.getTasks().length, 1);
  });
});

test('the today queue is one flat order: open first, then sortOrder/createdAt, no steps', () => {
  const tasks = [
    sanitizeTask({ id: 'done', title: 'done', status: 'done', sortOrder: 0, createdAt: 9 })!,
    sanitizeTask({ id: 'third', title: 'third', sortOrder: 20, createdAt: 3 })!,
    sanitizeTask({ id: 'first', title: 'first', sortOrder: 10, createdAt: 2 })!,
    sanitizeTask({ id: 'second', title: 'second', sortOrder: 0, createdAt: 1 })!,
    sanitizeTask({ id: 'step', title: 'step', sortOrder: 0, createdAt: 0, parentId: 'first' })!,
    sanitizeTask({ id: 'gone', title: 'gone', status: 'archived', sortOrder: 0, createdAt: 0 })!
  ];
  // Position is the priority: manual order first, completed sink to the tail,
  // steps and archived tasks are not queue items at all (AC-01/AC-06).
  assert.deepEqual(orderSimpleQueue(openQueueTasks(tasks, [])).map((task) => task.id), [
    'second', 'first', 'third', 'done'
  ]);
  assert.deepEqual(orderSimpleQueue(openQueueTasks([], [])), [], 'an empty queue stays empty');
  assert.equal(isLocalDateKey('2026-02-30'), false);
  assert.equal(isLocalDateKey('2024-02-29'), true);
});

test('today keeps only tasks completed today, so the tail cannot grow forever', () => {
  const today = new Date(2026, 4, 20, 10, 0).getTime();
  const yesterday = new Date(2026, 4, 19, 9, 0).getTime();
  const todayKey = localDateKey(today);
  const tasks = [
    sanitizeTask({ id: 'open', title: 'open', sortOrder: 0, createdAt: 1 })!,
    sanitizeTask({ id: 'done-today', title: 'done-today', status: 'done', completedAt: today, sortOrder: 1, createdAt: 2 })!,
    sanitizeTask({ id: 'done-yesterday', title: 'done-yesterday', status: 'done', completedAt: yesterday, sortOrder: 2, createdAt: 3 })!,
    sanitizeTask({ id: 'archived', title: 'archived', status: 'archived', sortOrder: 3, createdAt: 4 })!
  ];
  assert.deepEqual(queueTasksForToday(tasks, [], todayKey).map((task) => task.id), ['open', 'done-today']);
  // Open tasks are never hidden, whatever their date fields say.
  assert.deepEqual(
    queueTasksForToday([tasks[0]], [], localDateKey(new Date(2030, 0, 1).getTime())).map((task) => task.id),
    ['open']
  );
  assert.deepEqual(queueTasksForToday([], [], todayKey), [], 'an empty queue stays empty');
});

test('a queue whose rows all carry sortOrder 0 stays stable through createdAt', () => {
  // Pre-queue data: every row was written with sort_order 0, so the tie-break
  // is the only thing that keeps the list from shuffling on every render.
  const tasks = [
    sanitizeTask({ id: 'c', title: 'c', sortOrder: 0, createdAt: 300 })!,
    sanitizeTask({ id: 'a', title: 'a', sortOrder: 0, createdAt: 100 })!,
    sanitizeTask({ id: 'b', title: 'b', sortOrder: 0, createdAt: 200 })!
  ];
  assert.deepEqual(orderSimpleQueue(tasks).map((task) => task.id), ['a', 'b', 'c']);
  assert.deepEqual(orderSimpleQueue([...tasks].reverse()).map((task) => task.id), ['a', 'b', 'c']);
  assert.deepEqual(tasks.map((task) => task.id), ['c', 'a', 'b'], 'sorting never reorders the input');
});

test('completing a root and steps is atomic, undo preserves steps already done', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const root = store.createTask({ title: 'root', recurrence: { type: 'daily', interval: 1 } });
    const done = store.createTask({ title: 'already', parentId: root.id });
    store.setTaskStatus(done.id, 'done');
    const open = store.createTask({ title: 'open', parentId: root.id });
    service.completeTaskTree(root.id, { [root.id]: root.revision, [open.id]: open.revision });
    assert.equal(store.getTasks().length, 3, 'legacy recurrence must not generate a new task');
    assert.ok(store.getTasks().every((task) => task.status === 'done'));
    service.undo(service.getUndoState()!.operationId);
    assert.equal(store.getTask(root.id)?.status, 'open');
    assert.equal(store.getTask(open.id)?.status, 'open');
    assert.equal(store.getTask(done.id)?.status, 'done');
  });
});

test('priority saves through the simple whitelist and never reorders the queue', () => {
  // AC-09: the drawer cycles normal → important → urgent, the value must reach
  // the database through asSimpleTaskUpdateInput, and position stays the only
  // thing that orders the queue.
  assert.deepEqual(
    [nextTodoPriority('normal'), nextTodoPriority('important'), nextTodoPriority('urgent')],
    ['important', 'urgent', 'normal']
  );
  withStore((store) => {
    const service = new TaskService(store, false);
    const first = store.createTask({ title: 'first' });
    const second = store.createTask({ title: 'second' });
    const before = orderSimpleQueue(service.getTasks()).map((task) => task.id);

    service.updateTask(second.id, asSimpleTaskUpdateInput({ priority: 'urgent', baseRevision: second.revision }));

    assert.equal(store.getTask(second.id)?.priority, 'urgent', 'priority must be persisted, not dropped');
    assert.deepEqual(orderSimpleQueue(service.getTasks()).map((task) => task.id), before, 'priority must not reorder the queue');
    assert.equal(store.getTask(first.id)?.priority, 'normal');
  });
});

test('concurrent step insertion rejects stale confirmation without completing any row', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const root = store.createTask({ title: 'root' });
    store.createTask({ title: 'new step', parentId: root.id });
    assert.throws(() => service.completeTaskTree(root.id, { [root.id]: root.revision }), /冲突/);
    assert.ok(store.getTasks().every((task) => task.status === 'open'));
  });
});

test('failed transaction neither persists nor emits partial updates', () => {
  withStore((store) => {
    const task = store.createTask({ title: 'before' });
    const events: unknown[] = [];
    store.on('task-upserted', (value) => events.push(value));
    assert.throws(() => store.runInTransaction(() => { store.updateTask(task.id, { title: 'partial' }); throw new Error('injected'); }));
    assert.equal(store.getTask(task.id)?.title, 'before');
    assert.equal(events.length, 0);
  });
});

test('legacy nested steps flatten for display without rewriting their relationships', () => {
  withStore((store) => {
    const root = store.createTask({ title: 'root' });
    const first = store.createTask({ title: 'first', parentId: root.id });
    const nested = store.createTask({ title: 'nested', parentId: first.id, dueAt: 123 });
    assert.deepEqual(taskSteps(root.id, store.getTasks()).map((task) => task.id), [first.id, nested.id]);
    assert.equal(store.getTask(nested.id)?.parentId, first.id);
    assert.equal(store.getTask(nested.id)?.dueAt, 123);
  });
});

test('v8 backup retains explicit empty dates; old backups convert dueAt but not plannedAt', () => {
  const stamp = new Date(2026, 5, 1, 12).getTime();
  const task = sanitizeTask({ id: 't', title: 'test', dueDate: null, dueAt: stamp, plannedAt: stamp })!;
  const backup = createBackup(DEFAULT_SETTINGS, [], '1.4.0', stamp, { tasks: [task] });
  assert.equal(parseBackup(backup).tasks[0].dueDate, null);
  const legacy = JSON.parse(backup); legacy.version = 6;
  assert.equal(parseBackup(JSON.stringify(legacy)).tasks[0].dueDate, localDateKey(stamp));
  legacy.tasks[0].dueAt = null;
  assert.equal(parseBackup(JSON.stringify(legacy)).tasks[0].dueDate, null);
});

test('live task input cannot reactivate recurrence, hierarchy or legacy time planning', () => {
  const result = asSimpleTaskInput({ title: 'test', parentId: 'parent', plannedAt: 123, recurrence: { type: 'daily', interval: 1 }, dueDate: '2026-09-08' });
  assert.equal(result.parentId, undefined);
  assert.equal(result.recurrence, undefined);
  assert.equal(result.plannedAt, undefined);
  assert.equal(result.dueDate, '2026-09-08');
  assert.throws(() => asSimpleTaskUpdateInput({ dueDate: '2026-02-30' }), /日期/);
  assert.deepEqual(asSimpleTaskUpdateInput({ dueDate: null, baseRevision: 4 }), { dueDate: null, baseRevision: 4 });
});

test('local day distances stay correct across both DST boundaries', () => {
  // The queue's inline tags ("逾期 3 天" / "今天") compare local calendar days,
  // so the civil-day distance — not a 24h multiple — is what must survive the
  // spring-forward and fall-back days.
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    for (const [now, seventh, eighth] of [
      [new Date(2026, 2, 7, 23).getTime(), '2026-03-14', '2026-03-15'],
      [new Date(2026, 9, 31, 23).getTime(), '2026-11-07', '2026-11-08']
    ] as const) {
      assert.equal(daysBetweenLocalDateKeys(localDateKey(now), seventh), 7);
      assert.equal(daysBetweenLocalDateKeys(localDateKey(now), eighth), 8);
      assert.equal(daysBetweenLocalDateKeys(seventh, eighth), 1);
      assert.equal(daysBetweenLocalDateKeys(eighth, seventh), -1);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
