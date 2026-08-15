import assert from 'node:assert/strict';
import test from 'node:test';
import type { DailyTaskPlan, Task } from '../src/shared/types';
import { deriveTodaySections } from '../src/renderer/src/features/tasks/todaySections';

const task = (id: string, plannedAt: number | null = null): Task => ({
  id,
  title: id,
  notes: '',
  status: 'open',
  priority: 'normal',
  tags: [],
  projectId: null,
  parentId: null,
  sectionId: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  dueAt: null,
  plannedAt,
  estimateMinutes: null,
  sortOrder: 0,
  reminderAt: null,
  recurrence: null,
  context: 'desk',
  remindOnBreak: false,
  revision: 1
});

const plan = (taskId: string, dailyRank: DailyTaskPlan['dailyRank']): DailyTaskPlan => ({
  taskId,
  localDate: '2026-08-12',
  dailyRank,
  plannedMinutes: 30,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1
});

test('Today Scheduled is derived only from TimeBlock ownership', () => {
  const legacyPlanned = task('legacy-planned', Date.now());
  const timeboxed = task('timeboxed');
  const result = deriveTodaySections(
    [legacyPlanned, timeboxed],
    [plan('legacy-planned', null), plan('timeboxed', null)],
    new Set(['timeboxed'])
  );
  assert.deepEqual(result.scheduled.map((entry) => entry.id), ['timeboxed']);
  assert.deepEqual(result.flexible.map((entry) => entry.id), ['legacy-planned']);
});

test('Today Flexible contains Daily Plan commitments without a TimeBlock', () => {
  const ranked = task('ranked');
  const flexible = task('flexible');
  const dueOnly = task('due-only');
  const result = deriveTodaySections(
    [ranked, flexible, dueOnly],
    [plan('ranked', 1), plan('flexible', null)],
    new Set()
  );
  assert.deepEqual(result.todaysThree.map((entry) => entry.id), ['ranked']);
  assert.deepEqual(result.flexible.map((entry) => entry.id), ['flexible']);
});

test('a Daily Plan commitment appears even without legacy plannedAt or dueAt', () => {
  const commitment = task('daily-plan-only');
  const result = deriveTodaySections(
    [commitment],
    [plan('daily-plan-only', null)],
    new Set()
  );
  assert.deepEqual(result.flexible.map((entry) => entry.id), ['daily-plan-only']);
});

test('Today sections are mutually exclusive when a ranked task also has a TimeBlock', () => {
  const rankedAndScheduled = task('ranked-and-scheduled');
  const result = deriveTodaySections(
    [rankedAndScheduled],
    [plan('ranked-and-scheduled', 1)],
    new Set(['ranked-and-scheduled'])
  );
  assert.deepEqual(result.todaysThree.map((entry) => entry.id), ['ranked-and-scheduled']);
  assert.deepEqual(result.scheduled, []);
  assert.deepEqual(result.flexible, []);
});
