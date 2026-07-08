import assert from 'node:assert/strict';
import test from 'node:test';
import { ReminderScheduler } from '../src/main/reminders';
import type { Settings } from '../src/shared/types';

const settings: Settings = {
  eyeIntervalMinutes: 20,
  walkIntervalMinutes: 60,
  snoozeMinutes: 5,
  startWithWindows: false,
  petScale: 1,
  petPosition: null
};

test('test reminders do not reset real schedules when completed', () => {
  const scheduler = new ReminderScheduler(settings);
  const before = scheduler.getStatus();
  const active = scheduler.triggerTest('eye').activeReminder;

  assert.equal(active?.kind, 'eye');

  const after = scheduler.handleAction('complete', active.id);
  assert.equal(after.activeReminder, null);
  assert.equal(after.nextEyeAt, before.nextEyeAt);
  assert.equal(after.nextWalkAt, before.nextWalkAt);
});

test('pause clears active reminder and moves both schedules after pause window', () => {
  const scheduler = new ReminderScheduler(settings);
  scheduler.triggerTest('walk');
  const now = Date.now();
  const status = scheduler.pause(60);

  assert.equal(status.activeReminder, null);
  assert.ok(status.pausedUntil !== null);
  assert.ok(status.pausedUntil >= now + 59.9 * 60_000);
  assert.ok(status.nextEyeAt >= now + 79.9 * 60_000);
  assert.ok(status.nextWalkAt >= now + 119.9 * 60_000);
});

test('scheduler emits changed status for test reminder', () => {
  const scheduler = new ReminderScheduler(settings);
  const seen = [];
  scheduler.onChanged((status) => seen.push(status));

  scheduler.triggerTest('walk');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].activeReminder?.kind, 'walk');
});
