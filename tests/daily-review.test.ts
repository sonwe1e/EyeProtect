import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_SETTINGS, type ReminderEvent } from '../src/shared/types';
import { startOfLocalDate, localDateKey } from '../src/shared/calendar';
import { TaskStore } from '../src/main/taskStore';
import { ReminderHistoryStore } from '../src/main/reminderHistory';
import { buildDailyReview, parseDailyReviewDateKey } from '../src/main/dailyReview';

const NOW = new Date(2026, 7, 14, 12, 30, 0, 0).getTime();
const TODAY_KEY = localDateKey(NOW);
const TODAY_START = startOfLocalDate(NOW);
const YESTERDAY_START = TODAY_START - 24 * 60 * 60_000;

interface Fixture {
  store: TaskStore;
  history: ReminderHistoryStore;
  dir: string;
}

const setup = (): Fixture => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-daily-review-'));
  return {
    store: new TaskStore(dir),
    history: new ReminderHistoryStore(dir),
    dir
  };
};

const teardown = (fixture: Fixture): void => {
  TaskStore.closeAllForDirectory(fixture.dir);
  rmSync(fixture.dir, { recursive: true, force: true });
};

const makeReminder = (value: {
  timestamp: number;
  kind?: 'eye' | 'walk' | 'combined';
  action: ReminderEvent['action'];
  mode?: 'gentle' | 'guided' | 'focused';
  snoozeCount?: number;
}): ReminderEvent => ({
  timestamp: value.timestamp,
  kind: value.kind ?? 'eye',
  scheduledAt: value.timestamp,
  shownAt: value.timestamp,
  action: value.action,
  mode: value.mode ?? 'gentle',
  snoozeCount: value.snoozeCount ?? 0
});

test('buildDailyReview aggregates plans, work, reminders and focus sessions', () => {
  const fixture = setup();
  try {
    const { store, history } = fixture;
    const activeTask = store.createTask({ title: '活跃任务' }, NOW).id;
    const doneTask = store.createTask({ title: '完成任务' }, NOW).id;
    const interruptedTask = store.createTask({ title: '中断任务' }, NOW).id;
    const ignoredTask = store.createTask({ title: '未日计划任务' }, NOW).id;
    const yesterdayTask = store.createTask({ title: '昨天记录任务' }, NOW - 30_000).id;

    const yesterdayKey = localDateKey(YESTERDAY_START);
    store.upsertDailyPlan({ taskId: ignoredTask, localDate: yesterdayKey, plannedMinutes: 11 }, NOW);
    store.upsertDailyPlan({ taskId: activeTask, localDate: TODAY_KEY, plannedMinutes: 90, dailyRank: 1 }, NOW);
    store.upsertDailyPlan(
      { taskId: doneTask, localDate: TODAY_KEY, plannedMinutes: 120, dailyRank: 2 },
      NOW
    );

    store.updateTask(doneTask, { status: 'done' }, NOW);

    store.recordWorkSegment(activeTask, TODAY_START + 60 * 60_000, TODAY_START + 60 * 60_000 + 20 * 60_000, 20 * 60_000);
    store.recordWorkSegment(doneTask, TODAY_START + 3 * 60 * 60_000, TODAY_START + 3 * 60 * 60_000 + 10 * 60_000, 10 * 60_000);
    store.recordWorkSegment(activeTask, YESTERDAY_START + 3 * 60 * 60_000, YESTERDAY_START + 3 * 60 * 60_000 + 15 * 60_000, 15 * 60_000);
    store.recordWorkSegment(yesterdayTask, TODAY_START - 10 * 60_000, TODAY_START - 5 * 60_000, 5 * 60_000);

    const firstSession = store.startFocusSession({ taskId: activeTask }, TODAY_START + 20 * 60_000);
    store.addFocusSessionActiveMs(firstSession.id, 12 * 60_000, TODAY_START + 32 * 60_000);
    store.endFocusSession(firstSession.id, 'completed', TODAY_START + 32 * 60_000);
    const secondSession = store.startFocusSession({ taskId: interruptedTask }, TODAY_START + 90 * 60_000);
    store.addFocusSessionActiveMs(secondSession.id, 6 * 60_000, TODAY_START + 96 * 60_000);
    store.endFocusSession(secondSession.id, 'interrupted', TODAY_START + 96 * 60_000);
    const thirdSession = store.startFocusSession({ taskId: activeTask }, TODAY_START + 110 * 60_000);
    store.endFocusSession(thirdSession.id, 'paused', TODAY_START + 110 * 60_000);

    history.record(
      makeReminder({
        timestamp: TODAY_START - 11 * 60_000,
        action: 'complete',
        kind: 'walk'
      }),
      DEFAULT_SETTINGS
    );
    history.record(
      makeReminder({ timestamp: TODAY_START + 5 * 60_000, action: 'complete', kind: 'eye' }),
      { ...DEFAULT_SETTINGS, historyEnabled: true }
    );
    history.record(
      makeReminder({ timestamp: TODAY_START + 15 * 60_000, action: 'skip', kind: 'walk' }),
      { ...DEFAULT_SETTINGS, historyEnabled: true }
    );
    history.record(
      makeReminder({ timestamp: TODAY_START + 25 * 60_000, action: 'snooze', kind: 'combined', snoozeCount: 1 }),
      { ...DEFAULT_SETTINGS, historyEnabled: true }
    );

    const summary = buildDailyReview(store, history, TODAY_KEY);
    assert.equal(summary.localDate, TODAY_KEY);
    assert.equal(summary.plannedMinutes, 210);
    assert.equal(summary.actualWorkMs, 30 * 60_000);
    assert.equal(summary.completedPlannedTaskCount, 1);
    assert.equal(summary.plannedTaskCount, 2);
    assert.equal(summary.completedTodaysThreeCount, 1);
    assert.equal(summary.todaysThreeCount, 2);
    assert.equal(summary.focusSessionCount, 3);
    assert.equal(summary.focusCompletedSessions, 1);
    assert.equal(summary.focusPausedSessions, 1);
    assert.equal(summary.focusInterruptedSessions, 1);
    assert.equal(summary.focusWorkMs, 18 * 60_000);
    assert.equal(summary.reminderStats.complete, 1);
    assert.equal(summary.reminderStats.skip, 1);
    assert.equal(summary.reminderStats.naturalBreak, 0);
    assert.equal(summary.reminderStats.completionRate, 1 / 3);
    const taskSummary = new Map(summary.tasks.map((entry) => [entry.taskId, entry]));
    const activeTaskSummary = taskSummary.get(activeTask);
    const doneTaskSummary = taskSummary.get(doneTask);
    assert.ok(activeTaskSummary);
    assert.ok(doneTaskSummary);
    assert.equal(activeTaskSummary.plannedMinutes, 90);
    assert.equal(activeTaskSummary.todayWorkMs, 20 * 60_000);
    assert.equal(activeTaskSummary.totalWorkMs, 35 * 60_000);
    assert.equal(doneTaskSummary.plannedMinutes, 120);
    assert.equal(doneTaskSummary.todayWorkMs, 10 * 60_000);
    assert.equal(doneTaskSummary.totalWorkMs, 10 * 60_000);
  } finally {
    teardown(fixture);
  }
});

test('buildDailyReview ignores invalid date keys and parseDailyReviewDateKey validates calendar days', () => {
  const fixture = setup();
  try {
    const fixtureDate = parseDailyReviewDateKey(TODAY_KEY);
    assert.equal(fixtureDate, TODAY_START);
    assert.equal(fixtureDate, startOfLocalDate(fixtureDate));
    assert.throws(() => parseDailyReviewDateKey('2026-13-01'), /无效的日期/);
    assert.throws(() => parseDailyReviewDateKey('not-a-date'), /无效的日期/);

    const defaultSummary = buildDailyReview(fixture.store, fixture.history, TODAY_KEY);
    assert.equal(defaultSummary.localDate, TODAY_KEY);
    assert.equal(defaultSummary.tasks.length, 0);
    assert.equal(defaultSummary.focusSessionCount, 0);
  } finally {
    teardown(fixture);
  }
});
