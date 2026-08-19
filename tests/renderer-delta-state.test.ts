/**
 * Incremental renderer state contract (USERPLAN 1.2 PR2).
 *
 * The renderer hydrates once via task:list and then consumes deltas
 * (task:upserted / task:removed / project:upserted / project:removed); the
 * full list is only re-broadcast for bulk operations (undo, import,
 * migration). These tests pin the store/service half of that contract:
 *
 *   - every single-entity mutation emits exactly the delta it owes
 *   - bulk operations announce tasks-replaced / projects-replaced
 *   - the revision guard rejects stale autosaves instead of clobbering
 *     newer content, and accepts writes based on the current revision
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskStore } from '../src/main/taskStore';
import { TaskService } from '../src/main/taskService';
import { TASK_STALE_WRITE_MESSAGE, type Project, type Task } from '../src/shared/types';

const NOW = new Date(2026, 7, 11, 9, 0, 0, 0).getTime();

const withStore = (fn: (store: TaskStore, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-pr2-'));
  try {
    fn(new TaskStore(dir), dir);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

const collect = <T>(emitter: { on: (event: string, listener: (payload: T) => void) => unknown }, event: string): T[] => {
  const seen: T[] = [];
  emitter.on(event, (payload: T) => seen.push(payload));
  return seen;
};

// ── Revision guard ─────────────────────────────────────────────────────────────

test('every persisted update bumps the task revision', () => {
  withStore((store) => {
    const task = store.createTask({ title: 'Notes' }, NOW);
    assert.equal(task.revision, 1);
    const updated = store.updateTask(task.id, { notes: 'draft' }, NOW);
    assert.equal(updated?.revision, 2);
    const again = store.updateTask(task.id, { notes: 'draft 2' }, NOW);
    assert.equal(again?.revision, 3);
    assert.equal(store.getTask(task.id)?.notes, 'draft 2');
  });
});

test('a write carrying the current baseRevision succeeds', () => {
  withStore((store) => {
    const task = store.createTask({ title: 'A' }, NOW);
    const result = store.updateTask(task.id, { notes: 'x', baseRevision: task.revision }, NOW);
    assert.ok(result);
    assert.equal(result.revision, 2);
    assert.equal(result.notes, 'x');
  });
});

test('a stale baseRevision is rejected and nothing is overwritten', () => {
  withStore((store) => {
    const task = store.createTask({ title: 'A', notes: 'server-newer' }, NOW);
    // Somebody else (another window, rollover, undo) moved the row on.
    store.updateTask(task.id, { notes: 'written-after-draft' }, NOW);
    assert.throws(
      () => store.updateTask(task.id, { notes: 'old-draft', baseRevision: task.revision }, NOW),
      (error: Error) => error.message === TASK_STALE_WRITE_MESSAGE
    );
    const fresh = store.getTask(task.id);
    assert.equal(fresh?.notes, 'written-after-draft');
    assert.equal(fresh?.revision, 2, 'the rejected write must not bump the revision');
  });
});

test('writes without baseRevision are never revision-gated (internal callers)', () => {
  withStore((store) => {
    const task = store.createTask({ title: 'A' }, NOW);
    store.updateTask(task.id, { notes: 'n1' }, NOW);
    const viaStatus = store.setTaskStatus(task.id, 'done', NOW);
    assert.ok(viaStatus);
    assert.equal(viaStatus.status, 'done');
  });
});

// ── Delta events ───────────────────────────────────────────────────────────────

test('create/update emit task-upserted, delete emits task-removed', () => {
  withStore((store) => {
    const upserts = collect<Task>(store, 'task-upserted');
    const removals = collect<string>(store, 'task-removed');

    const task = store.createTask({ title: 'A' }, NOW);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].id, task.id);

    store.updateTask(task.id, { notes: 'edit' }, NOW);
    assert.equal(upserts.length, 2);
    assert.equal(upserts[1].notes, 'edit');
    assert.equal(upserts[1].revision, 2);

    store.deleteTaskTree(task.id);
    assert.deepEqual(removals, [task.id]);
  });
});

test('deleting a parent tree emits one task-removed per deleted task', () => {
  withStore((store) => {
    const parent = store.createTask({ title: 'P' }, NOW);
    const child = store.createTask({ title: 'C', parentId: parent.id }, NOW);
    const removals = collect<string>(store, 'task-removed');
    store.deleteTaskTree(parent.id);
    assert.deepEqual([...removals].sort(), [parent.id, child.id].sort());
  });
});

test('single delete promotes children and upserts them as deltas', () => {
  withStore((store) => {
    const parent = store.createTask({ title: 'P' }, NOW);
    const child = store.createTask({ title: 'C', parentId: parent.id }, NOW);
    const upserts = collect<Task>(store, 'task-upserted');
    const removals = collect<string>(store, 'task-removed');
    store.deleteTask(parent.id, NOW);
    assert.deepEqual(removals, [parent.id]);
    // The creation upsert carries the old parent; only the promoted copy is
    // parentless — that is the delta renderers must apply.
    const promoted = upserts.filter((task) => task.id === child.id && task.parentId === null);
    assert.equal(promoted.length, 1);
  });
});

test('moveTask upserts every reordered sibling so delta-only renderers re-sort', () => {
  withStore((store) => {
    const a = store.createTask({ title: 'A' }, NOW);
    const b = store.createTask({ title: 'B' }, NOW);
    const c = store.createTask({ title: 'C' }, NOW);
    const upserts = collect<Task>(store, 'task-upserted');
    store.moveTask({ taskId: c.id, beforeTaskId: a.id, scope: { type: 'inbox' } }, NOW);
    const moved = upserts.filter((task) => [a.id, b.id, c.id].includes(task.id));
    assert.equal(moved.length, 3, 'all three siblings changed sort_order');
    const order = store.getTasks()
      .filter((task) => task.status === 'open')
      .map((task) => task.title);
    assert.deepEqual(order, ['C', 'A', 'B']);
  });
});

test('project lifecycle emits project deltas and detaches tasks as task deltas', () => {
  withStore((store) => {
    const projectUpserts = collect<Project>(store, 'project-upserted');
    const projectRemovals = collect<string>(store, 'project-removed');
    const taskUpserts = collect<Task>(store, 'task-upserted');

    const project = store.createProject({ name: 'Research' }, NOW);
    assert.equal(projectUpserts.length, 1);
    assert.equal(projectUpserts[0].id, project.id);

    store.updateProject(project.id, { status: 'onHold' }, NOW);
    assert.equal(projectUpserts[1].status, 'onHold');

    const task = store.createTask({ title: 'T', projectId: project.id }, NOW);
    store.deleteProject(project.id, NOW);
    assert.deepEqual(projectRemovals, [project.id]);
    const detached = taskUpserts.filter((entry) => entry.id === task.id && entry.projectId === null);
    assert.equal(detached.length, 1, 'the detached task must reach delta subscribers');
  });
});

test('bulk operations announce tasks-replaced / projects-replaced', () => {
  withStore((store) => {
    const taskBulks = collect<Task[]>(store, 'tasks-replaced');
    const projectBulks = collect<Project[]>(store, 'projects-replaced');

    const task = store.createTask({ title: 'Keep me' }, NOW);
    store.replaceAll([{ ...task, title: 'Replaced' }], NOW);
    assert.equal(taskBulks.length, 1);
    assert.equal(taskBulks[0][0].title, 'Replaced');

    const project = store.createProject({ name: 'P' }, NOW);
    store.replaceProjects([{ ...project, name: 'P2' }]);
    assert.equal(projectBulks.length, 1);
    assert.equal(projectBulks[0][0].name, 'P2');
    assert.ok(taskBulks.length >= 2, 'replacing projects also re-syncs the task domain');
  });
});

test('undo restores through the bulk channel, not per-row deltas alone', () => {
  withStore((store) => {
    const service = new TaskService(store);
    const bulks: Task[][] = [];
    service.on('tasks-replaced', (tasks: Task[]) => bulks.push(tasks));
    const deltas: Task[] = [];
    service.on('task-upserted', (task: Task) => deltas.push(task));

    const task = service.createTask({ title: 'Delete me' }, NOW)[0];
    service.deleteTask(task.id, NOW);
    const undoState = service.getUndoState(NOW);
    assert.ok(undoState);
    service.undo(undoState.operationId, NOW);
    assert.ok(bulks.length >= 1, 'undo must trigger a full-list resync');
    assert.ok(bulks[bulks.length - 1].some((entry) => entry.id === task.id));
    assert.ok(deltas.some((entry) => entry.id === task.id), 'service re-emits store deltas');
  });
});
