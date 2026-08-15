import assert from 'node:assert/strict';
import test from 'node:test';
import { ReminderScheduler } from '../src/main/reminders';
import type { ReminderEvent, ReminderStatus, Settings, Task } from '../src/shared/types';

const MINUTE = 60_000;
const T0 = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

const baseSettings: Settings = {
  eyeIntervalMinutes: 20,
  walkIntervalMinutes: 60,
  snoozeMinutes: 5,
  naturalBreakMinutes: 5,
  dailyCapacityMinutes: 360,
  workStartMinutes: 7 * 60,
  workEndMinutes: 21 * 60,
  reminderMode: 'focused',
  preAlertSeconds: 0,
  startWithWindows: false,
  petScale: 1,
  petPosition: null,
  petPositionsByLayout: {},
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
  theme: 'system',
  density: 'comfortable',
  alarms: [],
  todos: [],
  activeTaskId: null
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

const makeTask = (id: string, title: string, priority: Task['priority'], context: Task['context'], sortOrder: number, remindOnBreak = false): Task => ({
  id, title, notes: null, status: 'open', priority, projectId: null, parentId: null,
  tags: [], plannedAt: null, dueAt: null, reminderAt: null, recurrence: null,
  context, remindOnBreak, estimateMinutes: null, sortOrder, createdAt: sortOrder + 1,
  updatedAt: sortOrder + 1, completedAt: null, sectionId: null, revision: 1
});

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

test('test reminders are not persisted or recovered as real reminders', () => {
  const clock = makeClock();
  const events: ReminderEvent[] = [];
  const first = new ReminderScheduler(makeSettings(), { now: clock.now });
  const before = first.getStatus();

  assert.ok(first.triggerTest('eye').activeReminder, 'test reminder is active in memory');
  const snapshot = first.serialize();
  assert.equal(snapshot.active, null, 'test reminder is excluded from checkpoints');

  clock.advance(5_000);
  const restored = new ReminderScheduler(makeSettings(), {
    now: clock.now,
    restore: snapshot,
    onEvent: (event) => events.push(event)
  });
  const after = restored.getStatus();
  assert.equal(after.activeReminder, null);
  assert.equal(after.nextEyeAt, before.nextEyeAt);
  assert.equal(after.nextWalkAt, before.nextWalkAt);
  assert.deepEqual(events, []);
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

  clock.set((paused.pausedUntil ?? 0) + 1);
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

test('pausing while already paused extends the hold without inflating the frozen remainder', () => {
  // Regression: a second pause() while paused used to recompute frozen from
  // nextEyeAt/nextWalkAt, which already include the first pause's extension,
  // so the remainder grew with each re-pause instead of staying put.
  const { clock, scheduler } = makeScheduler();
  clock.advance(10 * MINUTE); // eye has 10 min left, walk has 50 min left

  const first = scheduler.pause(30);
  assert.equal(first.pausedUntil, clock.now() + 30 * MINUTE);
  assert.equal(first.nextEyeAt, clock.now() + 40 * MINUTE); // 30 pause + 10 frozen
  assert.equal(first.nextWalkAt, clock.now() + 80 * MINUTE); // 30 pause + 50 frozen

  clock.advance(5 * MINUTE); // 5 min into the pause
  const second = scheduler.pause(30); // extend from now, not from the old end
  assert.equal(second.pausedUntil, clock.now() + 30 * MINUTE);
  // Frozen remainder must still be the original 10 / 50 min, not inflated.
  assert.equal(second.nextEyeAt, clock.now() + 40 * MINUTE); // 30 + 10
  assert.equal(second.nextWalkAt, clock.now() + 80 * MINUTE); // 30 + 50

  // Resume then confirms the frozen time was preserved, not inflated.
  const resumed = scheduler.resume();
  assert.equal(resumed.pausedUntil, null);
  assert.equal(resumed.nextEyeAt, clock.now() + 10 * MINUTE);
  assert.equal(resumed.nextWalkAt, clock.now() + 50 * MINUTE);
});

test('a later pause extends the hold deadline when it would push further out', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(10 * MINUTE);

  const first = scheduler.pause(30); // until now + 30
  clock.advance(20 * MINUTE); // now + 30 total; 10 min left on the pause
  const second = scheduler.pause(60); // extends to now + 60, later than old end
  assert.equal(second.pausedUntil, clock.now() + 60 * MINUTE);
  // Frozen eye remainder is still the original 10 min.
  assert.equal(second.nextEyeAt, clock.now() + 70 * MINUTE);
});

test('triggerTest is suppressed while paused', () => {
  const { scheduler } = makeScheduler();
  scheduler.pause(30);
  const after = scheduler.triggerTest('eye');
  assert.equal(after.activeReminder, null, 'no test reminder during a pause');
  assert.ok(after.pausedUntil, 'pause remains in place');
});

test('triggerNow is suppressed while paused', () => {
  const { scheduler } = makeScheduler();
  scheduler.pause(30);
  const after = scheduler.triggerNow();
  assert.equal(after.activeReminder, null, 'no manual reminder during a pause');
  assert.ok(after.pausedUntil, 'pause remains in place');
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
  const seen: ReminderStatus[] = [];
  scheduler.onChanged((status) => seen.push(status));

  scheduler.triggerTest('walk');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].activeReminder?.kind, 'walk');
});

test('test buttons cannot replace a reminder already in progress', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(20 * MINUTE);
  const real = scheduler.tick().activeReminder;

  const afterTestClick = scheduler.triggerTest('walk');
  assert.equal(afterTestClick.activeReminder?.id, real?.id);
  assert.equal(afterTestClick.activeReminder?.kind, 'eye');
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
  const seen: ReminderStatus[] = [];
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

  scheduler.handleAction('snooze', first!.id);
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
  scheduler.handleAction('snooze', first!.id);
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
  scheduler.handleAction('snooze', real!.id);

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

  scheduler.handleAction('complete', testReminder!.id);
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
  scheduler.handleAction('snooze', first!.id);

  const paused = scheduler.pause(60);
  clock.set(paused.nextEyeAt + 1_000);
  const afterPause = scheduler.tick();
  assert.equal(afterPause.activeReminder?.snoozeCount, 0);
});

test('gentle and guided modes unlock immediately; focused keeps the wait', () => {
  const focused = makeScheduler(makeSettings({ reminderMode: 'focused' }));
  focused.clock.advance(20 * MINUTE);
  const fActive = focused.scheduler.tick().activeReminder;
  assert.equal(fActive?.mode, 'focused');
  assert.equal(fActive?.unlockAt, fActive?.startedAt + 30_000);
  assert.equal(
    focused.scheduler.handleAction('complete', fActive.id).activeReminder?.id,
    fActive?.id,
    'early complete still refused in focused mode'
  );

  for (const reminderMode of ['gentle', 'guided'] as const) {
    const { clock, scheduler } = makeScheduler(makeSettings({ reminderMode }));
    clock.advance(20 * MINUTE);
    const active = scheduler.tick().activeReminder;
    assert.equal(active?.mode, reminderMode);
    assert.equal(active?.unlockAt, active?.startedAt, `${reminderMode} has no enforced wait`);
    assert.equal(
      scheduler.handleAction('complete', active.id).activeReminder,
      null,
      `${reminderMode} complete is immediate`
    );
  }
});

test('absorbing a kind adds no wait outside focused mode, but adds an activity', () => {
  const { clock, scheduler } = makeScheduler(
    makeSettings({ reminderMode: 'guided', walkIntervalMinutes: 22 })
  );
  clock.advance(20 * MINUTE);
  const eye = scheduler.tick().activeReminder;
  assert.equal(eye?.kind, 'eye');
  assert.equal(eye?.activityIds.length, 1);

  clock.advance(1.5 * MINUTE);
  const combined = scheduler.tick().activeReminder;
  assert.equal(combined?.kind, 'combined');
  assert.equal(combined?.unlockAt, combined?.startedAt, 'guided stays unlocked after absorb');
  assert.equal(combined?.activityIds.length, 2, 'one activity per absorbed kind');
  assert.ok(combined?.activityIds.some((id) => id.startsWith('eye')));
  assert.ok(combined?.activityIds.some((id) => id.startsWith('walk')));
});

test('pre-alert appears ahead of the deadline and expires into the reminder', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ preAlertSeconds: 30 }));
  const before = scheduler.tick();
  assert.equal(before.preAlert, null, 'too early for the pre-alert');

  clock.advance(20 * MINUTE - 30_000);
  const pre = scheduler.tick();
  assert.equal(pre.preAlert?.kind, 'eye');
  assert.equal(pre.preAlert?.firesAt, T0 + 20 * MINUTE);
  assert.equal(pre.activeReminder, null);

  clock.advance(30_000 + 1);
  const fired = scheduler.tick();
  assert.equal(fired.preAlert, null);
  assert.equal(fired.activeReminder?.kind, 'eye');
});

test('pre-alert start opens a real reminder right away', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ preAlertSeconds: 30 }));
  clock.advance(20 * MINUTE - 30_000);
  scheduler.tick();

  const started = scheduler.handlePreAlertAction('start');
  assert.equal(started.preAlert, null);
  assert.equal(started.activeReminder?.kind, 'eye');

  // A real (non-test) reminder: completing reschedules the cycle.
  clock.advance(31_000);
  const done = scheduler.handleAction('complete', started.activeReminder.id);
  assert.equal(done.nextEyeAt, clock.now() + 20 * MINUTE);
});

test('pre-alert snooze defers only that kind by two minutes', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ preAlertSeconds: 30 }));
  clock.advance(20 * MINUTE - 30_000);
  scheduler.tick();

  const snoozed = scheduler.handlePreAlertAction('snooze');
  assert.equal(snoozed.preAlert, null);
  assert.equal(snoozed.nextEyeAt, clock.now() + 2 * MINUTE);
  assert.equal(snoozed.nextWalkAt, T0 + 60 * MINUTE, 'walk deadline untouched');
});

test('pre-alert dismissed does not reappear for the same deadline', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ preAlertSeconds: 30 }));
  clock.advance(20 * MINUTE - 30_000);
  scheduler.tick();

  const dismissed = scheduler.handlePreAlertAction('dismiss');
  assert.equal(dismissed.preAlert, null);

  clock.advance(10_000);
  assert.equal(scheduler.tick().preAlert, null, 'no repeat within the same cycle');

  clock.advance(20_000 + 1);
  assert.equal(scheduler.tick().activeReminder?.kind, 'eye', 'reminder still fires on schedule');
});

test('pre-alerts stay off when preAlertSeconds is 0', () => {
  const { clock, scheduler } = makeScheduler(); // preAlertSeconds: 0
  clock.advance(20 * MINUTE - 30_000);
  const status = scheduler.tick();
  assert.equal(status.preAlert, null);
  assert.equal(status.activeReminder, null);
});

test('pause clears a pending pre-alert', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ preAlertSeconds: 30 }));
  clock.advance(20 * MINUTE - 30_000);
  scheduler.tick();

  const paused = scheduler.pause(60);
  assert.equal(paused.preAlert, null);
});

test('settings changes drop a pending pre-alert and re-arm the new lead time', () => {
  const { clock, scheduler } = makeScheduler(makeSettings({ preAlertSeconds: 30 }));
  clock.advance(20 * MINUTE - 20_000);
  scheduler.tick();
  assert.ok(scheduler.getStatus().preAlert, 'pre-alert is showing before the deadline');

  const before = scheduler.getStatus();
  const next = scheduler.updateSettings(makeSettings({ preAlertSeconds: 60 }), makeSettings({ preAlertSeconds: 30 }));
  assert.equal(next.preAlert, null, 'a stale pre-alert is dropped on settings change');

  // The same deadline becomes eligible again under the longer lead time: the
  // per-deadline marker must not suppress it (regression for the marker
  // surviving updateSettings).
  clock.advance(10_000);
  scheduler.tick();
  assert.ok(scheduler.getStatus().preAlert, 'pre-alert re-appears under the new lead time');
});

test('wall-clock drift shifts deadlines and ignores zero/non-finite deltas', () => {
  const { clock, scheduler } = makeScheduler();
  // Private on purpose; the test invokes it with an explicit receiver so the
  // `this` binding survives (drift events arrive via the kernel wiring).
  const drift = (delta: number): void =>
    (scheduler as unknown as { handleWallClockDrift: (value: number) => void }).handleWallClockDrift.call(scheduler, delta);

  const before = scheduler.getStatus();
  drift(5 * MINUTE);
  const after = scheduler.getStatus();
  assert.equal(after.nextEyeAt, before.nextEyeAt + 5 * MINUTE);
  assert.equal(after.nextWalkAt, before.nextWalkAt + 5 * MINUTE);

  scheduler.pause(30);
  const paused = scheduler.getStatus();
  drift(10 * MINUTE);
  const shifted = scheduler.getStatus();
  assert.equal(shifted.pausedUntil, (paused.pausedUntil ?? 0) + 10 * MINUTE);
  assert.equal(shifted.nextEyeAt, (paused.nextEyeAt ?? 0) + 10 * MINUTE);

  drift(0);
  assert.equal(scheduler.getStatus().pausedUntil, shifted.pausedUntil);
  drift(Number.NaN);
  assert.equal(scheduler.getStatus().pausedUntil, shifted.pausedUntil);
});

test('activities are picked per kind and avoid immediate repeats', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(20 * MINUTE);
  const first = scheduler.tick().activeReminder;
  assert.equal(first?.activityIds.length, 1);
  assert.ok(first?.activityIds[0].startsWith('eye'));

  scheduler.handleAction('skip', first.id);
  clock.advance(20 * MINUTE + 1_000);
  const second = scheduler.tick().activeReminder;
  assert.notEqual(second?.activityIds[0], first?.activityIds[0], 'no back-to-back repeat');
});

test('walk reminders snapshot the highest-priority pending away task', () => {
  const { scheduler } = makeScheduler();
  scheduler.updateTasks([
    makeTask('desk', '继续写代码', 'urgent', 'desk', 0),
    makeTask('water', '接一杯水', 'normal', 'away', 1, true),
    makeTask('parcel', '拿快递', 'important', 'away', 2, true)
  ]);

  assert.equal(scheduler.triggerTest('eye').activeReminder?.breakTask, null);
  scheduler.handleAction('skip', scheduler.getStatus().activeReminder?.id ?? '');

  const active = scheduler.triggerTest('walk').activeReminder;
  assert.deepEqual(active?.breakTask, { id: 'parcel', title: '拿快递' });

  if (active?.breakTask) {
    active.breakTask.title = 'mutated outside';
  }
  assert.equal(
    scheduler.getStatus().activeReminder?.breakTask?.title,
    '拿快递',
    'status snapshots cannot mutate scheduler state'
  );
});

test('away context alone does not opt a task into walk suggestions', () => {
  const { scheduler } = makeScheduler();
  scheduler.updateTasks([makeTask('private', '外出办理私事', 'urgent', 'away', 0)]);
  assert.equal(scheduler.triggerTest('walk').activeReminder?.breakTask, null);
});

test('task updates affect the next walk reminder without moving deadlines', () => {
  const { scheduler } = makeScheduler();
  const before = scheduler.getStatus();
  scheduler.updateTasks([makeTask('water', '接水', 'normal', 'away', 0, true)]);

  const afterUpdate = scheduler.getStatus();
  assert.equal(afterUpdate.nextEyeAt, before.nextEyeAt);
  assert.equal(afterUpdate.nextWalkAt, before.nextWalkAt);
  assert.deepEqual(scheduler.triggerTest('walk').activeReminder?.breakTask, {
    id: 'water',
    title: '接水'
  });
});

test('real actions emit one history event with schedule context; tests emit none', () => {
  const clock = makeClock();
  const events: ReminderEvent[] = [];
  const scheduler = new ReminderScheduler(makeSettings(), {
    now: clock.now,
    onEvent: (entry) => events.push(entry)
  });

  scheduler.triggerTest('eye');
  clock.advance(31_000);
  scheduler.handleAction('complete', scheduler.getStatus().activeReminder?.id ?? '');
  assert.equal(events.length, 0, 'test reminders are excluded from personal history');

  clock.set(T0 + 20 * MINUTE);
  const real = scheduler.tick().activeReminder;
  clock.advance(31_000);
  scheduler.handleAction('complete', real!.id);

  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'complete');
  assert.equal(events[0].kind, 'eye');
  assert.equal(events[0].scheduledAt, T0 + 20 * MINUTE);
  assert.equal(events[0].shownAt, T0 + 20 * MINUTE);
});

test('a long system absence records one natural break event', () => {
  const clock = makeClock();
  const events: ReminderEvent[] = [];
  const scheduler = new ReminderScheduler(makeSettings(), {
    now: clock.now,
    onEvent: (entry) => events.push(entry)
  });

  scheduler.handleSystemResume(20 * 60);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'natural-break');
  assert.equal(events[0].kind, 'eye');
});

test('ten minutes away restarts both cycles as a natural break', () => {
  const { clock, scheduler } = makeScheduler();
  clock.advance(5 * MINUTE);
  const status = scheduler.handleSystemResume(10 * 60);
  assert.equal(status.nextEyeAt, clock.now() + 20 * MINUTE);
  assert.equal(status.nextWalkAt, clock.now() + 60 * MINUTE);
});

test('effective adaptive intervals stay fixed until the next explicit cycle', () => {
  const clock = makeClock();
  const adaptive = makeSettings({ adaptiveEnabled: true });
  const scheduler = new ReminderScheduler(adaptive, {
    now: clock.now,
    getEffectiveIntervals: (current) =>
      current.adaptiveEnabled
        ? { eyeMinutes: 24, walkMinutes: 72 }
        : {
            eyeMinutes: current.eyeIntervalMinutes,
            walkMinutes: current.walkIntervalMinutes
          },
    getEffectiveMode: (current) => (current.adaptiveEnabled ? 'gentle' : current.reminderMode)
  });

  assert.equal(scheduler.getStatus().nextEyeAt, T0 + 24 * MINUTE);
  assert.equal(scheduler.getStatus().nextWalkAt, T0 + 72 * MINUTE);
  assert.equal(scheduler.triggerNow().activeReminder?.mode, 'gentle');
  scheduler.handleAction('skip', scheduler.getStatus().activeReminder?.id ?? '');

  const restored = makeSettings({ adaptiveEnabled: false });
  const status = scheduler.updateSettings(restored, adaptive);
  assert.equal(status.nextEyeAt, T0 + 24 * MINUTE);
  assert.equal(status.nextWalkAt, T0 + 72 * MINUTE);
  const restarted = scheduler.restartCycle();
  assert.equal(restarted.nextEyeAt, T0 + 20 * MINUTE);
  assert.equal(restarted.nextWalkAt, T0 + 60 * MINUTE);
});

test('scene-aware gate defers at most three times, explains each delay, then shows', async () => {
  const clock = makeClock();
  let checks = 0;
  const scheduler = new ReminderScheduler(makeSettings(), {
    now: clock.now,
    beforeReminder: async () => {
      checks += 1;
      return {
        action: 'defer',
        deferMinutes: 5,
        reason: 'powerpnt 正在全屏显示',
        foregroundApp: 'powerpnt'
      };
    }
  });
  const flush = async (): Promise<void> => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  clock.advance(20 * MINUTE);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(scheduler.tick().activeReminder, null, 'async check does not flash a reminder first');
    await flush();
    const status = scheduler.getStatus();
    assert.equal(status.activeReminder, null);
    assert.equal(status.contextDeferral?.consecutiveCount, attempt);
    assert.equal(status.contextDeferral?.foregroundApp, 'powerpnt');
    assert.equal(status.nextEyeAt, clock.now() + 5 * MINUTE);
    clock.advance(5 * MINUTE);
  }

  scheduler.tick();
  await flush();
  const shown = scheduler.getStatus();
  assert.equal(checks, 4);
  assert.equal(shown.contextDeferral, null);
  assert.equal(shown.activeReminder?.kind, 'eye');
});

