/**
 * Civil-time / calendar math correctness suite (USERPLAN 1.2 PR0, §二十一).
 *
 * These tests express DST-safety as *properties* that must hold in ANY host
 * time zone, because the CI runner's zone cannot be forced on Windows. The
 * old implementation (`day + 86_400_000`) violates exactly these properties
 * in DST zones (e.g. America/Los_Angeles 2026-03-08: midnight + 9 real hours
 * = 10:00 local, not 09:00), so the suite pins the contract our replacement
 * must keep everywhere.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addLocalDays,
  endOfLocalDate,
  localDateAtMinutes,
  localDateKey,
  minutesOfLocalDay,
  sameLocalDate,
  startOfLocalDate
} from '../src/shared/calendar';

/** Anchors covering DST boundaries (both hemispheres), leap day, month/year ends. */
const ANCHOR_KEYS = [
  '2026-01-01',
  '2026-02-28',
  '2024-02-29', // leap day
  '2026-03-08', // US spring-forward
  '2026-03-29', // EU spring-forward
  '2026-06-30',
  '2026-10-25', // EU/US fall-back window
  '2026-11-01', // US fall-back
  '2026-12-31'
];

const localMidnight = (key: string): number => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
};

test('startOfLocalDate is local midnight of the same calendar day', () => {
  for (const key of ANCHOR_KEYS) {
    for (const [hour, minute] of [[0, 0], [0, 1], [11, 59], [23, 59]] as const) {
      const anchor = localMidnight(key) + hour * 3_600_000 + minute * 60_000;
      const start = startOfLocalDate(anchor);
      const date = new Date(start);
      const expected = new Date(anchor);
      assert.equal(date.getHours(), 0, `${key} ${hour}:${minute}`);
      assert.equal(date.getMinutes(), 0);
      assert.equal(date.getSeconds(), 0);
      assert.equal(date.getMilliseconds(), 0);
      assert.equal(date.getDate(), expected.getDate());
      assert.equal(date.getMonth(), expected.getMonth());
      assert.equal(date.getFullYear(), expected.getFullYear());
    }
  }
});

test('addLocalDays keeps the wall-clock time on the next calendar day', () => {
  for (const key of ANCHOR_KEYS) {
    const midnight = localMidnight(key);
    for (const minutes of [0, 9 * 60, 23 * 60 + 59]) {
      const anchor = localDateAtMinutes(midnight, minutes);
      const next = addLocalDays(anchor, 1);
      const anchorDate = new Date(anchor);
      const expected = new Date(anchor);
      expected.setDate(expected.getDate() + 1);
      assert.equal(next, expected.getTime(), `${key} +1d @${minutes}`);
      const nextDate = new Date(next);
      assert.equal(nextDate.getHours(), anchorDate.getHours(), `${key} wall-clock hour preserved`);
      assert.equal(nextDate.getMinutes(), anchorDate.getMinutes(), `${key} wall-clock minute preserved`);
      assert.ok(sameLocalDate(next, expected.getTime()));
      assert.ok(!sameLocalDate(anchor, next), 'a day apart is never the same local date');
    }
  }
});

test('addLocalDays walks 400 consecutive days without drifting off the wall clock', () => {
  let cursor = localMidnight(ANCHOR_KEYS[0]);
  const expected = new Date(cursor);
  for (let step = 0; step < 400; step += 1) {
    const date = new Date(cursor);
    assert.equal(date.getHours(), 0, `step ${step}`);
    assert.equal(date.getMinutes(), 0, `step ${step}`);
    cursor = addLocalDays(cursor, 1);
    expected.setDate(expected.getDate() + 1);
    assert.equal(cursor, expected.getTime(), `step ${step} absolute`);
  }
});

test('addLocalDays supports negative offsets (yesterday)', () => {
  for (const key of ANCHOR_KEYS) {
    const midnight = localMidnight(key);
    const previous = addLocalDays(midnight, -1);
    const roundTrip = addLocalDays(previous, 1);
    assert.equal(roundTrip, midnight, key);
    assert.ok(!sameLocalDate(previous, midnight));
  }
});

test('localDateAtMinutes produces the exact wall-clock instant', () => {
  for (const key of ANCHOR_KEYS) {
    const midnight = localMidnight(key);
    for (const [hour, minute] of [[0, 0], [6, 0], [9, 0], [12, 30], [21, 0], [23, 59]] as const) {
      const instant = localDateAtMinutes(midnight, hour * 60 + minute);
      const date = new Date(instant);
      assert.equal(date.getHours(), hour, `${key} ${hour}:${minute}`);
      assert.equal(date.getMinutes(), minute, `${key} ${hour}:${minute}`);
      assert.equal(minutesOfLocalDay(instant), hour * 60 + minute);
      assert.ok(sameLocalDate(instant, midnight));
    }
  }
});

test('minutesOfLocalDay round-trips through localDateAtMinutes', () => {
  const now = Date.now();
  const rebuilt = localDateAtMinutes(startOfLocalDate(now), minutesOfLocalDay(now));
  const original = new Date(now);
  const result = new Date(rebuilt);
  assert.equal(result.getHours(), original.getHours());
  assert.equal(result.getMinutes(), original.getMinutes());
});

test('sameLocalDate distinguishes 23:59 from the following 00:01', () => {
  for (const key of ANCHOR_KEYS) {
    const midnight = localMidnight(key);
    const before = localDateAtMinutes(midnight, 23 * 60 + 59);
    const after = addLocalDays(localDateAtMinutes(midnight, 1), 1);
    assert.ok(!sameLocalDate(before, after), key);
  }
});

test('endOfLocalDate is the last millisecond of the same calendar day', () => {
  for (const key of ANCHOR_KEYS) {
    const midnight = localMidnight(key);
    const end = endOfLocalDate(midnight);
    const date = new Date(end);
    assert.equal(date.getHours(), 23);
    assert.equal(date.getMinutes(), 59);
    assert.equal(date.getSeconds(), 59);
    assert.equal(date.getMilliseconds(), 999);
    assert.ok(sameLocalDate(end, midnight));
    assert.ok(!sameLocalDate(end + 1, midnight), 'the next millisecond belongs to the next day');
  }
});

test('localDateKey renders the local calendar day as YYYY-MM-DD', () => {
  for (const key of ANCHOR_KEYS) {
    assert.equal(localDateKey(localMidnight(key)), key);
    assert.equal(localDateKey(localDateAtMinutes(localMidnight(key), 23 * 60 + 59)), key);
  }
});
