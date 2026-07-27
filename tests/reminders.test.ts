import assert from 'node:assert/strict';
import test from 'node:test';
import { ReminderScheduler } from '../src/main/reminders';
import type { Settings } from '../src/shared/types';

const MINUTE = 60_000;
const T0 = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

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

/** Deterministic clock so lock timestamps and deadlines are exact. */
const makeClock = () => {
  let now = T0;
  return {
    now: (): number => now,
    set: (value: number): void => {
      now = value;
    },
    advance: (ms: number): void => {
      now += ms;
    }
  };
};

const makeScheduler = (settings: Settings = makeSettings()) => {
  const clock = makeClock();
  const scheduler = new ReminderScheduler(settings, { now: clock.now });
  return { clock, scheduler };
};

test('test reminders do not reset real schedules when completed', () => {
  const { clock, scheduler } = makeScheduler();
  const before = scheduler.getStatus();
  const active = scheduler.triggerTest('eye').activeReminder;

  assert.equal(active?.kind, 'eye');

  clock.advance(31_000); // wait out the complete lock
  const after = scheduler.handleAction('complete', active.id);
  assert.equal(after.activeReminder, null);
  assert.equal(after.nextEyeAt, before.nextEyeAt);
  assert.equal(after.nextWalkAt, before.nextWalkAt);
});

test('pause freezes remaining time and resume continues from it', () => {
  const { clock, scheduler } = makeScheduler();
  scheduler.triggerTest('walk');
  clock.advance(10 * MINUTE); // half the eye cycle, 1/6 of the walk cycle used

  const paused = scheduler.pause(60);
  assert.equal(paused.activeReminder, null, 'pause clears an active reminder');
  assert.equal(paused.pausedUntil, clock.now() + 60 * MINUTE);
  // Remaining 10 min of eye and 50 min of wait sit AFTER the pause window.
  assert.equal(paused.nextEyeAt, clock.now() + 70 * MINUTE);
  assert.equal(paused.nextWalkAt, clock.now() + 110 * MINUTE);

  // Coming back early continues the frozen countdowns instead of adding a
  // full interval on top of the pause (the old, unintuitive behavior).
  const resumed = scheduler.resume();
  assert.equal(resumed.pausedUntil, null);
  assert.equal(resumed.nextEyeAt, clock.now() + 10 * MINUTE);
  assert.equal(resumed.nextWalkAt, clock.now() + 50 * MINUTE);
});

test('pause expiring on its own continues the frozen countdowns', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(10 * MINUTE);
  const paused = scheduler.pause(5); // until T0+15min, eye frozen at 10min

  clock.set(paused.pausedUntil + 1);
  const status = scheduler.tick();
  assert.equal(status.pausedUntil, null);
  assert.equal(status.activeReminder, null, 'eye is not due until pause-end + frozen remainder');
  assert.equal(status.nextEyeAt, T0 + 25 * MINUTE);

  clock.set(status.nextEyeAt + 1);
  assert.equal(scheduler.tick().activeReminder?.kind, 'eye');
});

test('resume is a no-op when not paused', () => {
  const { scheduler } = makeScheduler();
  const before = scheduler.getStatus();
  const after = scheduler.resume();
  assert.deepEqual(after, before);
});

test('restartCycle clears pause and starts both cycles fresh', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(10 * MINUTE);
  scheduler.pause(60);

  const restarted = scheduler.restartCycle();
  assert.equal(restarted.pausedUntil, null);
  assert.equal(restarted.nextEyeAt, clock.now() + 20 * MINUTE);
  assert.equal(restarted.nextWalkAt, clock.now() + 60 * MINUTE);
});

test('scheduler emits changed status for test reminder', () => {
  const { scheduler } = makeScheduler();
  const seen = [];
  scheduler.onChanged((status) => seen.push(status));

  scheduler.triggerTest('walk');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].activeReminder?.kind, 'walk');
});

test('eye and walk due together fire as one combined reminder', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ walkIntervalMinutes: 20 }));

  clock.advance(20 * MINUTE);
  const status = scheduler.tick();

  assert.equal(status.activeReminder?.kind, 'combined');
  assert.deepEqual(status.activeReminder?.kinds, ['eye', 'walk']);
});

test('reminder becoming due while another is showing is absorbed into it', () => {
  // Walk is 2 minutes behind eye: outside the 60s combine window at fire
  // time, but it piles up while the eye reminder is on screen.
  const { clock, scheduler } = makeScheduler(makeSettings({ walkIntervalMinutes: 22 }));
  const seen = [];
  scheduler.onChanged((status) => seen.push(status));

  clock.advance(20 * MINUTE);
  const eyeStatus = scheduler.tick();
  assert.equal(eyeStatus.activeReminder?.kind, 'eye');

  clock.advance(1.5 * MINUTE);
  const absorbed = scheduler.tick();
  assert.equal(absorbed.activeReminder?.kind, 'combined');
  assert.deepEqual(absorbed.activeReminder?.kinds, ['eye', 'walk']);
  assert.ok(seen.some((status) => status.activeReminder?.kind === 'combined'));

  // Unlock extended to start+60s; at +21.5min that wait has passed.
  const done = scheduler.handleAction('complete', absorbed.activeReminder.id);
  assert.equal(done.activeReminder, null);
  assert.equal(done.nextEyeAt, clock.now() + 20 * MINUTE);
  assert.equal(done.nextWalkAt, clock.now() + 22 * MINUTE);

  // The absorbed walk must not re-fire as a second reminder right away.
  clock.advance(1_000);
  assert.equal(scheduler.tick().activeReminder, null);
});

test('actions on a combined reminder reschedule both kinds', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ walkIntervalMinutes: 20 }));

  clock.advance(20 * MINUTE);
  const combined = scheduler.tick().activeReminder;
  assert.equal(combined?.kind, 'combined');

  // First snooze of the cycle is immediate.
  const snoozed = scheduler.handleAction('snooze', combined.id);
  assert.equal(snoozed.activeReminder, null);
  assert.equal(snoozed.nextEyeAt, clock.now() + 5 * MINUTE);
  assert.equal(snoozed.nextWalkAt, clock.now() + 5 * MINUTE);

  // Both snoozed kinds fire together again, not one after the other.
  clock.advance(5 * MINUTE + 1_000);
  assert.equal(scheduler.tick().activeReminder?.kind, 'combined');
});

test('snooze count grows per snooze and resets on complete', () => {
  const { clock, scheduler } = makeScheduler();

  clock.advance(20 * MINUTE);
  const first = scheduler.tick().activeReminder;
  assert.equal(first?.snoozeCount, 0);

  scheduler.handleAction('snooze', first.id);
  clock.advance(5 * MINUTE + 1_000);
  const second = scheduler.tick().activeReminder;
  assert.equal(second?.snoozeCount, 1);

  clock.advance(31_000); // wait out the complete lock
  scheduler.handleAction('complete', second.id);
  clock.advance(20 * MINUTE + 1_000);
  const third = scheduler.tick().activeReminder;
  assert.equal(third?.snoozeCount, 0);
});

test('skip resets the snooze count', () => {
  const { clock, scheduler } = makeScheduler();

  clock.advance(20 * MINUTE);
  const first = scheduler.tick().activeReminder;
  scheduler.handleAction('snooze', first.id);
  clock.advance(5 * MINUTE + 1_000);
  const second = scheduler.tick().activeReminder;
  assert.equal(second?.snoozeCount, 1);

  // Skip has no wait, even mid-countdown.
  scheduler.handleAction('skip', second.id);
  clock.advance(20 * MINUTE + 1_000);
  const third = scheduler.tick().activeReminder;
  assert.equal(third?.snoozeCount, 0);
});

test('test reminders neither report nor touch the snooze cycle', () => {
  const { clock, scheduler } = makeScheduler();

  clock.advance(20 * MINUTE);
  const real = scheduler.tick().activeReminder;
  scheduler.handleAction('snooze', real.id);

  const testReminder = scheduler.triggerTest('eye').activeReminder;
  assert.equal(testReminder?.snoozeCount, 0);
  scheduler.handleAction('snooze', testReminder.id);

  clock.advance(5 * MINUTE + 1_000);
  const refire = scheduler.tick().activeReminder;
  assert.equal(refire?.snoozeCount, 1);
});

test('due kinds are not absorbed into a running test reminder', () => {
  const { clock, scheduler } = makeScheduler();

  const testReminder = scheduler.triggerTest('eye').activeReminder;
  clock.advance(59 * MINUTE);
  const duringTest = scheduler.tick();
  assert.equal(duringTest.activeReminder?.kind, 'eye');

  scheduler.handleAction('complete', testReminder.id);
  clock.advance(1 * MINUTE);
  const afterTest = scheduler.tick();
  assert.equal(afterTest.activeReminder?.kind, 'combined');
});

test('triggerNow starts a real (non-test) reminder and never stacks', () => {
  const { clock, scheduler } = makeScheduler();
  const first = scheduler.triggerNow();
  assert.equal(first.activeReminder?.kind, 'eye', 'eye deadline is nearer than walk');

  const stacked = scheduler.triggerNow();
  assert.equal(stacked.activeReminder?.id, first.activeReminder?.id, 'no second reminder while one is up');

  clock.advance(31_000);
  const done = scheduler.handleAction('complete', first.activeReminder.id);
  assert.equal(done.nextEyeAt, clock.now() + 20 * MINUTE, 'real reminder reschedules the cycle');
});

test('pause resets the snooze count', () => {
  const { clock, scheduler } = makeScheduler();

  clock.advance(20 * MINUTE);
  const first = scheduler.tick().activeReminder;
  scheduler.handleAction('snooze', first.id);

  const paused = scheduler.pause(60);
  clock.set(paused.nextEyeAt + 1_000);
  const afterPause = scheduler.tick();
  assert.equal(afterPause.activeReminder?.snoozeCount, 0);
});
