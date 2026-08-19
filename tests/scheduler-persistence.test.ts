import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ReminderScheduler, type ReminderSnapshot } from '../src/main/reminders';
import { RuntimeStateStore, sanitizeSnapshot } from '../src/main/runtimeState';
import type { Settings } from '../src/shared/types';

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
  todoBubbleEnabled: true,
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

const withTempDir = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-rs-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a paused state survives a simulated restart and resumes frozen time', () => {
  withTempDir((dir) => {
    let now = T0;
    const clock = () => now;
    const store = new RuntimeStateStore(dir);

    const first = new ReminderScheduler(baseSettings, {
      now: clock,
      onPersist: (snapshot) => store.save(snapshot, clock)
    });
    now = T0 + 10 * MINUTE;
    first.pause(30); // paused until T0+40, eye frozen at 10min, walk at 50min

    // Restart five minutes later, mid-pause.
    now = T0 + 15 * MINUTE;
    const restored = new RuntimeStateStore(dir).load(clock);
    const second = new ReminderScheduler(baseSettings, { now: clock, restore: restored });

    const status = second.getStatus();
    assert.equal(status.pausedUntil, T0 + 40 * MINUTE);
    assert.equal(status.nextEyeAt, T0 + 50 * MINUTE);
    assert.equal(status.nextWalkAt, T0 + 90 * MINUTE);

    // Returning early continues the frozen countdowns from the resume time.
    const resumed = second.resume();
    assert.equal(resumed.pausedUntil, null);
    assert.equal(resumed.nextEyeAt, now + 10 * MINUTE);
    assert.equal(resumed.nextWalkAt, now + 50 * MINUTE);
  });
});

test('a pause that expired while the app was away is cleared on restore', () => {
  withTempDir((dir) => {
    let now = T0;
    const clock = () => now;
    const store = new RuntimeStateStore(dir);

    const first = new ReminderScheduler(baseSettings, {
      now: clock,
      onPersist: (snapshot) => store.save(snapshot, clock)
    });
    first.pause(5); // paused until T0+5, eye deadline stored at T0+25

    // Restart after the pause ended; the stored deadline still lies ahead.
    now = T0 + 10 * MINUTE;
    const second = new ReminderScheduler(baseSettings, {
      now: clock,
      restore: new RuntimeStateStore(dir).load(clock)
    });
    const status = second.getStatus();
    assert.equal(status.pausedUntil, null);
    assert.equal(status.nextEyeAt, T0 + 25 * MINUTE);

    now = T0 + 25 * MINUTE + 1;
    assert.equal(second.tick().activeReminder?.kind, 'eye', 'single reconcile, no backlog');
  });
});

test('crash downtime after the latest checkpoint does not consume active-use deadlines', () => {
  withTempDir((dir) => {
    let now = T0;
    const clock = () => now;
    const store = new RuntimeStateStore(dir);

    const first = new ReminderScheduler(baseSettings, {
      now: clock,
      onPersist: (snapshot) => store.save(snapshot, clock)
    });
    // Leave immediately; both deadlines go stale while away.
    first.stop();
    store.save(first.serialize(), clock);

    now = T0 + 8 * 60 * MINUTE; // hours later
    const second = new ReminderScheduler(baseSettings, {
      now: clock,
      restore: new RuntimeStateStore(dir).load(clock)
    });
    const status = second.tick();
    assert.equal(status.activeReminder, null, 'offline crash gap is not counted as active screen use');
    assert.equal(status.nextEyeAt, T0 + 8 * 60 * MINUTE + 20 * MINUTE);
    assert.equal(status.nextWalkAt, T0 + 8 * 60 * MINUTE + 60 * MINUTE);
  });
});

test('persistence happens on transitions, not per tick', () => {
  let now = T0;
  const clock = () => now;
  const saves: ReminderSnapshot[] = [];
  const scheduler = new ReminderScheduler(baseSettings, {
    now: clock,
    onPersist: (snapshot) => saves.push(snapshot)
  });

  assert.equal(saves.length, 0, 'construction does not persist');

  scheduler.tick();
  scheduler.tick();
  assert.equal(saves.length, 0, 'ticks do not persist');

  now = T0 + 20 * MINUTE;
  const active = scheduler.tick().activeReminder;
  scheduler.handleAction('skip', active!.id);
  assert.equal(saves.length, 1, 'an action persists once');

  scheduler.pause(30);
  scheduler.resume();
  scheduler.restartCycle();
  scheduler.updateSettings(
    { ...baseSettings, eyeIntervalMinutes: 25 },
    { ...baseSettings }
  );
  assert.equal(saves.length, 5);
  assert.equal(saves[4].nextEyeAt, clock() + 20 * MINUTE, 'interval edits wait for the next cycle');
});

test('a corrupt state file is quarantined and defaults are used', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'runtime-state.json'), '{ not json', 'utf8');
    const store = new RuntimeStateStore(dir);

    assert.equal(store.load(() => T0), null);
    assert.equal(existsSync(join(dir, 'runtime-state.json')), false);
    assert.equal(existsSync(join(dir, `runtime-state.json.corrupt-${T0}`)), true);
  });
});

test('wrong schema version and garbage fields are rejected', () => {
  withTempDir((dir) => {
    const filePath = join(dir, 'runtime-state.json');

    writeFileSync(
      filePath,
      JSON.stringify({ version: 999, savedAt: T0, lastExitAt: null, reminder: {} }),
      'utf8'
    );
    assert.equal(new RuntimeStateStore(dir).load(() => T0), null);

    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        savedAt: T0,
        lastExitAt: null,
        reminder: { nextEyeAt: 'bogus', nextWalkAt: T0, pausedUntil: null, snoozeCount: 0 }
      }),
      'utf8'
    );
    assert.equal(new RuntimeStateStore(dir).load(() => T0), null);
  });
});

test('sanitizeSnapshot repairs partial garbage instead of dropping the whole state', () => {
  const snapshot = sanitizeSnapshot({
    nextEyeAt: T0 + 1000,
    nextWalkAt: T0 + 2000,
    pausedUntil: 'nope',
    snoozeCount: -3,
    frozenEyeMs: null,
    frozenWalkMs: 12.5
  });
  assert.deepEqual(snapshot, {
    nextEyeAt: T0 + 1000,
    nextWalkAt: T0 + 2000,
    pausedUntil: null,
    snoozeCount: 0,
    frozenEyeMs: null,
    frozenWalkMs: 12.5,
    active: null
  });
});

test('lastExitAt round-trips through the store', () => {
  withTempDir((dir) => {
    const store = new RuntimeStateStore(dir);
    store.markExiting(() => T0 + 1234);
    store.save(
      {
        nextEyeAt: T0 + MINUTE,
        nextWalkAt: T0 + 2 * MINUTE,
        pausedUntil: null,
        snoozeCount: 0,
        frozenEyeMs: null,
        frozenWalkMs: null
      },
      () => T0 + 1235
    );

    const parsed = JSON.parse(readFileSync(join(dir, 'runtime-state.json'), 'utf8'));
    assert.equal(parsed.version, 1);
    assert.equal(parsed.lastExitAt, T0 + 1234);
    assert.equal(parsed.savedAt, T0 + 1235);
  });
});

test('cleanly closed application time does not consume active-use deadlines', () => {
  withTempDir((dir) => {
    const store = new RuntimeStateStore(dir);
    store.markExiting(() => T0);
    store.save({
      nextEyeAt: T0 + 10 * MINUTE,
      nextWalkAt: T0 + 20 * MINUTE,
      pausedUntil: null,
      snoozeCount: 0,
      frozenEyeMs: null,
      frozenWalkMs: null,
      active: null
    }, () => T0);

    const restored = new RuntimeStateStore(dir).load(() => T0 + 60 * MINUTE)!;
    assert.equal(restored.nextEyeAt, T0 + 70 * MINUTE);
    assert.equal(restored.nextWalkAt, T0 + 80 * MINUTE);
  });
});

test('an active break session is serialized and recovered after a restart', () => {
  withTempDir((dir) => {
    let now = T0;
    const clock = () => now;
    const store = new RuntimeStateStore(dir);
    // Walk shorter than eye so a walk-only reminder can be active without the
    // eye kind also being due (and folding in via the combine window).
    const settings = { ...baseSettings, eyeIntervalMinutes: 60, walkIntervalMinutes: 25 };

    const first = new ReminderScheduler(settings, {
      now: clock
    });
    // A walk reminder becomes due and fires while eye is not yet due.
    now = T0 + 25 * MINUTE;
    const active = first.tick().activeReminder;
    assert.ok(active, 'a reminder is active');
    assert.equal(active?.kind, 'walk');

    // Simulate the running app persisting its state (as reconcile() does on
    // every transition) just before a crash/restart.
    store.save(first.serialize(), clock);
    const persisted = store.load(clock);
    assert.ok(persisted?.active, 'active session persisted');
    assert.equal(persisted?.active?.kind, 'walk');
    assert.equal(persisted?.active?.unlockAt, active?.unlockAt);

    // Restart a few seconds later (within the recovery grace window) recovers
    // the in-progress session under a fresh id instead of resetting the cycle.
    now = T0 + 25 * MINUTE + 5000;
    const second = new ReminderScheduler(settings, {
      now: clock,
      restore: store.load(clock)
    });
    const recovered = second.getStatus().activeReminder;
    assert.ok(recovered, 'active session recovered after restart');
    assert.equal(recovered?.kind, 'walk');
    assert.equal(recovered?.unlockAt, active?.unlockAt, 'enforcement window preserved');
    assert.notEqual(recovered?.id, active?.id, 'recovered session gets a fresh id');
  });
});

test('a recovered session canonicalizes kinds from its reminder kind', () => {
  const restore: ReminderSnapshot = {
    nextEyeAt: T0 + 20 * MINUTE,
    nextWalkAt: T0 + 60 * MINUTE,
    pausedUntil: null,
    snoozeCount: 0,
    frozenEyeMs: null,
    frozenWalkMs: null,
    active: {
      kind: 'eye',
      kinds: ['walk'],
      startedAt: T0,
      scheduledAt: T0,
      unlockAt: T0 + MINUTE,
      snoozeAllowedAt: T0,
      mode: 'focused',
      snoozeCount: 0,
      activityIds: [],
      breakTask: null
    }
  };

  const scheduler = new ReminderScheduler(baseSettings, {
    now: () => T0,
    restore
  });
  assert.equal(scheduler.getStatus().activeReminder?.kind, 'eye');
  assert.deepEqual(scheduler.getStatus().activeReminder?.kinds, ['eye']);
});

test('a stale active session (past the grace window) is not recovered', () => {
  withTempDir((dir) => {
    let now = T0;
    const clock = () => now;
    const store = new RuntimeStateStore(dir);

    const first = new ReminderScheduler(baseSettings, {
      now: clock,
      onPersist: (snapshot) => store.save(snapshot, clock)
    });
    now = T0 + 60 * MINUTE;
    assert.ok(first.tick().activeReminder, 'a reminder is active');

    // Restart long after the enforcement window lapsed: no session recovered,
    // and the scheduler falls back to the normal deadline reconcile.
    now = T0 + 60 * MINUTE + 30 * MINUTE;
    const second = new ReminderScheduler(baseSettings, {
      now: clock,
      restore: store.load(clock)
    });
    assert.equal(second.getStatus().activeReminder, null, 'stale session dropped');
  });
});

test('a paused schedule never restores an active session', () => {
  const restore: ReminderSnapshot = {
    nextEyeAt: T0 + 10 * MINUTE,
    nextWalkAt: T0 + 50 * MINUTE,
    pausedUntil: T0 + 40 * MINUTE,
    snoozeCount: 0,
    frozenEyeMs: 10 * MINUTE,
    frozenWalkMs: 50 * MINUTE,
    active: {
      kind: 'walk',
      kinds: ['walk'],
      startedAt: T0,
      scheduledAt: T0,
      unlockAt: T0 + 60_000,
      snoozeAllowedAt: T0,
      mode: 'focused',
      snoozeCount: 0,
      activityIds: [],
      breakTask: null
    }
  };
  const scheduler = new ReminderScheduler(baseSettings, {
    now: () => T0 + 20 * MINUTE,
    restore
  });
  assert.equal(scheduler.getStatus().activeReminder, null, 'paused + active is impossible: no session');
  assert.ok(scheduler.getStatus().pausedUntil, 'pause still applies');
});
