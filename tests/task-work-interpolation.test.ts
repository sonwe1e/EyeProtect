import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskWorkSummary } from '../src/shared/types';
import { interpolateTaskWork } from '../src/renderer/src/hooks/useTaskWork';

const summary = (tracking: boolean): TaskWorkSummary => ({
  taskId: 'task-1',
  tracking,
  taskActiveMs: 10_000,
  currentSessionMs: 2_000,
  continuousActiveMs: 20_000,
  timeboxNotified: false
});

test('renderer interpolates a running work snapshot without writing every second', () => {
  assert.deepEqual(interpolateTaskWork({ summary: summary(true), receivedAt: 100 }, 2_100), {
    ...summary(true),
    taskActiveMs: 12_000,
    currentSessionMs: 4_000,
    continuousActiveMs: 22_000
  });
});

test('renderer does not interpolate a paused work snapshot', () => {
  const paused = summary(false);
  assert.equal(interpolateTaskWork({ summary: paused, receivedAt: 100 }, 2_100), paused);
});
