import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextStandaloneReminderFireAt,
  sanitizeStandaloneReminderSchedule
} from '../src/shared/types';

/**
 * Pure schedule helpers used by backup import sanitizers and legacy recovery.
 * StandaloneReminderService itself was removed (Round B); storage tables stay.
 */
const NOW = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

test('standalone schedule sanitizer supports once, daily, weekdays, weekly and custom', () => {
  assert.deepEqual(sanitizeStandaloneReminderSchedule({ type: 'once', fireAt: NOW }), {
    type: 'once', fireAt: NOW
  });
  assert.deepEqual(sanitizeStandaloneReminderSchedule({ type: 'daily', hour: 9, minute: 30 }), {
    type: 'daily', hour: 9, minute: 30
  });
  assert.deepEqual(sanitizeStandaloneReminderSchedule({ type: 'weekdays', hour: 9, minute: 30 }), {
    type: 'weekdays', hour: 9, minute: 30
  });
  assert.deepEqual(
    sanitizeStandaloneReminderSchedule({ type: 'weekly', weekdays: [5, 1, 5], hour: 9, minute: 30 }),
    { type: 'weekly', weekdays: [1, 5], hour: 9, minute: 30 }
  );
  assert.deepEqual(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 3 }),
    { type: 'custom', anchorAt: NOW, intervalDays: 3 }
  );
  assert.equal(sanitizeStandaloneReminderSchedule({ type: 'weekly', weekdays: [], hour: 9, minute: 30 }), null);
});

test('custom schedule sanitizer rejects out-of-range interval days', () => {
  // The UI clamps to 1–365; anything beyond must be rejected (not silently
  // coerced), so an invalid create surfaces as a validation error instead of
  // pretending a reminder was created.
  assert.equal(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 366 }),
    null
  );
  assert.equal(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 0 }),
    null
  );
  assert.equal(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 2.5 }),
    null
  );
  assert.deepEqual(
    sanitizeStandaloneReminderSchedule({ type: 'custom', anchorAt: NOW, intervalDays: 365 }),
    { type: 'custom', anchorAt: NOW, intervalDays: 365 }
  );
});

test('custom recurrence advances by local calendar days and retains its wall-clock time', () => {
  const anchor = new Date(2026, 2, 7, 9, 45, 0, 0).getTime();
  const reference = new Date(2026, 2, 10, 12, 0, 0, 0).getTime();
  const next = nextStandaloneReminderFireAt({ type: 'custom', anchorAt: anchor, intervalDays: 2 }, reference);
  assert.ok(next);
  const result = new Date(next!);
  assert.equal(result.getHours(), 9);
  assert.equal(result.getMinutes(), 45);
  assert.equal(result.getDate(), 11);
});

test('weekly next-fire with no weekdays produces nothing (defensive)', () => {
  // The sanitizer rejects empty weekly weekdays, but the pure helper must not
  // loop forever or fabricate a deadline when called with such a schedule.
  assert.equal(
    nextStandaloneReminderFireAt({ type: 'weekly', weekdays: [], hour: 9, minute: 0 }, NOW),
    null
  );
});
