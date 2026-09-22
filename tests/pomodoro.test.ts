import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PomodoroService } from '../src/main/pomodoro';
import { SchedulerKernel } from '../src/main/scheduling/kernel';
import { ReminderScheduler } from '../src/main/reminders';
import { DEFAULT_SETTINGS } from '../src/shared/types';

const fixture = (fn: (context: { service: PomodoroService; kernel: SchedulerKernel; advance: (ms: number) => void; setHealth: (value: boolean) => void; invalidate: () => void; directory: string; now: () => number; monotonic: () => number; changeWall: () => void }) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-pomodoro-'));
  let wall = 1000; let mono = 0; let health = false; let available = true;
  const kernel = new SchedulerKernel({ clock: { now: () => wall, monotonic: () => mono } });
  const service = new PomodoroService(directory, kernel, { now: () => wall, monotonic: () => mono, taskAvailable: () => available, healthBreakActive: () => health, breakMinutes: () => 5 });
  kernel.start();
  try { fn({ service, kernel, advance: (ms) => { wall += ms; mono += ms; kernel.reconcile(); }, setHealth: (value) => { health = value; }, invalidate: () => { available = false; service.reconcileTask(); }, directory, now: () => wall, monotonic: () => mono, changeWall: () => { wall += 3600000; kernel.reconcile(); } }); }
  finally { service.dispose(); kernel.stop(); rmSync(directory, { recursive: true, force: true }); }
};

test('free focus survives pause/resume and wall-clock changes without losing elapsed time', () => fixture(({ service, advance, changeWall }) => {
  service.start(null, 25);
  advance(20 * 60000);
  service.act('pause'); service.act('pause');
  assert.equal(service.getState().remainingMs, 5 * 60000);
  advance(60000); changeWall();
  assert.equal(service.getState().remainingMs, 5 * 60000);
  service.act('resume'); service.act('resume'); advance(1000);
  assert.equal(service.getState().remainingMs, 299000);
}));

test('actual health rest pauses focus; closing health rest never resumes automatically', () => fixture(({ service, advance, setHealth }) => {
  service.start('task', 25); advance(1200000); setHealth(true); service.beginHealthRest();
  advance(30000);
  assert.throws(() => service.act('resume'), /休息/);
  setHealth(false);
  assert.equal(service.getState().running, false);
  assert.equal(service.getState().remainingMs, 300000);
  service.act('resume'); assert.equal(service.getState().running, true);
}));

test('finish waits for manual rest, short rest does not complete a task or loop', () => fixture(({ service, advance }) => {
  service.start('task', 1); advance(60000);
  assert.equal(service.getState().phase, 'focus-finished');
  service.act('break'); service.act('break'); advance(300000);
  assert.equal(service.getState().phase, 'break-finished');
  assert.equal(service.getState().running, false);
}));

test('restart restores a paused checkpoint and invalid tasks end a run', () => fixture(({ service, kernel, advance, directory, now, monotonic, invalidate }) => {
  service.start('task', 25); advance(20000); service.act('pause');
  const restored = new PomodoroService(directory, kernel, { now, monotonic, taskAvailable: () => true, healthBreakActive: () => false, breakMinutes: () => 5 });
  assert.equal(restored.getState().running, false);
  assert.equal(restored.getState().remainingMs, 1480000);
  restored.dispose(); invalidate(); assert.equal(service.getState().phase, 'idle');
}));

test('invalid durations and unconfirmed replacement do not overwrite a running focus', () => fixture(({ service }) => {
  assert.throws(() => service.start(null, Infinity));
  service.start(null, 25);
  assert.throws(() => service.start('task', 10));
  assert.equal(service.getState().taskId, null);
}));

test('preparing a timer does not consume time and replacement remains explicit', () => fixture(({ service, advance }) => {
  service.prepare(null);
  advance(60000);
  assert.equal(service.getState().phase, 'ready');
  assert.equal(service.getState().running, false);
  service.start(null, 10, true);
  assert.throws(() => service.prepare('another'));
  service.prepare('another', true);
  assert.equal(service.getState().phase, 'ready');
  assert.equal(service.getState().taskId, 'another');
}));


test('health rest at focus expiry joins the short rest instead of prompting twice', () => fixture(({ service, advance, setHealth }) => {
  service.start('task', 1); advance(60000);
  assert.equal(service.getState().phase, 'focus-finished');
  setHealth(true); service.beginHealthRest();
  assert.equal(service.getState().phase, 'break');
  assert.equal(service.getState().remainingMs, 300000);
  advance(300000);
  assert.equal(service.getState().phase, 'break-finished');
  setHealth(false);
  assert.equal(service.getState().running, false);
}));

// ── F02: idle freeze semantics shared with the kernel ────────────────────────

test('focus started inside an idle freeze keeps its countdown and ends on active time', () => fixture(({ service, kernel, advance }) => {
  // Production wiring: 60s without input freezes the kernel's elapsed clocks
  // (and pauses the pomodoro); the tray can still start a focus inside that
  // window before the next activity sample.
  advance(60_000);
  kernel.pauseElapsed();
  advance(600_000);

  service.start(null, 1);
  assert.equal(service.getState().remainingMs, 60_000, 'countdown does not run while idle');
  advance(600_000);
  assert.equal(service.getState().remainingMs, 60_000, 'ten more idle minutes change nothing');

  kernel.resumeElapsed();
  advance(5_000);
  assert.equal(service.getState().remainingMs, 55_000, 'countdown resumes with active-use time');
  assert.equal(service.getState().phase, 'focus', 'phase still running right after resume');
  advance(55_000);
  assert.equal(service.getState().phase, 'focus-finished', 'phase ends exactly when the countdown reaches zero');
  assert.equal(service.getState().remainingMs, 0);
}));

test('the countdown never shows 00:00 while the phase is still running', () => fixture(({ service, kernel, advance }) => {
  service.start(null, 1);
  advance(59_000);
  kernel.pauseElapsed();
  advance(120_000);
  assert.equal(service.getState().phase, 'focus');
  assert.equal(service.getState().remainingMs, 1_000, 'the last second survives the freeze');
  kernel.resumeElapsed();
  advance(500);
  assert.equal(service.getState().remainingMs, 500);
  advance(500);
  assert.equal(service.getState().phase, 'focus-finished');
}));
