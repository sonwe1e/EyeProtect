import assert from 'node:assert/strict';
import test from 'node:test';
import type { DailyTaskPlan, Task } from '../src/shared/types';
import { deriveTodayExecutionModel } from '../src/renderer/src/features/tasks/todayViewModel';

const task = (id: string, status: Task['status'] = 'open'): Task => ({
  id,
  title: id,
  notes: '',
  status,
  priority: 'normal',
  tags: [],
  projectId: null,
  parentId: null,
  sectionId: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  dueAt: null,
  plannedAt: null,
  estimateMinutes: null,
  sortOrder: 0,
  reminderAt: null,
  reminderEnabled: false,
  reminderConsumedAt: null,
  recurrence: null,
  breakSuggestion: null,
  revision: 1
});

const plan = (taskId: string, dailyRank: 1 | 2 | 3 | null): DailyTaskPlan => ({
  taskId,
  localDate: '2026-08-12',
  dailyRank,
  plannedMinutes: 30,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1
});

test('one unique model powers Today count and Focus candidates', () => {
  const ranked = task('ranked');
  const scheduled = task('scheduled');
  const flexible = task('flexible');
  const completed = task('completed', 'done');
  const model = deriveTodayExecutionModel(
    [ranked, scheduled, flexible, completed],
    [plan('ranked', 1), plan('flexible', null), plan('completed', null)],
    new Set(['ranked', 'scheduled', 'completed'])
  );

  assert.deepEqual(model.tasks.map((entry) => entry.id), ['ranked', 'scheduled', 'flexible']);
  assert.equal(model.count, 3);
  assert.equal(model.taskIds.size, 3);
  assert.deepEqual(model.todaysThree.map((entry) => entry.id), ['ranked']);
  assert.deepEqual(model.scheduled.map((entry) => entry.id), ['scheduled']);
  assert.deepEqual(model.flexible.map((entry) => entry.id), ['flexible']);
});
