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
  reminderMode: 'focused',
  preAlertSeconds: 0,
  startWithWindows: false,
  petScale: 1,
  petPosition: null,
  petPositionsByLayout: {},
  petSkin: 'stable',
  dimDesktop: true,
  historyEnabled: true,
  historyRetentionDays: 30,
  adaptiveEnabled: false,
  quietHoursEnabled: false,
  quietHoursStartMinutes: 22 * 60,
  quietHoursEndMinutes: 8 * 60,
  foregroundDetectionEnabled: false,
  quietAppWhitelist: [],
  hotkeysEnabled: true,
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

test('resume after a long absence counts as a natural break', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(45 * MINUTE); // both reminders are long overdue

  const status = scheduler.handleSystemResume(46 * 60); // idle 46 min > 20 min cycle

  assert.equal(status.activeReminder, null);
  assert.equal(status.nextEyeAt, clock.now() + 20 * MINUTE, 'fresh eye cycle from wake time');
  assert.equal(status.nextWalkAt, clock.now() + 60 * MINUTE, 'fresh walk cycle from wake time');
});

test('resume with short idle keeps overdue deadlines but grants a quiet window', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(25 * MINUTE); // eye 5 min overdue

  scheduler.handleSystemResume(90); // idle 90s < 20 min

  // Without the grace period this tick would fire the overdue eye reminder.
  assert.equal(scheduler.tick().activeReminder, null, 'grace period suppresses instant popup');

  clock.advance(61_000); // grace (60s) over
  assert.equal(scheduler.tick().activeReminder?.kind, 'eye');
});

test('unlocking the screen grants a quiet window before forcing a reminder', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(25 * MINUTE); // overdue

  scheduler.handleScreenUnlock();
  assert.equal(scheduler.tick().activeReminder, null);

  clock.advance(61_000);
  assert.equal(scheduler.tick().activeReminder?.kind, 'eye');
});

test('resume while paused leaves the pause untouched', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(10 * MINUTE);
  const paused = scheduler.pause(60);

  const status = scheduler.handleSystemResume(24 * 60 * 60); // a whole day idle

  assert.equal(status.pausedUntil, paused.pausedUntil, 'explicit pause survives sleep');
  assert.equal(status.nextEyeAt, paused.nextEyeAt);
  assert.equal(status.nextWalkAt, paused.nextWalkAt);
});

test('suspend persists state via the onPersist hook', () => {
  let now = T0;
  const saves: unknown[] = [];
  const scheduler = new ReminderScheduler(baseSettings, {
    now: () => now,
    onPersist: (snapshot) => saves.push(snapshot)
  });

  scheduler.start();
  scheduler.suspend();

  assert.equal(saves.length, 1, 'suspend triggers exactly one persist');
  scheduler.stop();
});
