import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project, Task } from '../src/shared/types';
import { isProjectAssignable, isProjectWritable, isTaskAvailableForPlanning } from '../src/shared/projectPolicy';

const project = (status: Project['status']): Project => ({
  id: `project-${status}`,
  name: `Project ${status}`,
  goal: null,
  viewMode: 'list',
  color: null,
  parentId: null,
  status,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1
});

const task = (projectId: string | null): Task => ({
  id: `task-${projectId ?? 'inbox'}`,
  title: 'Task',
  notes: null,
  status: 'open',
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

test('isProjectAssignable: only active projects accept new tasks', () => {
  assert.equal(isProjectAssignable(project('active')), true);
  assert.equal(isProjectAssignable(project('onHold')), false);
  assert.equal(isProjectAssignable(project('completed')), false);
  assert.equal(isProjectAssignable(project('archived')), false);
});

test('isProjectAssignable: null/undefined are not assignable', () => {
  assert.equal(isProjectAssignable(null), false);
  assert.equal(isProjectAssignable(undefined), false);
});

test('isProjectWritable: active and onHold are writable', () => {
  assert.equal(isProjectWritable(project('active')), true);
  assert.equal(isProjectWritable(project('onHold')), true);
});

test('isProjectWritable: completed and archived are read-only', () => {
  assert.equal(isProjectWritable(project('completed')), false);
  assert.equal(isProjectWritable(project('archived')), false);
});

test('isProjectWritable: null/undefined are not writable', () => {
  assert.equal(isProjectWritable(null), false);
  assert.equal(isProjectWritable(undefined), false);
});

test('isTaskAvailableForPlanning: inbox tasks (no project) are always available', () => {
  assert.equal(isTaskAvailableForPlanning(task(null), undefined), true);
  assert.equal(isTaskAvailableForPlanning(task(null), null), true);
});

test('isTaskAvailableForPlanning: tasks in active projects are available', () => {
  assert.equal(isTaskAvailableForPlanning(task('p1'), project('active')), true);
});

test('isTaskAvailableForPlanning: tasks in onHold projects are available', () => {
  assert.equal(isTaskAvailableForPlanning(task('p1'), project('onHold')), true);
});

test('isTaskAvailableForPlanning: tasks in completed projects are NOT available', () => {
  assert.equal(isTaskAvailableForPlanning(task('p1'), project('completed')), false);
});

test('isTaskAvailableForPlanning: tasks in archived projects are NOT available', () => {
  assert.equal(isTaskAvailableForPlanning(task('p1'), project('archived')), false);
});

test('isTaskAvailableForPlanning: task with unknown project defaults to available', () => {
  assert.equal(isTaskAvailableForPlanning(task('missing'), undefined), true);
});
