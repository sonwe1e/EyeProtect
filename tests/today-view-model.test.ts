import assert from 'node:assert/strict';
import test from 'node:test';
import type { DailyTaskPlan, Project, Task } from '../src/shared/types';
import { deriveTodayExecutionModel } from '../src/renderer/src/features/tasks/todayViewModel';

const task = (id: string, status: Task['status'] = 'open', projectId: string | null = null): Task => ({
  id,
  title: id,
  notes: '',
  status,
  priority: 'normal',
  tags: [],
  projectId,
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
  recurrence: null,
  context: 'desk',
  remindOnBreak: false,
  revision: 1
});

const project = (id: string, status: Project['status']): Project => ({
  id,
  name: id,
  goal: null,
  viewMode: 'list',
  color: null,
  parentId: null,
  status,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1
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

test('tasks from completed/archived projects are excluded from Today model and Focus candidates', () => {
  const activeTask = task('active', 'open', 'active-project');
  const completedTask = task('completed', 'open', 'completed-project');
  const archivedTask = task('archived', 'open', 'archived-project');
  const projects = [
    project('active-project', 'active'),
    project('completed-project', 'completed'),
    project('archived-project', 'archived')
  ];
  const model = deriveTodayExecutionModel(
    [activeTask, completedTask, archivedTask],
    [plan('active', null), plan('completed', null), plan('archived', null)],
    new Set(),
    projects
  );

  assert.deepEqual(model.tasks.map((entry) => entry.id), ['active']);
  assert.equal(model.count, 1);
  assert.ok(!model.taskIds.has('completed'));
  assert.ok(!model.taskIds.has('archived'));
});
