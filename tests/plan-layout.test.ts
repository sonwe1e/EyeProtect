import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task, TimeBlock } from '../src/shared/types';
import { assignIntervalLanes, buildBlockLayout, buildTimelineLayout, shiftPlanSelection, timelineBlockDensity } from '../src/renderer/src/features/tasks/planLayout';

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

// ── PR4: lane assignment operates on real TimeBlock intervals ──────────────

const block = (id: string, startMinutes: number, endMinutes: number): TimeBlock => ({
  id,
  taskId: `task-${id}`,
  startAt: day + startMinutes * 60_000,
  endAt: day + endMinutes * 60_000,
  timeZone: 'local',
  source: 'manual',
  createdAt: day,
  updatedAt: day
});

test('block layout separates overlapping intervals into lanes', () => {
  const layout = buildBlockLayout([
    block('a', 9 * 60, 10 * 60),
    block('b', 9 * 60 + 30, 10 * 60 + 30),
    block('c', 11 * 60, 11 * 60 + 30)
  ]);
  assert.deepEqual(layout.get('a'), { lane: 0, count: 2 });
  assert.deepEqual(layout.get('b'), { lane: 1, count: 2 });
  assert.deepEqual(layout.get('c'), { lane: 0, count: 1 });
});

test('one task owning N blocks lays out each block independently', () => {
  const layout = assignIntervalLanes([
    { id: 'same-1', startAt: day + 9 * 60 * 60_000, endAt: day + 11 * 60 * 60_000 },
    { id: 'same-2', startAt: day + 14 * 60 * 60_000, endAt: day + 16 * 60 * 60_000 }
  ]);
  assert.deepEqual(layout.get('same-1'), { lane: 0, count: 1 });
  assert.deepEqual(layout.get('same-2'), { lane: 0, count: 1 }, 'non-overlapping blocks of the same task never share width');
});

test('block layout keeps three-way overlaps in three lanes', () => {
  const layout = buildBlockLayout([
    block('x', 9 * 60, 12 * 60),
    block('y', 10 * 60, 11 * 60),
    block('z', 10 * 60 + 30, 11 * 60 + 30)
  ]);
  const lanes = new Set([
    layout.get('x')?.lane,
    layout.get('y')?.lane,
    layout.get('z')?.lane
  ]);
  assert.equal(lanes.size, 3);
  assert.equal(layout.get('x')?.count, 3);
});

test('block density preserves the geometry of 15, 30 and longer blocks', () => {
  assert.equal(timelineBlockDensity(15), 'micro');
  assert.equal(timelineBlockDensity(30), 'compact');
  assert.equal(timelineBlockDensity(45), 'full');
  assert.equal(timelineBlockDensity(60), 'full');
});

test('week navigation keeps the selected date at the same relative position', () => {
  const anchor = new Date('2026-08-12T00:00:00').getTime();
  const selected = new Date('2026-08-14T00:00:00').getTime();
  const shifted = shiftPlanSelection(anchor, selected, 7);
  assert.equal(new Date(shifted.stripAnchor).getDate(), 19);
  assert.equal(new Date(shifted.selectedDay).getDate(), 21);
  assert.equal(shifted.selectedDay - shifted.stripAnchor, selected - anchor);
});
