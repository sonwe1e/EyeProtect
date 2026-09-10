import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TaskStore } from '../src/main/taskStore';
import { TaskService } from '../src/main/taskService';
import { createBackup, parseBackup } from '../src/main/backup';
import { DEFAULT_SETTINGS, sanitizeTask, isLocalDateKey } from '../src/shared/types';
import { groupSimpleTasks, taskSteps } from '../src/shared/simpleTasks';
import { localDateKey } from '../src/shared/calendar';
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

test('date groups cross month/year boundaries and exclude steps and completed tasks', () => {
  const now = new Date(2026, 11, 31, 23, 59).getTime();
  const dates = ['2026-12-30', '2026-12-31', '2027-01-07', '2027-01-08', null];
  const tasks = dates.map((dueDate, index) => sanitizeTask({ id: String(index), title: String(index), dueDate })!);
  const groups = groupSimpleTasks([...tasks, { ...tasks[0], id: 'step', parentId: '1' }, { ...tasks[0], id: 'done', status: 'done' }], now);
  assert.deepEqual(groups.map((group) => group.tasks.map((task) => task.id)), [['0'], ['1'], ['2'], ['3'], ['4']]);
  assert.equal(groupSimpleTasks(tasks, new Date(2027, 0, 1).getTime())[0].tasks.length, 2);
  assert.equal(isLocalDateKey('2026-02-30'), false);
  assert.equal(isLocalDateKey('2024-02-29'), true);
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

test('calendar grouping uses local days across both DST boundaries', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    for (const [now, seventh, eighth] of [
      [new Date(2026, 2, 7, 23).getTime(), '2026-03-14', '2026-03-15'],
      [new Date(2026, 9, 31, 23).getTime(), '2026-11-07', '2026-11-08']
    ] as const) {
      const tasks = [seventh, eighth].map((dueDate) => sanitizeTask({ id: dueDate, title: dueDate, dueDate })!);
      const grouped = groupSimpleTasks(tasks, now);
      assert.equal(grouped[2].tasks[0].dueDate, seventh);
      assert.equal(grouped[3].tasks[0].dueDate, eighth);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
