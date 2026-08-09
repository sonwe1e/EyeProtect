import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesTaskView,
  nextRecurrenceFireAt,
  sanitizeProject,
  sanitizeTask,
  sortTasksForView,
  type RecurrenceRule,
  type Task
} from '../src/shared/types';

const now = new Date('2026-08-09T12:00:00').getTime();

const task = (over: Partial<Task>): Task =>
  ({
    id: 't1',
    title: '写论文',
    notes: null,
    status: 'inbox',
    priority: 'normal',
    projectId: null,
    parentId: null,
    tags: [],
    plannedAt: null,
    dueAt: null,
    reminderAt: null,
    recurrence: null,
    context: 'desk',
    estimateMinutes: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...over
  }) as Task;

test('sanitizeTask coerces malformed input into a safe Task', () => {
  const result = sanitizeTask(
    { id: '  ', title: '  ', text: 'ignored' },
    now
  );
  assert.equal(result, null);
});

test('sanitizeTask rejects empty title and caps length', () => {
  assert.equal(sanitizeTask({ id: 'a', title: '   ' }, now), null);
  const long = 'x'.repeat(500);
  const result = sanitizeTask({ id: 'a', title: long }, now);
  assert.ok(result);
  assert.equal(result!.title.length, 120);
});

test('sanitizeTask derives done status from completed flag for legacy input', () => {
  const result = sanitizeTask({ id: 'a', title: 'x', completed: true }, now);
  assert.equal(result!.status, 'done');
  assert.ok(result!.completedAt);
});

test('sanitizeTask validates tags, timestamps and recurrence', () => {
  const result = sanitizeTask(
    {
      id: 'a',
      title: 'x',
      tags: ['a', 'a', 'way-too-long-tag-name-that-exceeds-limit', 42 as unknown as string],
      dueAt: -5,
      recurrence: { type: 'weekly', interval: 2, weekdays: [1, 99, 3] }
    },
    now
  );
  assert.ok(result);
  assert.deepEqual(result!.tags[0], 'a');
  assert.ok(result!.tags[1].length <= 24, 'tags are capped at 24 chars');
  assert.equal(result!.tags.length, 2, 'duplicate dropped, non-string dropped');
  assert.equal(result!.dueAt, null);
  assert.deepEqual(result!.recurrence, { type: 'weekly', interval: 2, weekdays: [1, 3] });
});

test('sanitizeProject rejects bad color and empty name', () => {
  assert.equal(sanitizeProject({ id: 'p', name: '' }, now), null);
  assert.equal(sanitizeProject({ id: 'p', name: 'x', color: 'red' }, now)!.color, null);
  assert.equal(sanitizeProject({ id: 'p', name: 'x', color: '#2f8f6f' }, now)!.color, '#2f8f6f');
});

test('matchesTaskView: today = active/inbox tasks that are started, due today, or planned today', () => {
  // A plain inbox task with no date lives only in the inbox.
  assert.ok(matchesTaskView(task({ status: 'inbox' }), 'inbox', now));
  assert.ok(!matchesTaskView(task({ status: 'inbox' }), 'today', now));
  // An actively-worked task shows in Today even without a date.
  assert.ok(matchesTaskView(task({ status: 'active' }), 'today', now));
  // A task planned/due today shows in Today.
  assert.ok(matchesTaskView(task({ status: 'inbox', dueAt: now + 3_600_000 }), 'today', now));
  assert.ok(!matchesTaskView(task({ status: 'done' }), 'today', now));
});

test('matchesTaskView: overdue due dates surface in overdue + today', () => {
  const overdue = task({ status: 'active', dueAt: now - 86_400_000 });
  assert.ok(matchesTaskView(overdue, 'overdue', now));
  assert.ok(matchesTaskView(overdue, 'today', now));
  assert.ok(!matchesTaskView(overdue, 'upcoming', now));
});

test('matchesTaskView: future planned falls in upcoming not today', () => {
  const future = task({ status: 'inbox', plannedAt: now + 3 * 86_400_000 });
  assert.ok(matchesTaskView(future, 'upcoming', now));
  assert.ok(!matchesTaskView(future, 'today', now));
});

test('matchesTaskView: far future is in no view', () => {
  const far = task({ status: 'inbox', dueAt: now + 30 * 86_400_000 });
  assert.ok(!matchesTaskView(far, 'upcoming', now));
  assert.ok(!matchesTaskView(far, 'today', now));
});

test('sortTasksForView prioritizes overdue then urgency then time', () => {
  const overdue = task({ id: 'overdue', dueAt: now - 86_400_000, priority: 'normal' });
  const urgent = task({ id: 'urgent', dueAt: now + 86_400_000, priority: 'urgent' });
  const normal = task({ id: 'normal', dueAt: now + 86_400_000, priority: 'normal' });
  const sorted = sortTasksForView([normal, urgent, overdue], now);
  assert.deepEqual(sorted.map((t) => t.id), ['overdue', 'urgent', 'normal']);
});

test('nextRecurrenceFireAt: daily returns the anchor when reference is now (first occurrence)', () => {
  // reference === now means "the anchor is right now" → first fire is the anchor.
  const rule: RecurrenceRule = { type: 'daily', interval: 1 };
  const next = nextRecurrenceFireAt(rule, now, now);
  assert.equal(next, now);
});

test('nextRecurrenceFireAt: daily advances to the next whole interval after a past anchor', () => {
  // Anchor was 3h ago; next fire must be the next whole day boundary, > now.
  const reference = now - 3 * 3_600_000;
  const rule: RecurrenceRule = { type: 'daily', interval: 1 };
  const next = nextRecurrenceFireAt(rule, reference, now);
  assert.ok(next);
  assert.ok(next! > now, 'next fire is strictly in the future');
  // Exactly one day after the anchor (whole-interval stepping).
  assert.equal(next, reference + 86_400_000);
});

test('nextRecurrenceFireAt: daily with interval > 1 skips the configured number of days', () => {
  const reference = now - 3 * 3_600_000;
  const rule: RecurrenceRule = { type: 'daily', interval: 3 };
  const next = nextRecurrenceFireAt(rule, reference, now);
  assert.equal(next, reference + 3 * 86_400_000);
});

test('nextRecurrenceFireAt: weekly lands on the next configured weekday at the anchor time', () => {
  // Rule on Mondays (1). Whatever day `now` falls on, the next fire must be a
  // Monday at the anchor's local time, >= from, and the earliest such.
  const from = now;
  const rule: RecurrenceRule = { type: 'weekly', interval: 1, weekdays: [1] };
  const next = nextRecurrenceFireAt(rule, from, from);
  assert.ok(next);
  const resultDate = new Date(next!);
  assert.equal(resultDate.getDay(), 1, 'lands on Monday');
  assert.equal(resultDate.getHours(), new Date(from).getHours());
  assert.equal(resultDate.getMinutes(), 0);
  assert.ok(next! >= from, 'not before the reference');
  // The day before must NOT be a matching Monday still >= from (earliest).
  const previousDay = new Date(resultDate);
  previousDay.setDate(resultDate.getDate() - 1);
  assert.ok(previousDay.getDay() !== 1 || previousDay.getTime() < from);
});

test('nextRecurrenceFireAt: weekly interval skips inactive weeks', () => {
  const anchor = new Date(2026, 7, 3, 9, 0, 0, 0).getTime(); // Monday
  const reference = new Date(2026, 7, 4, 9, 0, 0, 0).getTime();
  const next = nextRecurrenceFireAt({ type: 'weekly', interval: 2, weekdays: [1] }, anchor, reference);
  assert.equal(next, new Date(2026, 7, 17, 9, 0, 0, 0).getTime());
});

test('calendar recurrence retains local time across a DST boundary', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const anchor = new Date(2026, 2, 7, 9, 0, 0, 0).getTime();
    const reference = new Date(2026, 2, 8, 10, 0, 0, 0).getTime();
    const next = nextRecurrenceFireAt({ type: 'daily', interval: 1 }, anchor, reference);
    assert.ok(next);
    assert.equal(new Date(next!).getHours(), 9);
    assert.equal(new Date(next!).getDate(), 9);
    assert.equal((next! - anchor) / 3_600_000, 47, 'spring-forward uses calendar days, not fixed 24h blocks');
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});

test('nextRecurrenceFireAt: after-completion anchors to completion time', () => {
  const rule: RecurrenceRule = { type: 'after-completion', days: 7 };
  const completedAt = now;
  const next = nextRecurrenceFireAt(rule, completedAt, now);
  assert.equal(next, completedAt + 7 * 86_400_000);
});

test('nextRecurrenceFireAt: nullish/invalid rules produce nothing', () => {
  assert.equal(nextRecurrenceFireAt(null as unknown as RecurrenceRule, now, now), null);
  assert.equal(
    nextRecurrenceFireAt({ type: 'weekly', interval: 1, weekdays: [] }, now, now),
    null
  );
});

test('sanitizeRecurrenceRule guards each variant (via sanitizeTask)', () => {
  const daily = sanitizeTask({ id: 'a', title: 'x', recurrence: { type: 'daily' } }, now);
  assert.deepEqual(daily!.recurrence, { type: 'daily', interval: 1 });
  const monthly = sanitizeTask(
    { id: 'a', title: 'x', recurrence: { type: 'monthly', interval: 2, day: 15 } },
    now
  );
  assert.deepEqual(monthly!.recurrence, { type: 'monthly', interval: 2, day: 15 });
  const nonsense = sanitizeTask({ id: 'a', title: 'x', recurrence: { type: 'nonsense' } }, now);
  assert.equal(nonsense!.recurrence, null);
});
