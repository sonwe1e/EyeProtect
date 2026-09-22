import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../src/main/taskStore';
import { TaskService } from '../src/main/taskService';

const NOW = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();
const LOCAL_DATE = '2026-07-08';

const withService = (fn: (service: TaskService, store: TaskStore) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-undo-'));
  try {
    const store = new TaskStore(dir);
    // Production always constructs the service with legacyRecurrence off.
    fn(new TaskService(store, false), store);
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

// ── F01: step reordering must not break delete-undo restore order ────────────

test('F01: undo restores a reordered step tree with parents before children', () => {
  withService((service, store) => {
    // createTask returns the full list, so pick the entry by title.
    const unrelated = service.createTask({ title: '无关任务' }, NOW).find((task) => task.title === '无关任务')!;
    const root = service.createTask({ title: '主任务' }, NOW + 1).find((task) => task.title === '主任务')!;
    const stepOne = store.createTask({ title: '第一步', parentId: root.id }, NOW + 2);
    const stepTwo = store.createTask({ title: '第二步', parentId: root.id }, NOW + 3);

    // Moving the second step up renumbers the siblings 0/10, so the snapshot
    // order (sort_order, created_at) now lists the child before its parent.
    service.moveStep(stepTwo.id, -1);
    const before = service.getTasks();
    assert.equal(before.find((task) => task.id === stepTwo.id)!.sortOrder, 0);
    assert.equal(before.find((task) => task.id === stepOne.id)!.sortOrder, 10);

    service.deleteTask(root.id, NOW + 4);
    assert.deepEqual(
      service.getTasks().map((task) => task.id),
      [unrelated.id],
      'the whole tree is gone after delete'
    );

    const undo = service.getUndoState(NOW + 5)!;
    assert.ok(undo, 'a delete undo exists');
    service.undo(undo.operationId, NOW + 5);

    const restored = service.getTasks();
    assert.equal(restored.length, 4, 'root, both steps and the unrelated task come back');
    assert.equal(restored.find((task) => task.id === root.id)?.parentId ?? null, null);
    assert.equal(restored.find((task) => task.id === stepOne.id)?.parentId, root.id);
    assert.equal(restored.find((task) => task.id === stepTwo.id)?.parentId, root.id);
    // The reordered step order itself survives the round-trip.
    const children = restored.filter((task) => task.parentId === root.id).sort((a, b) => a.sortOrder - b.sortOrder);
    assert.deepEqual(children.map((task) => task.title), ['第二步', '第一步']);
  });
});

test('F01: undo of a tree with a deeper nesting restores every level', () => {
  withService((service, store) => {
    const [root] = service.createTask({ title: 'Root' }, NOW);
    const child = store.createTask({ title: 'Child', parentId: root.id }, NOW + 1);
    const grandChild = store.createTask({ title: 'GrandChild', parentId: child.id }, NOW + 2);
    // Give the grandchild a sortOrder below the root's so snapshot order is
    // child-first again.
    store.updateTask(grandChild.id, { sortOrder: 0 }, NOW + 3);

    service.deleteTask(root.id, NOW + 4);
    service.undo(service.getUndoState(NOW + 5)!.operationId, NOW + 5);

    const restored = service.getTasks();
    assert.equal(restored.length, 3);
    assert.equal(restored.find((task) => task.id === child.id)?.parentId, root.id);
    assert.equal(restored.find((task) => task.id === grandChild.id)?.parentId, child.id);
  });
});

// ── F03: delete-undo must restore the dependent legacy data ─────────────────

test('F03: delete-undo restores plans, work sessions, checkpoints and their containers', () => {
  withService((service, store) => {
    const [root] = service.createTask({ title: '带资料的主任务' }, NOW);

    // One record in every table that cascades with the task.
    store.recordWorkSegment(root.id, NOW, NOW + 600_000, 600_000);
    store.upsertDailyPlan({ taskId: root.id, localDate: LOCAL_DATE, plannedMinutes: 30 }, NOW + 1);
    const block = store.createTimeBlock({ taskId: root.id, startAt: NOW, endAt: NOW + 600_000 }, NOW + 2);
    const session = store.startFocusSession({ taskId: root.id, timeBlockId: block.id }, NOW + 3);
    store.endFocusSession(session.id, 'completed', NOW + 4);
    store.createTaskCheckpoint({
      taskId: root.id,
      focusSessionId: session.id,
      kind: 'complete',
      progress: '完成一半'
    }, NOW + 5);
    store.setTimeboxNotified(root.id, true);

    assert.equal(store.getAllDailyTaskPlans().length, 1);
    assert.equal(store.getTaskWorkMs(root.id), 600_000);
    assert.equal(store.getTaskCheckpoints(root.id).length, 1);
    assert.equal(store.getTimeBlocksForTask(root.id).length, 1);
    assert.equal(store.getFocusSessions().length, 1);
    assert.equal(store.isTimeboxNotified(root.id), true);

    service.deleteTask(root.id, NOW + 6);
    assert.equal(store.getAllDailyTaskPlans().length, 0, 'cascade removes dependents on delete');

    const undo = service.getUndoState(NOW + 7)!;
    service.undo(undo.operationId, NOW + 7);

    assert.equal(service.getTask(root.id)?.title, '带资料的主任务', 'the task itself is restored');
    assert.equal(store.getAllDailyTaskPlans().length, 1, 'daily plan restored');
    assert.equal(store.getTaskWorkMs(root.id), 600_000, 'work session restored');
    assert.equal(store.getTimeBlocksForTask(root.id).length, 1, 'time block restored');
    const sessions = store.getFocusSessions();
    assert.equal(sessions.length, 1, 'focus session restored');
    assert.equal(sessions[0].outcome, 'completed');
    const checkpoints = store.getTaskCheckpoints(root.id);
    assert.equal(checkpoints.length, 1, 'checkpoint restored');
    assert.equal(checkpoints[0].focusSessionId, sessions[0].id, 'checkpoint still references its session');
    assert.equal(checkpoints[0].progress, '完成一半');
    assert.equal(store.isTimeboxNotified(root.id), true, 'work state restored');
  });
});

test('F03: deleting an unrelated task keeps another task’s dependents intact', () => {
  withService((service, store) => {
    const keeper = service.createTask({ title: '保留' }, NOW).find((task) => task.title === '保留')!;
    const doomed = service.createTask({ title: '删除' }, NOW + 1).find((task) => task.title === '删除')!;
    store.recordWorkSegment(keeper.id, NOW, NOW + 60_000, 60_000);
    store.recordWorkSegment(doomed.id, NOW, NOW + 60_000, 60_000);

    service.deleteTask(doomed.id, NOW + 2);
    service.undo(service.getUndoState(NOW + 3)!.operationId, NOW + 3);

    assert.equal(store.getTaskWorkMs(keeper.id), 60_000, 'untouched task keeps its data');
    assert.equal(store.getTaskWorkMs(doomed.id), 60_000, 'deleted task gets its data back');
  });
});

// ── F04: restore out of a read-only list ────────────────────────────────────

test('F04: restore moves a task out of a completed list and keeps ordinary edits read-only', () => {
  withService((service) => {
    const [project] = service.createProject({ name: '旧清单' }, NOW);
    const [task] = service.createTask({ title: '旧任务', projectId: project.id }, NOW + 1);
    service.setTaskStatus(task.id, 'done', NOW + 2);
    service.updateProject(project.id, { status: 'completed' }, NOW + 3);

    // Ordinary editing still refuses the read-only list…
    assert.throws(() => service.updateTask(task.id, { projectId: null }), /清单只读/);
    assert.throws(() => service.setTaskStatus(task.id, 'open'), /无法修改任务状态/);

    // …but the scoped restore operation succeeds and rehomes to the default list.
    const restored = service.restoreTask(task.id, NOW + 4);
    const after = restored.find((entry) => entry.id === task.id)!;
    assert.equal(after.status, 'open');
    assert.equal(after.projectId, null, 'task left the completed list');
    assert.equal(service.getProject(project.id)?.status, 'completed', 'the list itself is untouched');
  });
});

test('F04: restore keeps a task on a live list and rehomes only from inactive ones', () => {
  withService((service) => {
    const live = service.createProject({ name: '活跃清单' }, NOW).find((project) => project.name === '活跃清单')!;
    const onHold = service.createProject({ name: '暂缓清单' }, NOW + 1).find((project) => project.name === '暂缓清单')!;
    const liveTask = service.createTask({ title: '活跃任务', projectId: live.id }, NOW + 2).find((task) => task.title === '活跃任务')!;
    const holdTask = service.createTask({ title: '暂缓任务', projectId: onHold.id }, NOW + 3).find((task) => task.title === '暂缓任务')!;
    service.setTaskStatus(liveTask.id, 'done', NOW + 4);
    service.setTaskStatus(holdTask.id, 'done', NOW + 5);
    service.updateProject(onHold.id, { status: 'archived' }, NOW + 6);

    service.restoreTask(liveTask.id, NOW + 7);
    service.restoreTask(holdTask.id, NOW + 8);

    assert.equal(service.getTask(liveTask.id)?.projectId, live.id, 'live list membership kept');
    assert.equal(service.getTask(holdTask.id)?.projectId, null, 'archived list rehomed to default');
    assert.equal(service.getTask(holdTask.id)?.status, 'open');
  });
});

test('F04: restore moves a checklist’s steps together with its root', () => {
  withService((service, store) => {
    const [project] = service.createProject({ name: '旧清单' }, NOW);
    const [root] = service.createTask({ title: '主任务', projectId: project.id }, NOW + 1);
    const step = store.createTask({ title: '步骤', parentId: root.id, projectId: project.id }, NOW + 2);
    service.updateProject(project.id, { status: 'completed' }, NOW + 3);

    service.restoreTask(root.id, NOW + 4);

    assert.equal(service.getTask(root.id)?.projectId, null, 'root rehomed');
    assert.equal(service.getTask(step.id)?.projectId, null, 'step follows the root');
    assert.equal(service.getTask(root.id)?.status, 'open');
  });
});

test('F04: restore of an unknown task is a no-op', () => {
  withService((service) => {
    service.createTask({ title: 'keep' }, NOW);
    const result = service.restoreTask('missing', NOW + 1);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'keep');
  });
});
