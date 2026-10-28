import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../src/main/taskStore';
import { TaskService } from '../src/main/taskService';
import { asOrderedTaskIds } from '../src/main/ipcTaskInput';
import { moveQueueItem, openQueueTasks, orderSimpleQueue } from '../src/shared/simpleTasks';
import { sanitizeProject, sanitizeTask, type Task } from '../src/shared/types';

/**
 * P0 queue persistence. The queue is one flat order across lists, so it needs
 * its own write path: `task:move` only reorders siblings inside one container,
 * and `TaskStore.updateTask` bumps `revision`, which would invalidate the draft
 * an open drawer is holding.
 */
const withStore = (fn: (store: TaskStore, directory: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-queue-'));
  try { fn(new TaskStore(directory), directory); }
  finally { TaskStore.closeAllForDirectory(directory); rmSync(directory, { recursive: true, force: true }); }
};

const rootOrder = (store: TaskStore): string[] =>
  store.getTasks().filter((task) => !task.parentId).map((task) => task.id);

const sortOrders = (store: TaskStore): number[] =>
  store.getTasks().filter((task) => !task.parentId).map((task) => task.sortOrder);

/** Every persisted field that a reorder must NOT touch, in one comparable string. */
const ledger = (store: TaskStore): string =>
  store.getTasks().map((task) => `${task.id}:${task.sortOrder}:${task.revision}:${task.updatedAt}`).join('|');

test('reorderQueue persists index * 10 order and leaves revision and updatedAt alone', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    const c = store.createTask({ title: 'c' });

    service.reorderQueue([c.id, a.id, b.id]);

    assert.deepEqual(rootOrder(store), [c.id, a.id, b.id], 'queue order follows the payload');
    assert.deepEqual(sortOrders(store), [0, 10, 20], 'sortOrder is index * 10');
    // A bumped revision here would make the open drawer's draft fail with
    // TASK_STALE_WRITE_MESSAGE on its next save (the reason this path exists).
    assert.equal(store.getTask(a.id)?.revision, a.revision);
    assert.equal(store.getTask(b.id)?.revision, b.revision);
    assert.equal(store.getTask(c.id)?.revision, c.revision);
    assert.equal(store.getTask(a.id)?.updatedAt, a.updatedAt, 'a reorder is not an edit');
  });
});

test('a partly invalid payload rejects the whole order and writes nothing', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const root = store.createTask({ title: 'root' });
    const step = store.createTask({ title: 'step', parentId: root.id });
    const done = store.createTask({ title: 'done' });
    store.setTaskStatus(done.id, 'done');
    const open = store.createTask({ title: 'open' });
    const frozenList = store.createProject({ name: '已完成清单', status: 'completed' });
    const frozen = store.createTask({ title: 'frozen', projectId: frozenList.id });
    const before = ledger(store);

    assert.throws(() => service.reorderQueue([open.id, open.id]), /重复/);
    assert.throws(() => service.reorderQueue([open.id, step.id]), /主任务/);
    assert.throws(() => service.reorderQueue([open.id, done.id]), /未完成/);
    assert.throws(() => service.reorderQueue([open.id, 'missing-id']), /不存在/);
    assert.throws(() => service.reorderQueue([open.id, frozen.id]), /清单只读/);
    assert.equal(ledger(store), before, 'one bad id must not partially rewrite the queue');
  });
});

test('open roots missing from the payload are appended to the tail in existing order', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    const c = store.createTask({ title: 'c' });

    // `b` is unlisted: a task created in another window between drag start and
    // drop must not disappear from the queue, it sinks to the tail.
    service.reorderQueue([c.id, a.id]);

    assert.deepEqual(rootOrder(store), [c.id, a.id, b.id]);
    assert.deepEqual(sortOrders(store), [0, 10, 20]);
  });
});

test('the same payload twice is idempotent and only moved rows emit an upsert', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    const c = store.createTask({ title: 'c' });
    service.reorderQueue([c.id, a.id, b.id]);
    const settled = ledger(store);

    const upserted: string[] = [];
    store.on('task-upserted', (task: Task) => upserted.push(task.id));
    service.reorderQueue([c.id, a.id, b.id]);
    assert.equal(upserted.length, 0, 'nothing moved, so nothing is re-broadcast');
    assert.equal(ledger(store), settled);

    // c stays at index 0, so only b and a are resent.
    service.reorderQueue([c.id, b.id, a.id]);
    assert.deepEqual(upserted.sort(), [a.id, b.id].sort());
    assert.deepEqual(rootOrder(store), [c.id, b.id, a.id]);
  });
});

test('legacy rows sharing sortOrder 0 normalize to index * 10 on the first reorder', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const created = ['a', 'b', 'c'].map((title) => store.createTask({ title }));
    // Every pre-queue row carried sort_order 0; the renderer sorts those by
    // createdAt/id, and the first drag rewrites the whole queue.
    for (const task of created) store.updateTask(task.id, { sortOrder: 0 });
    const existing = rootOrder(store);
    assert.equal(new Set(sortOrders(store)).size, 1, 'fixture: all orders are 0');

    service.reorderQueue(existing);

    assert.deepEqual(rootOrder(store), existing, 'no visible reorder happened');
    assert.deepEqual(sortOrders(store), [0, 10, 20], 'but the order is now explicit');
  });
});

test('queue order survives closing and reopening the database (AC-02, DB side)', () => {
  withStore((store, directory) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    const c = store.createTask({ title: 'c' });
    service.reorderQueue([c.id, a.id, b.id]);
    store.close();

    const reopened = new TaskStore(directory);
    assert.deepEqual(rootOrder(reopened), [c.id, a.id, b.id]);
    assert.deepEqual(sortOrders(reopened), [0, 10, 20]);
  });
});

test('a reorder does not invalidate the baseRevision an open drawer is holding', () => {
  // The regression this write path exists for: dragging used to go through
  // updateTask, which bumps revision, so the next save from the open drawer was
  // rejected as a stale write ("抽屉存不上"). Reorder must be invisible to it.
  withStore((store) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    const drawerRevision = a.revision;
    const drawerUpdatedAt = a.updatedAt;

    service.reorderQueue([b.id, a.id]);

    assert.equal(store.getTask(a.id)?.revision, drawerRevision, 'reorder must not bump revision');
    assert.equal(store.getTask(a.id)?.updatedAt, drawerUpdatedAt, 'reorder must not look like an edit');
    // The drawer now saves with the revision it captured before the drag.
    const saved = service.updateTask(a.id, { dueDate: '2026-03-04', baseRevision: drawerRevision });
    const savedTask = saved.find((task) => task.id === a.id);
    assert.equal(savedTask?.dueDate, '2026-03-04', 'the drawer save must land, not be rejected as stale');
    assert.equal(store.getTask(a.id)?.sortOrder, 10, 'a drawer save must not move the row');
  });
});

test('the upsert delta alone is enough for the renderer to re-derive the new order', () => {
  // useTasks keeps a Map<TaskId, Task> and sorts by sortOrder, so the order after
  // a drag can only be right if every row whose sortOrder changed arrives as a
  // delta. A row whose index did not change is legitimately not re-sent.
  withStore((store) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    const c = store.createTask({ title: 'c' });
    service.reorderQueue([a.id, b.id, c.id]);
    const before = store.getTasks();

    const upserted: Task[] = [];
    store.on('task-upserted', (task: Task) => upserted.push(task));
    service.reorderQueue([c.id, b.id, a.id]);

    // b keeps index 1, so it is the only row that sends nothing — and that is
    // exactly why the other two must carry their new value.
    assert.deepEqual(upserted.map((task) => task.id).sort(), [a.id, c.id].sort());
    const replay = new Map(before.map((task) => [task.id, task]));
    for (const task of upserted) replay.set(task.id, task);
    assert.deepEqual(
      [...replay.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt).map((task) => task.id),
      [c.id, b.id, a.id],
      'applying only the deltas must produce the dropped order'
    );
  });
});

test('completing a root leaves sortOrder alone and undo puts the row back in its slot', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    const c = store.createTask({ title: 'c' });
    service.reorderQueue([a.id, b.id, c.id]);

    service.completeTaskTree(b.id, { [b.id]: store.getTask(b.id)!.revision });
    assert.equal(store.getTask(b.id)?.status, 'done');
    assert.equal(store.getTask(b.id)?.sortOrder, 10, 'completion is a status change, not an order change');
    // Position is the priority: done sinks without any write.
    assert.deepEqual(orderSimpleQueue(store.getTasks()).map((task) => task.id), [a.id, c.id, b.id]);

    service.undo(service.getUndoState()!.operationId);
    assert.equal(store.getTask(b.id)?.status, 'open');
    assert.deepEqual(orderSimpleQueue(store.getTasks()).map((task) => task.id), [a.id, b.id, c.id], 'undo returns the row to its original slot');
  });
});

test('a task created after the last reorder lands at the tail, not in front of it', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const a = store.createTask({ title: 'a' });
    const b = store.createTask({ title: 'b' });
    service.reorderQueue([b.id, a.id]);

    const fresh = store.createTask({ title: 'fresh' });
    assert.ok(fresh.sortOrder > store.getTask(a.id)!.sortOrder);
    assert.deepEqual(orderSimpleQueue(service.getTasks()).map((task) => task.id), [b.id, a.id, fresh.id]);
  });
});

test('openQueueTasks and reorderQueue agree on which lists are writable', () => {
  // One rule, two readers: if the queue showed a row the write path rejects (or
  // hid one it accepts) the drag would fail for a reason the user cannot see.
  withStore((store) => {
    const service = new TaskService(store, false);
    const live = store.createProject({ name: '进行中', status: 'active' });
    const held = store.createProject({ name: '暂缓', status: 'onHold' });
    const frozen = store.createProject({ name: '已完成', status: 'completed' });
    const inbox = store.createTask({ title: 'inbox' });
    const inLive = store.createTask({ title: 'live', projectId: live.id });
    const inHeld = store.createTask({ title: 'held', projectId: held.id });
    const inFrozen = store.createTask({ title: 'frozen', projectId: frozen.id });

    const queueIds = openQueueTasks(service.getTasks(), service.getProjects())
      .filter((task) => task.status === 'open')
      .map((task) => task.id);
    assert.deepEqual(new Set(queueIds), new Set([inbox.id, inLive.id, inHeld.id]));
    assert.equal(queueIds.includes(inFrozen.id), false, 'a completed list is not part of the queue');

    // Accepted: everything the queue shows.
    assert.doesNotThrow(() => service.reorderQueue([inHeld.id, inLive.id, inbox.id]));
    // Rejected: everything the queue hides.
    assert.throws(() => service.reorderQueue([inbox.id, inFrozen.id]), /清单只读/);
  });
});

test('reordering roots never rewrites a step sortOrder', () => {
  withStore((store) => {
    const service = new TaskService(store, false);
    const root = store.createTask({ title: 'root' });
    const other = store.createTask({ title: 'other' });
    const step = store.createTask({ title: 'step', parentId: root.id });
    const before = store.getTask(step.id)!.sortOrder;

    service.reorderQueue([other.id, root.id]);

    assert.equal(store.getTask(step.id)?.sortOrder, before);
    assert.equal(store.getTask(step.id)?.updatedAt, step.updatedAt);
  });
});

test('a hand-built payload cannot smuggle a duplicate past the transport', () => {
  assert.throws(() => asOrderedTaskIds(['a', 'a']), /重复/);
  // The service defends itself too: it is a public API, not only the IPC path.
  withStore((store) => {
    const service = new TaskService(store, false);
    const task = store.createTask({ title: 'a' });
    assert.throws(() => service.reorderQueue([task.id, task.id]), /重复/);
  });
});

const tasksOf = (specs: Array<Partial<Task> & { id: string }>): Task[] =>
  specs.map((spec) => sanitizeTask({ title: spec.id, ...spec })!);

test('orderSimpleQueue puts open first, keeps manual order, and sinks completed tasks', () => {
  const tasks = tasksOf([
    { id: 'done-early', status: 'done', sortOrder: 0, createdAt: 1 },
    { id: 'open-late', status: 'open', sortOrder: 20, createdAt: 3 },
    { id: 'open-early', status: 'open', sortOrder: 10, createdAt: 2 },
    { id: 'done-late', status: 'done', sortOrder: 30, createdAt: 4 }
  ]);
  assert.deepEqual(orderSimpleQueue(tasks).map((task) => task.id), [
    'open-early', 'open-late', 'done-early', 'done-late'
  ]);
  assert.deepEqual(tasks.map((task) => task.id), [
    'done-early', 'open-late', 'open-early', 'done-late'
  ], 'the caller array must not be reordered in place');
});

test('orderSimpleQueue falls back to createdAt and then id when sortOrder ties', () => {
  const tasks = tasksOf([
    { id: 'b', status: 'open', sortOrder: 0, createdAt: 10 },
    { id: 'a', status: 'open', sortOrder: 0, createdAt: 10 },
    { id: 'first', status: 'open', sortOrder: 0, createdAt: 5 }
  ]);
  assert.deepEqual(orderSimpleQueue(tasks).map((task) => task.id), ['first', 'a', 'b']);
});

test('moveQueueItem returns a new list for before/after and ignores unknown ids', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveQueueItem(ids, 'd', 'b', 'before'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveQueueItem(ids, 'a', 'c', 'after'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveQueueItem(ids, 'a', 'b', 'after'), ['b', 'a', 'c', 'd']);
  // Boundaries: first before itself is a no-op, last after first is legal.
  assert.deepEqual(moveQueueItem(ids, 'd', 'a', 'before'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveQueueItem(ids, 'a', 'd', 'after'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveQueueItem(['a', 'b'], 'b', 'a', 'before'), ['b', 'a']);
  assert.deepEqual(moveQueueItem([], 'a', 'b', 'before'), [], 'an empty queue stays empty');
  assert.deepEqual(moveQueueItem(ids, 'a', 'a', 'before'), ['a', 'b', 'c', 'd'], 'dropping onto itself is a no-op');
  assert.deepEqual(moveQueueItem(ids, 'a', 'a', 'after'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(moveQueueItem(ids, 'ghost', 'b', 'before'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(moveQueueItem(ids, 'a', 'ghost', 'before'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'], 'the source list is never mutated');
});

test('openQueueTasks keeps inbox and live-list roots and drops steps and read-only lists', () => {
  const tasks = tasksOf([
    { id: 'inbox', status: 'open', projectId: null },
    { id: 'live', status: 'open', projectId: 'live-list' },
    { id: 'held', status: 'open', projectId: 'held-list' },
    { id: 'frozen', status: 'open', projectId: 'frozen-list' },
    { id: 'archived', status: 'archived', projectId: null },
    { id: 'step', status: 'open', projectId: null, parentId: 'inbox' },
    { id: 'done', status: 'done', projectId: null }
  ]);
  const projects = [
    { id: 'live-list', name: '进行中', status: 'active' },
    { id: 'held-list', name: '暂时停下', status: 'onHold' },
    { id: 'frozen-list', name: '已完成', status: 'completed' }
  ].map((project) => sanitizeProject(project)!);

  assert.deepEqual(openQueueTasks(tasks, projects).map((task) => task.id), [
    'inbox', 'live', 'held', 'done'
  ]);
});
