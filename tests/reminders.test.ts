import assert from 'node:assert/strict';
import test from 'node:test';
import { ReminderScheduler } from '../src/main/reminders';
import type { Settings } from '../src/shared/types';

const MINUTE = 60_000;

const baseSettings: Settings = {
  eyeIntervalMinutes: 20,
  walkIntervalMinutes: 60,
  snoozeMinutes: 5,
  startWithWindows: false,
  petScale: 1,
  petPosition: null,
  petSkin: 'stable',
  dimDesktop: true,
  alarms: [],
  todos: []
};

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  ...baseSettings,
  ...overrides
});

test('test reminders do not reset real schedules when completed', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  const before = scheduler.getStatus();
  const active = scheduler.triggerTest('eye').activeReminder;

  assert.equal(active?.kind, 'eye');

  const after = scheduler.handleAction('complete', active.id);
  assert.equal(after.activeReminder, null);
  assert.equal(after.nextEyeAt, before.nextEyeAt);
  assert.equal(after.nextWalkAt, before.nextWalkAt);
});

test('pause clears active reminder and moves both schedules after pause window', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  scheduler.triggerTest('walk');
  const now = Date.now();
  const status = scheduler.pause(60);

  assert.equal(status.activeReminder, null);
  assert.ok(status.pausedUntil !== null);
  assert.ok(status.pausedUntil >= now + 59.9 * MINUTE);
  assert.ok(status.nextEyeAt >= now + 79.9 * MINUTE);
  assert.ok(status.nextWalkAt >= now + 119.9 * MINUTE);
});

test('scheduler emits changed status for test reminder', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  const seen = [];
  scheduler.onChanged((status) => seen.push(status));

  scheduler.triggerTest('walk');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].activeReminder?.kind, 'walk');
});

test('eye and walk due together fire as one combined reminder', () => {
  const scheduler = new ReminderScheduler(makeSettings({ walkIntervalMinutes: 20 }));
  const t0 = Date.now();

  const status = scheduler.tick(t0 + 20 * MINUTE);

  assert.equal(status.activeReminder?.kind, 'combined');
  assert.deepEqual(status.activeReminder?.kinds, ['eye', 'walk']);
});

test('reminder becoming due while another is showing is absorbed into it', () => {
  // Walk is 2 minutes behind eye: outside the 60s combine window at fire
  // time, but it piles up while the eye reminder is on screen.
  const scheduler = new ReminderScheduler(makeSettings({ walkIntervalMinutes: 22 }));
  const t0 = Date.now();
  const seen = [];
  scheduler.onChanged((status) => seen.push(status));

  const eyeStatus = scheduler.tick(t0 + 20 * MINUTE);
  assert.equal(eyeStatus.activeReminder?.kind, 'eye');

  const absorbed = scheduler.tick(t0 + 21.5 * MINUTE);
  assert.equal(absorbed.activeReminder?.kind, 'combined');
  assert.deepEqual(absorbed.activeReminder?.kinds, ['eye', 'walk']);
  assert.ok(seen.some((status) => status.activeReminder?.kind === 'combined'));

  const done = scheduler.handleAction('complete', absorbed.activeReminder.id);
  const now = Date.now();
  assert.equal(done.activeReminder, null);
  assert.ok(done.nextEyeAt >= now + 19.9 * MINUTE);
  assert.ok(done.nextWalkAt >= now + 21.9 * MINUTE);

  // The absorbed walk must not re-fire as a second reminder right away.
  const after = scheduler.tick(now + 1_000);
  assert.equal(after.activeReminder, null);
});

test('actions on a combined reminder reschedule both kinds', () => {
  const scheduler = new ReminderScheduler(makeSettings({ walkIntervalMinutes: 20 }));
  const t0 = Date.now();

  const combined = scheduler.tick(t0 + 20 * MINUTE).activeReminder;
  assert.equal(combined?.kind, 'combined');

  const snoozed = scheduler.handleAction('snooze', combined.id);
  const now = Date.now();
  assert.equal(snoozed.activeReminder, null);
  assert.ok(snoozed.nextEyeAt <= now + 5.1 * MINUTE);
  assert.ok(snoozed.nextWalkAt <= now + 5.1 * MINUTE);
  assert.ok(snoozed.nextEyeAt >= now + 4.9 * MINUTE);
  assert.ok(snoozed.nextWalkAt >= now + 4.9 * MINUTE);

  // Both snoozed kinds fire together again, not one after the other.
  const refire = scheduler.tick(now + 5 * MINUTE + 1_000);
  assert.equal(refire.activeReminder?.kind, 'combined');
});

test('snooze count grows per snooze and resets on complete', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  const t0 = Date.now();

  const first = scheduler.tick(t0 + 20 * MINUTE).activeReminder;
  assert.equal(first?.snoozeCount, 0);

  scheduler.handleAction('snooze', first.id);
  const second = scheduler.tick(Date.now() + 5 * MINUTE + 1_000).activeReminder;
  assert.equal(second?.snoozeCount, 1);

  scheduler.handleAction('complete', second.id);
  const third = scheduler.tick(Date.now() + 20 * MINUTE + 1_000).activeReminder;
  assert.equal(third?.snoozeCount, 0);
});

test('skip resets the snooze count', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  const t0 = Date.now();

  const first = scheduler.tick(t0 + 20 * MINUTE).activeReminder;
  scheduler.handleAction('snooze', first.id);
  const second = scheduler.tick(Date.now() + 5 * MINUTE + 1_000).activeReminder;
  assert.equal(second?.snoozeCount, 1);

  scheduler.handleAction('skip', second.id);
  const third = scheduler.tick(Date.now() + 20 * MINUTE + 1_000).activeReminder;
  assert.equal(third?.snoozeCount, 0);
});

test('test reminders neither report nor touch the snooze cycle', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  const t0 = Date.now();

  const real = scheduler.tick(t0 + 20 * MINUTE).activeReminder;
  scheduler.handleAction('snooze', real.id);

  const testReminder = scheduler.triggerTest('eye').activeReminder;
  assert.equal(testReminder?.snoozeCount, 0);
  scheduler.handleAction('snooze', testReminder.id);

  const refire = scheduler.tick(Date.now() + 5 * MINUTE + 1_000).activeReminder;
  assert.equal(refire?.snoozeCount, 1);
});

test('due kinds are not absorbed into a running test reminder', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  const t0 = Date.now();

  const testReminder = scheduler.triggerTest('eye').activeReminder;
  const duringTest = scheduler.tick(t0 + 59 * MINUTE);
  assert.equal(duringTest.activeReminder?.kind, 'eye');

  scheduler.handleAction('complete', testReminder.id);
  const afterTest = scheduler.tick(t0 + 60 * MINUTE);
  assert.equal(afterTest.activeReminder?.kind, 'combined');
});

test('pause resets the snooze count', () => {
  const scheduler = new ReminderScheduler(makeSettings());
  const t0 = Date.now();

  const first = scheduler.tick(t0 + 20 * MINUTE).activeReminder;
  scheduler.handleAction('snooze', first.id);

  const paused = scheduler.pause(60);
  const afterPause = scheduler.tick(paused.nextEyeAt + 1_000);
  assert.equal(afterPause.activeReminder?.snoozeCount, 0);
});
