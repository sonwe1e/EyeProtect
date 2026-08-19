/**
 * Drag-reorder regression (USERPLAN 1.2 PR0).
 *
 * The old TaskList `onDrop` only cleared local drag state and never called
 * `onMove`, so a user could grab, drag and drop a task — and nothing would
 * happen. These tests pin both layers of the fix:
 *
 *   1. UI decision layer: `resolveSiblingDrop` maps "drop B on A" to the
 *      correct `beforeTaskId` (and refuses self/cross-parent/no-op drops).
 *   2. DB layer: feeding that decision to `TaskStore.moveTask` really writes
 *      `B.sort_order < A.sort_order` and survives reopening the database.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveSiblingDrop } from '../src/renderer/src/features/tasks/taskReorder';
import { TaskStore } from '../src/main/taskStore';
import type { Task } from '../src/shared/types';

const now = new Date('2026-08-10T10:00:00').getTime();

const task = (over: Partial<Task>): Task =>
  ({
    id: 'x',
    title: '任务',
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
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...over
  }) as Task;

const ordered = (ids: string[], parentId: string | null = null): Task[] =>
  ids.map((id, index) => task({ id, title: id, parentId, sortOrder: index }));

test('drop B on A inserts B above A', () => {
  const tasks = ordered(['A', 'B', 'C']);
  assert.equal(resolveSiblingDrop(tasks, 'B', 'A'), 'A');
});

test('drop C on A moves C two places up', () => {
  const tasks = ordered(['A', 'B', 'C']);
  assert.equal(resolveSiblingDrop(tasks, 'C', 'A'), 'A');
});

test('dropping onto the row directly below is a no-op', () => {
  const tasks = ordered(['A', 'B', 'C']);
  assert.equal(resolveSiblingDrop(tasks, 'A', 'B'), undefined);
});

test('self-drop is ignored', () => {
  const tasks = ordered(['A', 'B']);
  assert.equal(resolveSiblingDrop(tasks, 'A', 'A'), undefined);
});

test('cross-parent drop is not treated as a reorder', () => {
  const tasks = [
    ...ordered(['A', 'B']),
    ...ordered(['child'], 'A')
  ];
  assert.equal(resolveSiblingDrop(tasks, 'B', 'child'), undefined);
  assert.equal(resolveSiblingDrop(tasks, 'child', 'B'), undefined);
});

test('unknown ids are ignored', () => {
  const tasks = ordered(['A', 'B']);
  assert.equal(resolveSiblingDrop(tasks, 'missing', 'A'), undefined);
});

test('subtask drop between siblings of the same parent works', () => {
  const tasks = ordered(['s1', 's2', 's3'], 'parent');
  assert.equal(resolveSiblingDrop(tasks, 's3', 's1'), 's1');
});

test('drag B above A persists B.sort_order < A.sort_order and survives restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-drag-'));
  try {
    const store = new TaskStore(dir);
    store.createTask({ title: 'A' }, now);
    store.createTask({ title: 'B' }, now);
    store.createTask({ title: 'C' }, now);
    const before = store.getTasks();
    const a = before.find((entry) => entry.title === 'A')!;
    const b = before.find((entry) => entry.title === 'B')!;

    // The exact decision the UI now makes when B is dropped on A.
    const beforeTaskId = resolveSiblingDrop(
      before.sort((left, right) => left.sortOrder - right.sortOrder),
      b.id,
      a.id
    );
    assert.equal(beforeTaskId, a.id);

    store.moveTask(
      { taskId: b.id, beforeTaskId, scope: { type: 'inbox' } },
      now
    );

    const checkOrder = (entries: Task[]): void => {
      const open = entries
        .filter((entry) => entry.status === 'open')
        .sort((left, right) => left.sortOrder - right.sortOrder);
      assert.deepEqual(open.map((entry) => entry.title), ['B', 'A', 'C']);
      const reopenedB = open[0];
      const reopenedA = open[1];
      assert.ok(reopenedB.sortOrder < reopenedA.sortOrder);
    };
    checkOrder(store.getTasks());

    // Restart: the order must survive a fresh store over the same database.
    TaskStore.closeAllForDirectory(dir);
    const reopened = new TaskStore(dir);
    checkOrder(reopened.getTasks());
    TaskStore.closeAllForDirectory(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
