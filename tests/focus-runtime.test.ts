import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FocusSessionService } from '../src/main/focusSession';
import { FocusRuntime } from '../src/main/focusRuntime';
import { TaskStore } from '../src/main/taskStore';
import { TaskWorkTracker } from '../src/main/taskWorkTracker';

test('focus runtime flushes tails and synchronizes the tracker across transitions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-focus-runtime-'));
  let wall = 100_000;
  let mono = 0;
  const store = new TaskStore(dir);
  const taskA = store.createTask({ title: 'A' }, wall).id;
  const taskB = store.createTask({ title: 'B' }, wall).id;
  const tracker = new TaskWorkTracker(store, (id) => store.getTask(id), {
    now: () => wall,
    monotonic: () => mono,
    checkpointMs: 1_000_000
  });
  const sessions = new FocusSessionService(store, { now: () => wall });
  tracker.on('segment', ({ taskId, activeMs }: { taskId: string; activeMs: number }) => {
    sessions.addWorkSegment(taskId, activeMs);
  });
  let activeTaskId: string | null = null;
  let healthBreakActive = false;
  const runtime = new FocusRuntime(sessions, tracker, (taskId) => {
    activeTaskId = taskId;
    tracker.setActiveTask(taskId);
  }, () => healthBreakActive);

  try {
    tracker.start(null);
    runtime.start(taskA);
    assert.equal(activeTaskId, taskA, 'starting focus from no active task attaches the tracker');

    wall += 2_500;
    mono += 2_500;
    runtime.start(taskB);
    const first = store.getFocusSessions().find((session) => session.taskId === taskA);
    assert.equal(first?.outcome, 'interrupted');
    assert.equal(first?.activeMs, 2_500, 'switching tasks persists the unfinished tail');
    assert.equal(activeTaskId, taskB);

    wall += 1_500;
    mono += 1_500;
    runtime.pause();
    const second = store.getFocusSessions().find((session) => session.taskId === taskB);
    assert.equal(second?.outcome, 'paused');
    assert.equal(second?.activeMs, 1_500, 'pausing persists the unfinished tail');
    assert.equal(activeTaskId, null);

    healthBreakActive = true;
    assert.equal(runtime.start(taskA).session, null, 'a health break blocks a new focus session');
    assert.equal(activeTaskId, null);
    healthBreakActive = false;
    runtime.start(taskA);
    wall += 1_200;
    mono += 1_200;
    runtime.beginBreak();
    wall += 10_000;
    mono += 10_000;
    tracker.flush();
    assert.equal(sessions.getStatus().session?.activeMs, 1_200, 'break time is excluded');
    healthBreakActive = true;
    const blockedSwitch = runtime.start(taskB);
    assert.equal(blockedSwitch.session?.taskId, taskA, 'a health break blocks task switching');
    assert.equal(blockedSwitch.session?.onBreak, true, 'focus start cannot end a health break');
    assert.equal(runtime.resume().session?.onBreak, true, 'focus controls cannot bypass a health break');
    assert.equal(tracker.getSummary().tracking, false);
    healthBreakActive = false;
    runtime.endBreak(true);
    assert.equal(tracker.getSummary().continuousActiveMs, 0, 'a natural break resets continuous use');
    wall += 1_000;
    mono += 1_000;
    runtime.complete();
    const resumed = store.getFocusSessions().find((session) => session.taskId === taskA && session.outcome === 'completed');
    assert.equal(resumed?.activeMs, 2_200, 'work after a break continues the same logical session');
  } finally {
    tracker.stop();
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});
