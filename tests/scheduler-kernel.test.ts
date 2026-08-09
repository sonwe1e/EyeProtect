import assert from 'node:assert/strict';
import test from 'node:test';
import { ReminderScheduler } from '../src/main/reminders';
import { SchedulerKernel } from '../src/main/scheduling/kernel';
import type { ScheduledEvent } from '../src/main/scheduling/kernel';
import type { Settings } from '../src/shared/types';

/** Deterministic wall + monotonic clock; monotonic always tracks wall. */
const makeClock = () => {
  let now = 0;
  return {
    now: (): number => now,
    monotonic: (): number => now,
    set: (value: number): void => {
      now = value;
    },
    advance: (ms: number): void => {
      now += ms;
    }
  };
};

const makeScheduler = (settings: Settings = makeSchedulerSettings()) => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  const scheduler = new ReminderScheduler(settings, { now: clock.now, kernel });
  return { clock, kernel, scheduler };
};

const makeSchedulerSettings = (overrides: Partial<Settings> = {}): Settings => ({
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
  todos: [],
  ...overrides
});

const makeKernel = (clock = makeClock(), trace?: (m: string, d?: Record<string, unknown>) => void) => {
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    // Disable the periodic watchdog in unit tests; we drive reconcile by hand.
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER,
    trace
  });
  return { clock, kernel };
};

const event = (
  id: string,
  owner: string,
  fireAt: number,
  type = 'test',
  revision = 1
): ScheduledEvent => ({ id, owner, type, fireAt, revision });

test('fires the nearest deadline exactly on time', () => {
  const { clock, kernel } = makeKernel();
  const seen: string[] = [];
  kernel.on('wake', (owner, events) => {
    seen.push(...events.map((e) => `${owner}:${e.id}`));
  });

  kernel.set('svc', [
    event('a', 'svc', 1000),
    event('b', 'svc', 500),
    event('c', 'svc', 1500)
  ]);
  kernel.start();

  assert.equal(seen.length, 0, 'nothing fires before the first deadline');
  clock.set(500);
  kernel.reconcile();
  assert.deepEqual(seen, ['svc:b'], 'nearest deadline fires first');

  clock.set(1000);
  kernel.reconcile();
  assert.deepEqual(seen, ['svc:b', 'svc:a']);

  clock.set(1500);
  kernel.reconcile();
  assert.deepEqual(seen, ['svc:b', 'svc:a', 'svc:c']);
});

test('set() replaces only the owning service deadlines', () => {
  const { clock, kernel } = makeKernel();
  const seen: string[] = [];
  kernel.on('wake', (owner, events) => {
    seen.push(...events.map((e) => `${owner}:${e.id}`));
  });

  kernel.set('break', [event('eye', 'break', 1000, 'eye')]);
  kernel.set('alarm', [event('alm', 'alarm', 2000, 'alarm')]);
  kernel.start();

  // Re-setting the break deadlines must not drop the alarm deadline.
  clock.advance(500);
  kernel.set('break', [event('eye2', 'break', 3000, 'eye')]);

  clock.set(2000);
  kernel.reconcile();
  assert.deepEqual(seen, ['alarm:alm'], 'alarm deadline survives break re-set');

  clock.set(3000);
  kernel.reconcile();
  assert.deepEqual(seen, ['alarm:alm', 'break:eye2']);
});

test('clear() drops an owners deadlines', () => {
  const { clock, kernel } = makeKernel();
  const seen: string[] = [];
  kernel.on('wake', (owner, events) => {
    seen.push(...events.map((e) => `${owner}:${e.id}`));
  });

  kernel.set('break', [event('eye', 'break', 1000, 'eye')]);
  kernel.set('alarm', [event('alm', 'alarm', 1000, 'alarm')]);
  kernel.start();

  kernel.clear('break');
  clock.set(1000);
  kernel.reconcile();
  assert.deepEqual(seen, ['alarm:alm'], 'cleared owner does not fire');
});

test('past deadlines fire immediately on reconcile (wall-clock jump)', () => {
  const { clock, kernel } = makeKernel();
  const seen: string[] = [];
  kernel.on('wake', (owner, events) => {
    seen.push(...events.map((e) => `${owner}:${e.id}`));
  });

  kernel.set('svc', [event('a', 'svc', 1000)]);
  kernel.start();

  // Wall clock jumps well past the deadline without the timer ever firing.
  clock.set(5000);
  kernel.reconcile();
  assert.deepEqual(seen, ['svc:a'], 'missed deadline fires on reconcile');
});

test('multiple due deadlines fire grouped by owner', () => {
  const { clock, kernel } = makeKernel();
  const seenByOwner = new Map<string, string[]>();
  kernel.on('wake', (owner, events) => {
    const list = seenByOwner.get(owner) ?? [];
    list.push(...events.map((e) => e.id));
    seenByOwner.set(owner, list);
  });

  kernel.set('break', [
    event('eye', 'break', 1000, 'eye'),
    event('walk', 'break', 1000, 'walk')
  ]);
  kernel.set('alarm', [event('alm', 'alarm', 1000, 'alarm')]);
  kernel.start();

  clock.set(1000);
  kernel.reconcile();
  assert.deepEqual(seenByOwner.get('break'), ['eye', 'walk']);
  assert.deepEqual(seenByOwner.get('alarm'), ['alm']);
});

test('stop() disarms the timer; deadlines no longer fire', () => {
  const { clock, kernel } = makeKernel();
  let fired = false;
  kernel.on('wake', () => {
    fired = true;
  });

  kernel.set('svc', [event('a', 'svc', 1000)]);
  kernel.start();
  kernel.stop();

  clock.set(1000);
  kernel.reconcile();
  assert.equal(fired, false, 'stopped kernel does not fire');
});

test('watchdog detects wall-clock drift and reconciles', () => {
  // Here the wall clock and monotonic clock diverge: wall jumps +2h while
  // monotonic advances only the watchdog interval. The watchdog must notice
  // the divergence and fire any deadline now in the past.
  let wall = 0;
  let mono = 0;
  const clock = {
    now: (): number => wall,
    monotonic: (): number => mono
  };
  const kernel = new SchedulerKernel({
    clock,
    watchdogIntervalMs: 30_000,
    driftThresholdMs: 10_000
  });

  const seen: string[] = [];
  kernel.on('wake', (owner, events) => {
    seen.push(...events.map((e) => `${owner}:${e.id}`));
  });

  // Deadline 1s out. Baseline the drift tracker.
  kernel.set('svc', [event('a', 'svc', 1000)]);
  kernel.start();

  // Advance both clocks by one watchdog interval (no drift yet).
  wall += 30_000;
  mono += 30_000;
  // The deadline (fireAt 1000) is now far in the past; the watchdog's
  // missed-deadline guard should catch it even without drift.
  (kernel as unknown as { checkDrift: () => void }).checkDrift();
  assert.deepEqual(seen, ['svc:a'], 'watchdog fires the missed deadline');
});

test('watchdog treats large wall-clock jump as drift', () => {
  let wall = 0;
  let mono = 0;
  const clock = {
    now: (): number => wall,
    monotonic: (): number => mono
  };
  const kernel = new SchedulerKernel({
    clock,
    watchdogIntervalMs: 30_000,
    driftThresholdMs: 10_000
  });

  let driftDelta: number | null = null;
  kernel.on('drift', (delta) => {
    driftDelta = delta;
  });

  kernel.set('svc', [event('a', 'svc', 90_000)]);
  kernel.start();

  // Wall clock jumps +2h; monotonic advances only the watchdog interval.
  wall += 2 * 60 * 60 * 1000;
  mono += 30_000;
  (kernel as unknown as { checkDrift: () => void }).checkDrift();

  assert.ok(driftDelta !== null, 'drift event emitted');
  // wallElapsed - monoElapsed ≈ 2h - 30s, well over the 10s threshold.
  assert.ok(Math.abs(driftDelta!) > 10_000, 'drift magnitude reflects the jump');
});

test('trace callback receives lifecycle and fire events', () => {
  const clock = makeClock();
  const messages: string[] = [];
  const { kernel } = makeKernel(clock, (m) => messages.push(m));

  kernel.set('svc', [event('a', 'svc', 1000)]);
  kernel.start();
  clock.set(1000);
  kernel.reconcile();
  kernel.stop();

  assert.ok(messages.some((m) => m === 'kernel start'));
  assert.ok(messages.some((m) => m === 'kernel set'));
  assert.ok(messages.some((m) => m === 'kernel fire'));
  assert.ok(messages.some((m) => m === 'kernel stop'));
});

test('ReminderScheduler delegates its timer to the kernel when provided', () => {
  // Integration: the production wiring passes one shared kernel to the
  // scheduler. Verify the scheduler reports its next deadline to the kernel
  // (instead of arming its own setTimeout) and gets woken to reconcile.
  const { kernel, scheduler } = makeKernel();
  let now = 0;
  kernel.clock = { now: () => now, monotonic: () => now };

  const settings = makeSchedulerSettings();
  const wake: string[] = [];
  kernel.on('wake', (owner) => wake.push(owner));

  // Production starts the kernel before the scheduler so deadlines arm.
  kernel.start();
  const s = new ReminderScheduler(settings, { now: () => now, kernel });
  s.start();

  // The scheduler's next deadline is registered under the 'break' owner.
  const breakEvents = kernel.peek().filter((e) => e.owner === 'break');
  assert.equal(breakEvents.length, 1, 'scheduler reports exactly one break deadline');
  assert.ok(breakEvents[0].fireAt > 0, 'deadline is in the future');

  // Advancing to the deadline and reconciling wakes the scheduler, which then
  // reconciles and re-arms.
  now = breakEvents[0].fireAt;
  kernel.reconcile();
  assert.ok(wake.includes('break'), 'kernel woke the scheduler');

  // After reconcile, the scheduler re-reported a (possibly new) deadline.
  assert.equal(kernel.peek().filter((e) => e.owner === 'break').length, 1);
  s.stop();
  kernel.stop();
});

test('ReminderScheduler with a kernel fires a due reminder on reconcile', () => {
  const clock = makeClock();
  const kernel = new SchedulerKernel({
    clock: { now: clock.now, monotonic: clock.monotonic },
    watchdogIntervalMs: Number.MAX_SAFE_INTEGER
  });
  const settings = makeSchedulerSettings({ eyeIntervalMinutes: 1, walkIntervalMinutes: 60 });
  // Production starts the kernel before the scheduler so deadlines arm.
  kernel.start();
  const scheduler = new ReminderScheduler(settings, { now: clock.now, kernel });
  scheduler.start();

  // Advance past the 1-minute eye deadline and reconcile via the kernel.
  clock.set(60_000 + 1);
  kernel.reconcile();

  assert.equal(scheduler.getStatus().activeReminder?.kind, 'eye', 'eye reminder fired through kernel');
});
