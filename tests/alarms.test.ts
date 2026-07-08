import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AlarmClock, nextFireAt } from '../src/main/alarms';
import { SettingsStore } from '../src/main/settings';
import { Alarm, sanitizeAlarm, sanitizeAlarms } from '../src/shared/types';

// Fixed local time: 2026-07-08 10:30:59.500 (a Wednesday).
// Placed just under a minute boundary so a 10:31 alarm fires in ~500ms of real
// time, keeping the fire tests fast while still exercising the real timer.
const BASE_TS = new Date(2026, 6, 8, 10, 30, 59, 500).getTime();

test('nextFireAt returns today when the wall-clock time is still ahead', () => {
  const fire = nextFireAt(10, 50, BASE_TS);
  assert.equal(fire, new Date(2026, 6, 8, 10, 50, 0, 0).getTime());
});

test('nextFireAt rolls to tomorrow when the wall-clock time has passed today', () => {
  const fire = nextFireAt(10, 1, BASE_TS);
  assert.equal(fire, new Date(2026, 6, 9, 10, 1, 0, 0).getTime());
});

test('nextFireAt advances forward at the exact-now instant instead of dropping', () => {
  const fire = nextFireAt(10, 30, new Date(2026, 6, 8, 10, 30, 0, 0).getTime());
  assert.equal(fire, new Date(2026, 6, 9, 10, 30, 0, 0).getTime());
});

test('setAlarm appends an enabled alarm and emits changed with the new list', () => {
  const clock = new AlarmClock(() => BASE_TS);
  const changed: { hour: number; minute: number }[][] = [];
  clock.on('changed', (alarms) => changed.push(alarms));

  const list = clock.setAlarm({ hour: 10, minute: 50, repeat: 'once', enabled: true });

  assert.equal(list.length, 1);
  assert.equal(list[0].hour, 10);
  assert.equal(list[0].minute, 50);
  assert.equal(list[0].repeat, 'once');
  assert.equal(list[0].enabled, true);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].length, 1);
});

test('cancelAlarm removes the alarm and prevents it from firing', async () => {
  const clock = new AlarmClock(() => BASE_TS);
  const fired: string[] = [];
  clock.on('fired', (alarm) => fired.push(alarm.id));

  const list = clock.setAlarm({ hour: 10, minute: 50, repeat: 'once', enabled: true });
  clock.cancelAlarm(list[0].id);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(fired.length, 0);
  assert.equal(clock.getAlarms().length, 0);
});

test('an enabled alarm fires once at its scheduled time', async () => {
  const clock = new AlarmClock(() => BASE_TS);
  const fired: string[] = [];
  clock.on('fired', (alarm) => fired.push(alarm.id));

  // 10:31 is ~500ms ahead of BASE_TS, so the real setTimeout elapses quickly.
  const list = clock.setAlarm({ hour: 10, minute: 31, repeat: 'once', enabled: true });

  await new Promise((resolve) => setTimeout(resolve, 700));

  assert.equal(fired.length, 1);
  assert.equal(fired[0], list[0].id);
});

test('once and daily alarms both fire on the first trigger; daily stays armed', async () => {
  const clock = new AlarmClock(() => BASE_TS);
  const firedOnce: string[] = [];
  const firedDaily: string[] = [];
  clock.on('fired', (alarm) => {
    if (alarm.repeat === 'once') {
      firedOnce.push(alarm.id);
    } else {
      firedDaily.push(alarm.id);
    }
  });

  clock.setAlarm({ hour: 10, minute: 31, repeat: 'once', enabled: true });
  clock.setAlarm({ hour: 10, minute: 31, repeat: 'daily', enabled: true });

  // The daily alarm is the last one appended.
  const dailyId = clock.getAlarms().find((a) => a.repeat === 'daily')?.id;
  assert.ok(dailyId, 'expected a daily alarm to exist after setAlarm');

  await new Promise((resolve) => setTimeout(resolve, 700));

  assert.equal(firedOnce.length, 1);
  assert.equal(firedDaily.length, 1);

  // The daily alarm re-arms for tomorrow (still present + enabled); the once
  // alarm fired and is no longer armed. Cancel both so the suite exits cleanly.
  const remaining = clock.getAlarms();
  assert.ok(remaining.some((a) => a.id === dailyId && a.repeat === 'daily' && a.enabled));

  for (const alarm of remaining) {
    clock.cancelAlarm(alarm.id);
  }
});

test('sanitizeAlarm keeps a fully-populated valid alarm', () => {
  const alarm = sanitizeAlarm({
    id: 'a1',
    hour: 7,
    minute: 30,
    label: 'wake',
    repeat: 'once',
    enabled: true,
    createdAt: 1000
  });
  assert.deepEqual(alarm, {
    id: 'a1',
    hour: 7,
    minute: 30,
    label: 'wake',
    repeat: 'once',
    enabled: true,
    createdAt: 1000
  });
});

test('sanitizeAlarm drops an alarm with an out-of-range hour or minute', () => {
  assert.equal(sanitizeAlarm({ id: 'a1', hour: 25, minute: 0, repeat: 'once', enabled: true, createdAt: 1 }), null);
  assert.equal(sanitizeAlarm({ id: 'a1', hour: 7, minute: 60, repeat: 'once', enabled: true, createdAt: 1 }), null);
  assert.equal(sanitizeAlarm({ id: 'a1', hour: 7, minute: 30, repeat: 'yearly', enabled: true, createdAt: 1 }), null);
});

test('persistAlarms writes alarms and a second SettingsStore instance reads them back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-a-'));
  const original = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = dir;
  try {
    const store = new SettingsStore();
    store.persistAlarms([
      { id: 'a1', hour: 7, minute: 30, label: 'wake', repeat: 'once', enabled: true, createdAt: 1000 },
      { id: 'a2', hour: 12, minute: 0, repeat: 'daily', enabled: false, createdAt: 1001 }
    ]);

    const readback = new SettingsStore().get().alarms;
    assert.equal(readback.length, 2);
    assert.deepEqual(readback[0], {
      id: 'a1',
      hour: 7,
      minute: 30,
      label: 'wake',
      repeat: 'once',
      enabled: true,
      createdAt: 1000
    });
    assert.equal(readback[1].repeat, 'daily');
    assert.equal(readback[1].enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) {
      delete process.env.EYEPROTECT_DATA_DIR;
    } else {
      process.env.EYEPROTECT_DATA_DIR = original;
    }
  }
});

test('sanitizeAlarms keeps valid entries in order and drops malformed ones', () => {
  const result = sanitizeAlarms([
    { id: 'a1', hour: 7, minute: 0, repeat: 'daily', enabled: true, createdAt: 1 },
    { id: 'a2', hour: -1, minute: 0, repeat: 'once', enabled: true, createdAt: 2 },
    'nonsense',
    { id: 'a3', hour: 23, minute: 59, repeat: 'once', enabled: false, createdAt: 3 }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'a1');
  assert.equal(result[1].id, 'a3');
});
