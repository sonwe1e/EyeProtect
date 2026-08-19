import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityMonitor, type ActivityResume } from '../src/main/activityMonitor';

test('idle sampling backdates inactive time and detects a natural break', () => {
  let now = 100_000;
  let idleSeconds = 0;
  const inactive: Array<{ state: string; since: number }> = [];
  const resumed: ActivityResume[] = [];
  const monitor = new ActivityMonitor({
    getIdleSeconds: () => idleSeconds,
    naturalBreakMs: () => 5 * 60_000,
    now: () => now
  });
  monitor.on('inactive', (payload) => inactive.push(payload));
  monitor.on('active', (payload) => resumed.push(payload));

  idleSeconds = 310;
  monitor.sample();
  assert.deepEqual(inactive, [{ state: 'idle', since: -210_000 }]);

  now += 2_000;
  idleSeconds = 0;
  monitor.sample();
  assert.equal(resumed[0].inactiveMs, 312_000);
  assert.equal(resumed[0].naturalBreak, true);
});

test('input idle below the 60s threshold does NOT enter idle (1s no longer triggers)', () => {
  let now = 100_000;
  let idleSeconds = 0;
  const inactive: Array<{ state: string; since: number }> = [];
  const monitor = new ActivityMonitor({
    getIdleSeconds: () => idleSeconds,
    naturalBreakMs: () => 5 * 60_000,
    now: () => now
  });
  monitor.on('inactive', (payload) => inactive.push(payload));

  // 1 second of idle used to flip the state to idle; with the 60s default it
  // must now be treated as active.
  idleSeconds = 1;
  monitor.sample();
  assert.equal(inactive.length, 0, '1s idle must not enter idle');
  assert.equal(monitor.getState(), 'active');

  // 500ms also stays active.
  idleSeconds = 0.5;
  monitor.sample();
  assert.equal(monitor.getState(), 'active');
});

test('input idle beyond the threshold enters idle', () => {
  let now = 100_000;
  let idleSeconds = 0;
  const inactive: Array<{ state: string; since: number }> = [];
  const resumed: ActivityResume[] = [];
  const monitor = new ActivityMonitor({
    getIdleSeconds: () => idleSeconds,
    naturalBreakMs: () => 5 * 60_000,
    now: () => now
  });
  monitor.on('inactive', (payload) => inactive.push(payload));
  monitor.on('active', (payload) => resumed.push(payload));

  idleSeconds = 61;
  monitor.sample();
  assert.equal(monitor.getState(), 'idle');
  assert.equal(inactive.length, 1);

  // Returning below the threshold flips back to active.
  idleSeconds = 0;
  monitor.sample();
  assert.equal(monitor.getState(), 'active');
  assert.equal(resumed.length, 1);
});

test('idleThresholdMs is configurable', () => {
  let idleSeconds = 0;
  const inactive: Array<{ state: string; since: number }> = [];
  const monitor = new ActivityMonitor({
    getIdleSeconds: () => idleSeconds,
    naturalBreakMs: () => 5 * 60_000,
    idleThresholdMs: 2_000
  });
  monitor.on('inactive', (payload) => inactive.push(payload));

  idleSeconds = 1.5;
  monitor.sample();
  assert.equal(inactive.length, 0, '1.5s idle under a 2s threshold stays active');

  idleSeconds = 2.5;
  monitor.sample();
  assert.equal(monitor.getState(), 'idle', '2.5s idle over a 2s threshold enters idle');
});

test('lock/unlock emits one inactive interval and preserves its first boundary', () => {
  let now = 1_000;
  const resumed: ActivityResume[] = [];
  const monitor = new ActivityMonitor({
    getIdleSeconds: () => 0,
    naturalBreakMs: () => 60_000,
    now: () => now
  });
  monitor.on('active', (payload) => resumed.push(payload));

  monitor.lock();
  now = 62_000;
  monitor.unlock();

  assert.deepEqual(resumed, [{ previous: 'locked', inactiveMs: 61_000, naturalBreak: true }]);
});
