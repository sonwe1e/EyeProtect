import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackup, parseBackup } from '../src/main/backup';
import { DEFAULT_SETTINGS, type ReminderEvent } from '../src/shared/types';

const event: ReminderEvent = {
  timestamp: new Date(2026, 6, 27, 12, 0, 0, 0).getTime(),
  kind: 'eye',
  scheduledAt: new Date(2026, 6, 27, 11, 59, 0, 0).getTime(),
  shownAt: new Date(2026, 6, 27, 12, 0, 0, 0).getTime(),
  action: 'complete',
  snoozeCount: 0,
  mode: 'guided'
};

test('complete backup round-trips settings, todos, alarms and reminder history', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    eyeIntervalMinutes: 35,
    todos: [
      {
        id: 'todo-1',
        text: '接水',
        createdAt: 1,
        completed: false,
        priority: 'important' as const,
        context: 'away' as const,
        remindOnBreak: true
      }
    ],
    alarms: [
      {
        id: 'alarm-1',
        hour: 15,
        minute: 20,
        repeat: 'daily' as const,
        enabled: true,
        createdAt: 1
      }
    ]
  };
  const text = createBackup(settings, [event], '0.5.1', 123_456);
  const restored = parseBackup(text);

  assert.equal(restored.createdAt, 123_456);
  assert.equal(restored.appVersion, '0.5.1');
  assert.equal(restored.settings.eyeIntervalMinutes, 35);
  assert.equal(restored.settings.todos[0].text, '接水');
  assert.equal(restored.settings.alarms[0].hour, 15);
  assert.deepEqual(restored.reminderHistory, [event]);
});

test('backup parser rejects unsupported containers and any malformed history entry', () => {
  assert.throws(() => parseBackup('{}'), /受支持/);
  assert.throws(
    () =>
      parseBackup(
        JSON.stringify({
          version: 1,
          createdAt: 1,
          appVersion: '0.5.1',
          settings: DEFAULT_SETTINGS,
          reminderHistory: [{ ...event, action: 'unknown' }]
        })
      ),
    /无效记录/
  );
});

test('backup parser sanitizes settings instead of trusting imported paths or ranges', () => {
  const restored = parseBackup(
    JSON.stringify({
      version: 1,
      createdAt: 1,
      appVersion: '0.5.1',
      settings: {
        ...DEFAULT_SETTINGS,
        eyeIntervalMinutes: 99_999,
        quietAppWhitelist: ['C:\\Private\\POWERPNT.EXE']
      },
      reminderHistory: []
    })
  );
  assert.equal(restored.settings.eyeIntervalMinutes, 240);
  assert.deepEqual(restored.settings.quietAppWhitelist, ['powerpnt']);
});
