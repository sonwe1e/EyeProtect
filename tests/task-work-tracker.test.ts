import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../src/main/taskStore';
import { TaskWorkTracker } from '../src/main/taskWorkTracker';

test('task work and the timebox count active-use time only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-work-'));
  let wall = 10_000;
  let mono = 0;
  try {
    const store = new TaskStore(dir);
    const task = store.createTask({ title: 'Focus', estimateMinutes: 1 }, wall);
    const tracker = new TaskWorkTracker(store, (id) => store.getTask(id), {
      now: () => wall,
      monotonic: () => mono,
      checkpointMs: 1_000_000
    });
    let timeboxes = 0;
    tracker.on('timebox', () => {
      timeboxes += 1;
    });

    tracker.start(task.id);
    wall += 30_000;
    mono += 30_000;
    tracker.pause();
    wall += 10 * 60_000;
    mono += 10 * 60_000;
    assert.equal(tracker.getSummary().taskActiveMs, 30_000, 'idle time is excluded');

    tracker.resume();
    wall += 30_000;
    mono += 30_000;
    tracker.pause();
    assert.equal(tracker.getSummary().taskActiveMs, 60_000);
    assert.equal(timeboxes, 1, 'estimate threshold emits once');

    tracker.resume(true);
    assert.equal(tracker.getSummary().continuousActiveMs, 0, 'natural break resets continuous use');
    tracker.stop();
  } finally {
    TaskStore.closeAllForDirectory(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});
