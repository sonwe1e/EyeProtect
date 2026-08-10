/**
 * Daily Planning helper correctness (USERPLAN 1.2 §十/§十一, PR3).
 *
 * The two product promises under test:
 *   1. Workload honesty — unestimated commitments are counted as items,
 *      never invented as minutes.
 *   2. Civil-time triage — rescheduling keeps the wall-clock time and never
 *      does raw +86_400_000 day math.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DAILY_GOALS,
  planWorkloadMinutes,
  rescheduleTaskToDay,
  summarizeDailyCapacity
} from '../src/shared/dailyPlanning';
import { addLocalDays, localDateAtMinutes, startOfLocalDate } from '../src/shared/calendar';
import type { DailyTaskPlan, Task } from '../src/shared/types';

const NOW = new Date(2026, 7, 12, 10, 30, 0, 0).getTime();

const task = (over: Partial<Task>): Task =>
  ({
    id: 't1',
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
    sectionId: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    revision: 1,
    ...over
  }) as Task;

const plan = (over: Partial<DailyTaskPlan>): DailyTaskPlan => ({
  taskId: 't1',
  localDate: '2026-08-12',
  plannedMinutes: null,
  dailyRank: null,
  sortOrder: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
});

test('daily goal cap is exactly three', () => {
  assert.equal(MAX_DAILY_GOALS, 3);
});

test('workload minutes prefer the day commitment, then the task estimate, else nothing', () => {
  const estimated = task({ id: 'a', estimateMinutes: 45 });
  assert.equal(planWorkloadMinutes(plan({ taskId: 'a', plannedMinutes: 90 }), estimated), 90);
  assert.equal(planWorkloadMinutes(plan({ taskId: 'a' }), estimated), 45);
  assert.equal(planWorkloadMinutes(plan({ taskId: 'a' }), task({ id: 'a' })), null);
  assert.equal(planWorkloadMinutes(plan({ taskId: 'a' }), undefined), null);
});

test('capacity summary never fakes minutes for unestimated work', () => {
  const tasks = new Map([
    ['a', task({ id: 'a', estimateMinutes: 60 })],
    ['b', task({ id: 'b', estimateMinutes: 30 })],
    ['c', task({ id: 'c' })]
  ]);
  const summary = summarizeDailyCapacity(
    [
      plan({ taskId: 'a', plannedMinutes: 120 }),
      plan({ taskId: 'b' }),
      plan({ taskId: 'c' })
    ],
    tasks,
    180,
    20
  );
  assert.equal(summary.plannedMinutes, 150, '120 committed + 30 estimated');
  assert.equal(summary.unestimatedCount, 1, 'task c is counted, not invented');
  assert.equal(summary.overCommitted, false);
  assert.equal(summary.estimatedBreakWindows, 9, '180 / 20');
});

test('overcommitment is flagged the minute planned exceeds capacity', () => {
  const tasks = new Map([['a', task({ id: 'a', estimateMinutes: 200 })]]);
  const summary = summarizeDailyCapacity([plan({ taskId: 'a' })], tasks, 180, 20);
  assert.equal(summary.overCommitted, true);
});

test('triage keeps the wall-clock time when moving to another day', () => {
  const todayStart = startOfLocalDate(NOW);
  const atSixThirty = localDateAtMinutes(todayStart, 6 * 60 + 30);
  const source = task({ plannedAt: atSixThirty });

  const sameDay = new Date(rescheduleTaskToDay(source, todayStart) ?? 0);
  assert.equal(sameDay.getHours(), 6, 'a 06:30 task stays at 06:30');
  assert.equal(sameDay.getMinutes(), 30);

  const tomorrowStart = addLocalDays(todayStart, 1);
  const tomorrow = new Date(rescheduleTaskToDay(source, tomorrowStart) ?? 0);
  assert.equal(tomorrow.getHours(), 6, 'wall-clock time survives the day shift');
  assert.equal(tomorrow.getMinutes(), 30);
  assert.equal(tomorrow.getDate(), new Date(tomorrowStart).getDate());
});

test('triage without a planned time defaults to 09:00 on the target day', () => {
  const todayStart = startOfLocalDate(NOW);
  const moved = rescheduleTaskToDay(task({ plannedAt: null }), todayStart);
  const date = new Date(moved ?? 0);
  assert.equal(date.getHours(), 9);
  assert.equal(date.getMinutes(), 0);
});

test('triage to "later" clears the planned time entirely', () => {
  assert.equal(rescheduleTaskToDay(task({ plannedAt: NOW }), null), null);
});
