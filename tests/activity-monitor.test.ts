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
