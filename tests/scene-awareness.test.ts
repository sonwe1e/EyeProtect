import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReminderContext, getQuietHoursEnd } from '../src/main/sceneAwareness';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types';

const settings = (overrides: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...overrides
});

test('overnight quiet hours defer to the configured local morning time', () => {
  const late = new Date(2026, 6, 27, 23, 10, 0, 0).getTime();
  const early = new Date(2026, 6, 28, 7, 30, 0, 0).getTime();
  const daytime = new Date(2026, 6, 28, 12, 0, 0, 0).getTime();

  assert.equal(
    getQuietHoursEnd(late, 22 * 60, 8 * 60),
    new Date(2026, 6, 28, 8, 0, 0, 0).getTime()
  );
  assert.equal(
    getQuietHoursEnd(early, 22 * 60, 8 * 60),
    new Date(2026, 6, 28, 8, 0, 0, 0).getTime()
  );
  assert.equal(getQuietHoursEnd(daytime, 22 * 60, 8 * 60), null);
  assert.equal(getQuietHoursEnd(late, 8 * 60, 8 * 60), null, 'equal endpoints disable the interval');
});

test('fixed quiet hours are evaluated before any foreground process read', async () => {
  const now = new Date(2026, 6, 27, 23, 45, 0, 0).getTime();
  let detectorCalls = 0;
  const result = await evaluateReminderContext(
    settings({
      quietHoursEnabled: true,
      quietHoursStartMinutes: 22 * 60,
      quietHoursEndMinutes: 8 * 60,
      foregroundDetectionEnabled: true,
      quietAppWhitelist: ['powerpnt']
    }),
    now,
    async () => {
      detectorCalls += 1;
      return { appName: 'powerpnt', fullScreen: true };
    }
  );

  assert.equal(result.action, 'defer');
  assert.equal(result.deferMinutes, 495);
  assert.match(result.reason ?? '', /固定免打扰/);
  assert.equal(detectorCalls, 0);
});

test('foreground detection only defers an explicitly whitelisted app', async () => {
  const configured = settings({
    foregroundDetectionEnabled: true,
    quietAppWhitelist: ['powerpnt']
  });
  const ignored = await evaluateReminderContext(configured, Date.now(), async () => ({
    appName: 'notepad',
    fullScreen: true
  }));
  assert.equal(ignored.action, 'show');

  const matched = await evaluateReminderContext(configured, Date.now(), async () => ({
    appName: 'powerpnt',
    fullScreen: true
  }));
  assert.equal(matched.action, 'defer');
  assert.equal(matched.deferMinutes, 5);
  assert.equal(matched.foregroundApp, 'powerpnt');
  assert.match(matched.reason ?? '', /全屏/);
});

test('known meeting apps use a system-only notification decision', async () => {
  const result = await evaluateReminderContext(
    settings({
      foregroundDetectionEnabled: true,
      quietAppWhitelist: ['zoom']
    }),
    Date.now(),
    async () => ({ appName: 'zoom', fullScreen: false })
  );
  assert.equal(result.action, 'notify');
  assert.equal(result.deferMinutes, 5);
  assert.match(result.reason ?? '', /系统轻提示/);
});
