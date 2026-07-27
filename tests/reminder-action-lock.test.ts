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

const makeScheduler = (overrides: Partial<Settings> = {}) => {
  let now = T0;
  const clock = {
    now: (): number => now,
    set: (value: number): void => {
      now = value;
    },
    advance: (ms: number): void => {
      now += ms;
    }
  };
  const scheduler = new ReminderScheduler({ ...baseSettings, ...overrides }, { now: clock.now });
  return { clock, scheduler };
};

test('complete is rejected before unlockAt and accepted after it', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(20 * MINUTE);
  const active = scheduler.tick().activeReminder;
  assert.equal(active?.kind, 'eye');
  assert.equal(active?.mode, 'focused');
  assert.equal(active?.unlockAt, clock.now() + 30_000);
  assert.equal(active?.snoozeAllowedAt, clock.now(), 'first-cycle snooze needs no wait');

  // Immediate complete: refused, reminder stays on screen.
  assert.equal(scheduler.handleAction('complete', active.id).activeReminder?.id, active.id);

  clock.advance(29_000);
  assert.equal(scheduler.handleAction('complete', active.id).activeReminder?.id, active.id);

  clock.advance(1_001);
  assert.equal(scheduler.handleAction('complete', active.id).activeReminder, null);
});

test('skip is always allowed, even while complete is locked', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(20 * MINUTE);
  const active = scheduler.tick().activeReminder;

  assert.equal(scheduler.handleAction('skip', active.id).activeReminder, null);
});

test('snooze locks after the first snooze until unlockAt', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(20 * MINUTE);
  const first = scheduler.tick().activeReminder;

  // First snooze of the cycle: immediate.
  assert.equal(scheduler.handleAction('snooze', first.id).activeReminder, null);

  clock.advance(5 * MINUTE + 1_000);
  const second = scheduler.tick().activeReminder;
  assert.equal(second?.snoozeCount, 1);
  assert.equal(second?.snoozeAllowedAt, second?.unlockAt, 'later snoozes wait out the countdown');

  // Locked while the countdown runs…
  assert.equal(scheduler.handleAction('snooze', second.id).activeReminder?.id, second.id);
  clock.advance(31_000);
  // …and released once it finishes.
  assert.equal(scheduler.handleAction('snooze', second.id).activeReminder, null);
});

test('absorb into combined extends the enforced wait from the reminder start', () => {
  // Walk comes due 90s after the eye reminder fires — inside the alert.
  const { clock, scheduler } = makeScheduler({ walkIntervalMinutes: 21.5 });
  clock.advance(20 * MINUTE);
  const eye = scheduler.tick().activeReminder;
  assert.equal(eye?.kind, 'eye');
  const eyeUnlockAt = eye?.unlockAt; // start + 30s

  // 31s later the eye wait is over, but the walk folds in: combined restarts
  // the enforced wait at start + 60s.
  clock.advance(31_000);
  const combined = scheduler.tick().activeReminder;
  assert.equal(combined?.kind, 'combined');
  assert.equal(combined?.id, eye?.id, 'absorb keeps the same reminder id');
  assert.ok(combined?.unlockAt > eyeUnlockAt, 'unlockAt extended on absorb');
  assert.equal(combined?.unlockAt, combined?.startedAt + 60_000);

  // Completing in the extended window is refused…
  assert.equal(scheduler.handleAction('complete', combined.id).activeReminder?.id, combined.id);
  clock.set(combined.unlockAt + 1);
  // …until the combined wait elapses.
  assert.equal(scheduler.handleAction('complete', combined.id).activeReminder, null);
});

test('actions with a stale reminder id are ignored', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(20 * MINUTE);
  const active = scheduler.tick().activeReminder;
  clock.advance(61_000);

  const status = scheduler.handleAction('complete', 'some-old-id');
  assert.equal(status.activeReminder?.id, active.id, 'wrong id leaves the reminder untouched');
});
