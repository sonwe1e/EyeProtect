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
  startWithWindows: false,
  petScale: 1,
  petPosition: null,
  petSkin: 'stable',
  dimDesktop: true,
  alarms: [],
  todos: []
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

test('an overdue deadline restored after a long absence fires at most one reminder', () => {
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
    assert.equal(status.activeReminder?.kind, 'combined', 'both overdue kinds merge into one');
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
  scheduler.handleAction('skip', active.id);
  assert.equal(saves.length, 1, 'an action persists once');

  scheduler.pause(30);
  scheduler.resume();
  scheduler.restartCycle();
  scheduler.updateSettings(
    { ...baseSettings, eyeIntervalMinutes: 25 },
    { ...baseSettings }
  );
  assert.equal(saves.length, 5);
  assert.equal(saves[4].nextEyeAt, clock() + 25 * MINUTE);
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
    frozenWalkMs: 12.5
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
