import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/shared/types';
import { buildTimelineLayout } from '../src/renderer/src/features/tasks/planLayout';

const day = new Date('2026-08-10T00:00:00').getTime();
const task = (id: string, minutes: number, duration: number): Task => ({
  id,
  title: id,
  notes: null,
  status: 'open',
  priority: 'normal',
  projectId: null,
  parentId: null,
  tags: [],
  plannedAt: day + minutes * 60_000,
  dueAt: null,
  reminderAt: null,
  recurrence: null,
  estimateMinutes: duration,
  context: 'desk',
  remindOnBreak: false,
  reminderConsumedAt: null,
  sortOrder: 0,
  createdAt: day,
  updatedAt: day,
  completedAt: null
});

test('timeline layout separates overlaps and restores full width after the cluster', () => {
  const layout = buildTimelineLayout([
    task('first', 9 * 60, 60),
    task('overlap', 9 * 60 + 30, 60),
    task('later', 11 * 60, 30)
  ], day);
  assert.deepEqual(layout.get('first'), { lane: 0, count: 2 });
  assert.deepEqual(layout.get('overlap'), { lane: 1, count: 2 });
  assert.deepEqual(layout.get('later'), { lane: 0, count: 1 });
});

test('timeline layout reuses a free lane inside one overlap cluster', () => {
  const layout = buildTimelineLayout([
    task('long', 9 * 60, 180),
    task('short', 9 * 60, 30),
    task('reuse', 10 * 60, 30)
  ], day);
  assert.deepEqual(layout.get('reuse'), { lane: 1, count: 2 });
});
