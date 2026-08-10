import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RuntimeStateStore } from '../src/main/runtimeState';
import type { ReminderSnapshot } from '../src/main/reminders';

const T0 = new Date(2026, 6, 8, 10, 0, 0, 0).getTime();

const baseSnapshot = (overrides: Partial<ReminderSnapshot> = {}): ReminderSnapshot => ({
  nextEyeAt: T0 + 20 * 60_000,
  nextWalkAt: T0 + 60 * 60_000,
  pausedUntil: null,
  snoozeCount: 0,
  frozenEyeMs: null,
  frozenWalkMs: null,
  active: null,
  ...overrides
});

const tempDir = (): string => mkdtempSync(join(tmpdir(), 'eyeprotect-runtime-state-'));

test('clean exit then crash restore uses the recent checkpoint, not the stale exit', () => {
  const dataDir = tempDir();
  try {
    // Session 1: run, then a clean exit.
    const session1 = new RuntimeStateStore(dataDir);
    session1.beginSession();
    let now = T0;
    const clock = () => now;
    session1.save(baseSnapshot(), clock); // checkpoint @ T0
    now = T0 + 5_000;
    session1.save(baseSnapshot(), clock); // checkpoint @ T0+5s (kept alive)
    session1.markExiting(clock); // clean exit @ T0+5s
    session1.save(baseSnapshot(), clock);

    // Session 2: a brand-new process. The snapshot on disk carries the clean
    // exit of session 1 AND a checkpoint kept alive near session 1's end.
    const session2 = new RuntimeStateStore(dataDir);
    session2.beginSession();
    // Relaunch 5s after session 1's last checkpoint (a crash-like gap, NOT the
    // hours-old clean exit that a naive implementation would pick).
    const relaunchAt = T0 + 5_000 + 5_000;
    const restored = session2.load(() => relaunchAt);

    assert.ok(restored, 'snapshot restored');
    // Offline window is ~5s (the gap since the last checkpoint), so deadlines
    // shift by roughly that tiny gap — not hours.
    const shift = restored!.nextEyeAt - (T0 + 20 * 60_000);
    assert.ok(shift >= 4_900 && shift <= 5_100, `deadline shifted by the tiny inter-save gap, got ${shift}ms`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('clean exit -> relaunch -> checkpoint -> crash never reuses the first session exit', () => {
  const dataDir = tempDir();
  try {
    let now = T0;
    const clock = () => now;
    const active = {
      kind: 'eye' as const,
      kinds: ['eye'] as const,
      startedAt: T0,
      scheduledAt: T0,
      unlockAt: T0 + 30_000,
      snoozeAllowedAt: T0,
      mode: 'focused' as const,
      snoozeCount: 0,
      activityIds: ['eye-1'],
      breakTask: null
    };

    const first = new RuntimeStateStore(dataDir);
    first.beginSession();
    first.save(baseSnapshot(), clock);
    now += 5_000;
    first.markExiting(clock);
    first.save(baseSnapshot(), clock);

    now += 5_000;
    const second = new RuntimeStateStore(dataDir);
    second.beginSession();
    const restoredSecond = second.load(clock)!;
    const secondDeadline = restoredSecond.nextEyeAt;
    // The relaunch claims the file immediately; later checkpoints belong to
    // session 2 and contain no session-1 clean-exit marker.
    now += 2 * 60 * 60_000;
    second.save({ ...restoredSecond, active }, clock);

    now += 5_000; // session 2 crashed; this is the only unknown/offline gap
    const third = new RuntimeStateStore(dataDir);
    third.beginSession();
    const restoredThird = third.load(clock)!;
    assert.equal(restoredThird.nextEyeAt, secondDeadline + 5_000);
    assert.ok(restoredThird.active, 'recent active focused reminder remains available to scheduler recovery');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the store preserves an active session; the scheduler decides recovery', () => {
  // The store must not second-guess session recovery: it returns `active`
  // as-is across the load and lets the scheduler's grace window drop a stale
  // session. (Clearing `active` in load() would break the 5s-restart case in
  // scheduler-persistence.test.ts.) Here we assert the store round-trips it.
  const dataDir = tempDir();
  try {
    const activeSession = {
      kind: 'eye',
      kinds: ['eye'],
      startedAt: T0,
      scheduledAt: T0,
      unlockAt: T0 + 30_000,
      snoozeAllowedAt: T0,
      mode: 'focused',
      snoozeCount: 0,
      activityIds: ['eye-1'],
      breakTask: null
    };
    const session1 = new RuntimeStateStore(dataDir);
    session1.beginSession();
    let now = T0;
    const clock = () => now;
    session1.save(baseSnapshot({ active: activeSession }), clock);
    session1.markExiting(clock);

    const session2 = new RuntimeStateStore(dataDir);
    session2.beginSession();
    const restored = session2.load(() => T0 + 90_000);
    assert.ok(restored, 'snapshot restored');
    assert.ok(restored!.active, 'store preserves the active session for the scheduler');
    assert.equal(restored!.active?.kind, 'eye');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a paused snapshot is never shifted even with a checkpoint present', () => {
  const dataDir = tempDir();
  try {
    const session1 = new RuntimeStateStore(dataDir);
    session1.beginSession();
    let now = T0;
    const clock = () => now;
    now = T0 + 1_000;
    session1.save(
      baseSnapshot({ pausedUntil: T0 + 60 * 60_000 }),
      clock // checkpoint @ T0+1s
    );
    session1.markExiting(clock);

    const session2 = new RuntimeStateStore(dataDir);
    session2.beginSession();
    // Relaunch an hour later: a naive bound would shift deadlines, but a paused
    // schedule must resume its hold unchanged.
    const restored = session2.load(() => T0 + 60 * 60_000);
    assert.ok(restored, 'snapshot restored');
    assert.equal(restored!.nextEyeAt, T0 + 20 * 60_000, 'eye deadline untouched while paused');
    assert.equal(restored!.nextWalkAt, T0 + 60 * 60_000, 'walk deadline untouched while paused');
    assert.equal(restored!.pausedUntil, T0 + 60 * 60_000, 'pause hold preserved');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('schema version mismatch returns null and quarantines nothing readable', () => {
  const dataDir = tempDir();
  try {
    const session1 = new RuntimeStateStore(dataDir);
    session1.beginSession();
    session1.save(baseSnapshot(), () => T0);

    // Tamper the on-disk version to simulate a future/unknown schema.
    const filePath = join(dataDir, 'runtime-state.json');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { version: number };
    parsed.version = 999;
    writeFileSync(filePath, JSON.stringify(parsed), 'utf8');

    const session2 = new RuntimeStateStore(dataDir);
    session2.beginSession();
    const restored = session2.load(() => T0 + 1_000);
    assert.equal(restored, null, 'unknown schema falls back to a fresh start');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
