/**
 * Focus session state machine tests (USERPLAN 1.2 PR6, ADR-005).
 *
 * Covers the §22 interaction regression at the service level:
 * Focus → start → break → complete break → resume SAME session → pause →
 * restart → history correct. Accumulation must stop on breaks, survive
 * restarts, and never mix between tasks.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskStore } from '../src/main/taskStore';
import { FocusSessionService } from '../src/main/focusSession';

const NOW = new Date(2026, 7, 14, 14, 0, 0, 0).getTime();

interface Fixture {
  store: TaskStore;
  service: FocusSessionService;
  taskA: string;
  taskB: string;
  dir: string;
}

const setup = (): Fixture => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-pr6-'));
  const store = new TaskStore(dir);
  const taskA = store.createTask({ title: 'A' }, NOW).id;
  const taskB = store.createTask({ title: 'B' }, NOW).id;
  const service = new FocusSessionService(store, { now: () => NOW });
  return { store, service, taskA, taskB, dir };
};

const teardown = (fixture: Fixture): void => {
  TaskStore.closeAllForDirectory(fixture.dir);
  rmSync(fixture.dir, { recursive: true, force: true });
};

test('start creates the live session, sets the active task, reports status', () => {
  const fixture = setup();
  try {
    const status = fixture.service.start(fixture.taskA);
    assert.ok(status.session);
    assert.equal(status.session.taskId, fixture.taskA);
    assert.equal(status.session.onBreak, false);
    assert.equal(fixture.store.getActiveTaskId(), fixture.taskA);
  } finally {
    teardown(fixture);
  }
});

test('starting the same task is idempotent; another task interrupts the live session', () => {
  const fixture = setup();
  try {
    fixture.service.start(fixture.taskA);
    const again = fixture.service.start(fixture.taskA);
    assert.equal(fixture.store.getFocusSessions().length, 1, 'no duplicate session');

    fixture.service.addWorkSegment(fixture.taskA, 5 * 60_000);
    const switched = fixture.service.start(fixture.taskB);
    assert.equal(switched.session?.taskId, fixture.taskB);
    const history = fixture.store.getFocusSessions();
    assert.equal(history.length, 2);
    const interrupted = history.find((session) => session.taskId === fixture.taskA);
    assert.equal(interrupted?.outcome, 'interrupted');
    assert.equal(interrupted?.activeMs, 5 * 60_000, 'work accumulated before interruption is kept');
  } finally {
    teardown(fixture);
  }
});

test('work segments accumulate only for the live session task outside breaks', () => {
  const fixture = setup();
  try {
    fixture.service.start(fixture.taskA);
    fixture.service.addWorkSegment(fixture.taskA, 30_000);
    fixture.service.addWorkSegment(fixture.taskB, 30_000, );
    fixture.service.addWorkSegment(fixture.taskA, -5);
    assert.equal(fixture.service.getStatus().session?.activeMs, 30_000);
  } finally {
    teardown(fixture);
  }
});

test('break pause stops accumulation; break resume continues the SAME session', () => {
  const fixture = setup();
  try {
    fixture.service.start(fixture.taskA);
    fixture.service.addWorkSegment(fixture.taskA, 21 * 60_000);

    // Eye break presented: session stays live, accumulation stops.
    fixture.service.beginBreak();
    const onBreak = fixture.service.getStatus().session;
    assert.equal(onBreak?.onBreak, true);
    assert.equal(onBreak?.endedAt, null, 'a break never ends the session');
    fixture.service.addWorkSegment(fixture.taskA, 10 * 60_000);
    assert.equal(fixture.service.getStatus().session?.activeMs, 21 * 60_000, 'break time is not task time');

    // Break completed: the same session resumes (§十五).
    fixture.service.endBreak();
    const resumed = fixture.service.getStatus().session;
    assert.equal(resumed?.onBreak, false);
    fixture.service.addWorkSegment(fixture.taskA, 19 * 60_000);
    assert.equal(fixture.service.getStatus().session?.activeMs, 40 * 60_000);
    assert.equal(fixture.store.getFocusSessions().length, 1, 'one logical session across the break');
  } finally {
    teardown(fixture);
  }
});

test('pause and complete end the session with the right outcome and release the active task', () => {
  const fixture = setup();
  try {
    fixture.service.start(fixture.taskA);
    fixture.service.pause();
    assert.equal(fixture.store.getActiveTaskId(), null);
    assert.equal(fixture.store.getFocusSessions()[0].outcome, 'paused');

    fixture.service.start(fixture.taskA);
    fixture.service.complete();
    const history = fixture.store.getFocusSessions();
    assert.equal(history.length, 2);
    const outcomes = history.map((session) => session.outcome).sort();
    assert.deepEqual(outcomes, ['completed', 'paused']);
    assert.equal(fixture.store.getLiveFocusSession(), null);
  } finally {
    teardown(fixture);
  }
});

test('live session with break state survives a restart; history stays correct', () => {
  const fixture = setup();
  try {
    fixture.service.start(fixture.taskA);
    fixture.service.addWorkSegment(fixture.taskA, 47 * 60_000);
    fixture.service.beginBreak();
    TaskStore.closeAllForDirectory(fixture.dir);

    const reopened = new TaskStore(fixture.dir);
    try {
      const live = reopened.getLiveFocusSession();
      assert.ok(live, 'the session must survive the restart');
      assert.equal(live.onBreak, true, 'break state persists');
      assert.equal(live.activeMs, 47 * 60_000);

      const service = new FocusSessionService(reopened, { now: () => NOW });
      service.endBreak();
      service.addWorkSegment(fixture.taskA, 3 * 60_000);
      service.complete();
      const history = reopened.getFocusSessions();
      assert.equal(history.length, 1);
      assert.equal(history[0].outcome, 'completed');
      assert.equal(history[0].activeMs, 50 * 60_000);
    } finally {
      TaskStore.closeAllForDirectory(fixture.dir);
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('status carries today/total work, plan and anchored block', () => {
  const fixture = setup();
  try {
    const block = fixture.store.createTimeBlock(
      { taskId: fixture.taskA, startAt: NOW, endAt: NOW + 90 * 60_000, source: 'planner' },
      NOW
    );
    fixture.store.updateTask(fixture.taskA, { estimateMinutes: 90 }, NOW);
    fixture.store.upsertDailyPlan({ taskId: fixture.taskA, localDate: '2026-08-14', plannedMinutes: 60 }, NOW);
    fixture.store.recordWorkSegment(fixture.taskA, NOW - 60_000, NOW, 60_000);

    fixture.service.start(fixture.taskA, block.id);
    const status = fixture.service.getStatus();
    assert.equal(status.session?.timeBlockId, block.id);
    assert.equal(status.block?.id, block.id);
    assert.equal(status.plannedMinutes, 60, 'daily plan beats the task estimate');
    assert.equal(status.todayTaskMs, 60_000);
    assert.equal(status.totalTaskMs, 60_000);
  } finally {
    teardown(fixture);
  }
});
