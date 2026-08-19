import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TimeBlock } from '../src/shared/types';
import { getTaskRowMetadata } from '../src/renderer/src/features/tasks/taskRowMetadata';

const NOW = new Date('2026-08-12T10:00:00').getTime();

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Prepare release',
  notes: null,
  status: 'open',
  priority: 'normal',
  projectId: 'project-1',
  sectionId: null,
  parentId: null,
  tags: ['release', 'windows'],
  context: 'desk',
  remindOnBreak: false,
  plannedAt: NOW - 86_400_000,
  dueAt: NOW + 3_600_000,
  reminderAt: null,
  estimateMinutes: 60,
  recurrence: null,
  sortOrder: 0,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  ...overrides
} as Task);

const block = (startAt: number): TimeBlock => ({
  id: 'block-1',
  taskId: 'task-1',
  startAt,
  endAt: startAt + 60 * 60_000,
  timeZone: 'local',
  source: 'planner',
  createdAt: NOW,
  updatedAt: NOW
});

test('Today metadata uses the real TimeBlock instead of legacy plannedAt', () => {
  const scheduledAt = new Date('2026-08-12T14:00:00').getTime();
  const result = getTaskRowMetadata(task(), 'today', NOW, 'Research', [block(scheduledAt)], false);
  assert.deepEqual(result.map((item) => item.kind), ['scheduled', 'project', 'tag']);
  assert.equal(result[0]?.timestamp, scheduledAt);
  assert.notEqual(result[0]?.timestamp, task().plannedAt);
});

test('Today falls back to the deadline and gives away context priority over tags', () => {
  const result = getTaskRowMetadata(task({ context: 'away' }), 'today', NOW, 'Research', [], false);
  assert.deepEqual(result.map((item) => item.kind), ['due', 'project', 'context']);
});

test('project-scoped rows never repeat the project name', () => {
  const result = getTaskRowMetadata(task(), 'inbox', NOW, 'Research', [], true);
  assert.deepEqual(result.map((item) => item.kind), ['due', 'tag']);
  assert.ok(result.every((item) => item.kind !== 'project'));
});

test('row metadata is capped at three items', () => {
  const result = getTaskRowMetadata(task({ context: 'away' }), 'today', NOW, 'Research', [block(NOW)], false);
  assert.equal(result.length, 3);
});
