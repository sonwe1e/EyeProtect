import assert from 'node:assert/strict';
import test from 'node:test';
import { contextDecision, type ContextSample } from '../src/main/reminderContext';
import { DEFAULT_SETTINGS } from '../src/shared/types';

const now = new Date(2026, 9, 10, 12).getTime();
const sample: ContextSample = { foregroundApp: 'editor', fullscreen: false, microphone: false, camera: false, keyCount: 0, keyIdleMs: 4_000 };
const smart = { ...DEFAULT_SETTINGS, foregroundDetectionEnabled: true };

test('foreground meetings and active capture defer; ordinary background apps do not', () => {
  for (const patch of [{ foregroundApp: 'ms-teams' }, { foregroundApp: 'wemeetapp' }, { microphone: true }, { camera: true }]) {
    const decision = contextDecision(smart, { ...sample, ...patch }, false, now);
    assert.equal(decision.action, 'defer');
    assert.equal(decision.waitForContext, true);
  }
  assert.equal(contextDecision(smart, sample, false, now).action, 'show');
  assert.equal(contextDecision(DEFAULT_SETTINGS, { ...sample, microphone: true }, true, now).action, 'show');
  assert.equal(contextDecision({ ...smart, quietAppWhitelist: ['editor'] }, sample, false, now).action, 'defer');
});

test('typing waits for a three-second pause and ignores occasional input', () => {
  assert.equal(contextDecision(smart, { ...sample, keyIdleMs: 0 }, true, now).deferSeconds, 2);
  assert.equal(contextDecision(smart, { ...sample, keyIdleMs: 2_999 }, true, now).action, 'defer');
  assert.equal(contextDecision(smart, { ...sample, keyIdleMs: 3_000 }, true, now).action, 'show');
  assert.equal(contextDecision(smart, { ...sample, keyIdleMs: 0 }, false, now).action, 'show');
});

test('fullscreen protection is independent of smart detection and ends on exit', () => {
  const settings = { ...DEFAULT_SETTINGS, fullscreenDndEnabled: true };
  assert.equal(contextDecision(settings, { ...sample, fullscreen: true }, false, now).action, 'defer');
  assert.equal(contextDecision(settings, sample, false, now).action, 'show');
});

test('quiet hours cover overnight, daytime and all-day windows without native detection', () => {
  const settings = { ...DEFAULT_SETTINGS, quietHoursEnabled: true };
  const at = (hour: number, minute = 0) => new Date(2026, 9, 10, hour, minute).getTime();
  for (const time of [at(22), at(0), at(7, 59)]) assert.equal(contextDecision(settings, null, false, time).action, 'defer');
  for (const time of [at(8), at(21, 59)]) assert.equal(contextDecision(settings, null, false, time).action, 'show');
  const daytime = { ...settings, quietHoursStartMinutes: 12 * 60, quietHoursEndMinutes: 13 * 60 };
  assert.equal(contextDecision(daytime, null, false, at(12)).action, 'defer');
  assert.equal(contextDecision(daytime, null, false, at(13)).action, 'show');
  assert.equal(contextDecision({ ...daytime, quietHoursEndMinutes: 12 * 60 }, null, false, at(23)).action, 'defer');
});

test('unavailable native samples preserve the ordinary reminder behavior', () => {
  assert.deepEqual(contextDecision(smart, null, true, now), { action: 'show' });
});
