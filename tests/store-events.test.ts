import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sanitizeSettings, SettingsStore } from '../src/main/settings';
import { ALARM_LABEL_MAX, TODO_TEXT_MAX, sanitizeAlarm, sanitizeTodo } from '../src/shared/types';

const withTempStore = (fn: (store: SettingsStore, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-e-'));
  const original = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = dir;
  try {
    fn(new SettingsStore(), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) {
      delete process.env.EYEPROTECT_DATA_DIR;
    } else {
      process.env.EYEPROTECT_DATA_DIR = original;
    }
  }
};

test('todo mutations emit only todos-changed, never the settings cascade', () => {
  withTempStore((store) => {
    let settingsEvents = 0;
    let todoEvents = 0;
    store.onChanged(() => {
      settingsEvents += 1;
    });
    store.on('todos-changed', () => {
      todoEvents += 1;
    });

    const [todo] = store.addTodo('first');
    store.toggleTodo(todo.id);
    store.updateTodo(todo.id, 'edited');
    store.setTodoPriority(todo.id, 'urgent');
    store.removeTodo(todo.id);

    assert.equal(settingsEvents, 0, 'no settings cascade for todo work');
    assert.equal(todoEvents, 5, 'each mutation announces itself once');
  });
});

test('save emits the settings cascade exactly once, with previous values', () => {
  withTempStore((store) => {
    const payloads: Array<{ settings: { eyeIntervalMinutes: number }; previous: { eyeIntervalMinutes: number } }> = [];
    store.onChanged((payload) => payloads.push(payload));

    const next = store.save({ eyeIntervalMinutes: 30 });

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].previous.eyeIntervalMinutes, 20);
    assert.equal(payloads[0].settings.eyeIntervalMinutes, 30);
    assert.equal(next.eyeIntervalMinutes, 30);
  });
});

test('savePetPosition persists without emitting anything', () => {
  withTempStore((store, dir) => {
    let events = 0;
    store.onChanged(() => {
      events += 1;
    });
    store.on('todos-changed', () => {
      events += 1;
    });

    store.savePetPosition({ x: 12, y: 34 }, 'layout-a');

    assert.equal(events, 0, 'dragging the pet broadcasts nothing');
    assert.deepEqual(store.get().petPosition, { x: 12, y: 34 });
    assert.deepEqual(store.get().petPositionsByLayout['layout-a'], { x: 12, y: 34 });

    // A fresh store sees the persisted position.
    const reopened = new SettingsStore();
    assert.deepEqual(reopened.get().petPosition, { x: 12, y: 34 });
    assert.deepEqual(reopened.get().petPositionsByLayout['layout-a'], { x: 12, y: 34 });
    assert.ok(existsSync(join(dir, 'settings.json')));
  });
});

test('legacy alarm mutations neither cascade nor repopulate preference storage', () => {
  withTempStore((store) => {
    let settingsEvents = 0;
    store.onChanged(() => {
      settingsEvents += 1;
    });

    store.persistAlarms([
      { id: 'a1', hour: 7, minute: 30, repeat: 'daily', enabled: true, createdAt: 1 }
    ]);

    assert.equal(settingsEvents, 0, 'alarm persistence is silent');
    assert.equal(new SettingsStore().get().alarms.length, 0, 'legacy alarms stay out of settings.json');
  });
});

test('get() deep-copies alarms, todos and position so callers cannot mutate the store', () => {
  withTempStore((store) => {
    store.persistAlarms([
      { id: 'a1', hour: 7, minute: 30, label: 'wake', repeat: 'daily', enabled: true, createdAt: 1 }
    ]);
    const [todo] = store.addTodo('untouched');
    store.savePetPosition({ x: 1, y: 2 });

    const copy = store.get();
    copy.alarms[0].hour = 23;
    copy.alarms.push({ id: 'x', hour: 1, minute: 1, repeat: 'once', enabled: true, createdAt: 2 });
    copy.todos[0].text = 'hacked';
    copy.todos.push(todo);
    if (copy.petPosition) {
      copy.petPosition.x = 999;
    }
    copy.petPositionsByLayout.fake = { x: 10, y: 20 };

    const fresh = store.get();
    assert.equal(fresh.alarms.length, 1);
    assert.equal(fresh.alarms[0].hour, 7);
    assert.equal(fresh.todos.length, 1);
    assert.equal(fresh.todos[0].text, 'untouched');
    assert.deepEqual(fresh.petPosition, { x: 1, y: 2 });
    assert.equal(fresh.petPositionsByLayout.fake, undefined);
  });
});

test('clearCompletedTodos removes only completed items and emits once', () => {
  withTempStore((store) => {
    const [a] = store.addTodo('keep');
    const [, b] = store.addTodo('done'); // addTodo returns the whole list
    store.toggleTodo(b.id);

    let events = 0;
    store.on('todos-changed', () => {
      events += 1;
    });

    const remaining = store.clearCompletedTodos();
    assert.deepEqual(remaining.map((todo) => todo.id), [a.id]);
    assert.equal(events, 1);

    // Nothing completed left: silent no-op.
    assert.equal(store.clearCompletedTodos().length, 1);
    assert.equal(events, 1);
  });
});

test('a corrupt settings.json is quarantined instead of silently lost', () => {
  withTempStore((_store, dir) => {
    writeFileSync(join(dir, 'settings.json'), '{ broken json', 'utf8');

    const store = new SettingsStore();
    assert.equal(store.get().eyeIntervalMinutes, 20, 'falls back to defaults');

    const backups = readdirSync(dir).filter((name) => name.startsWith('settings.json.corrupt-'));
    assert.equal(backups.length, 1, 'the broken file is preserved as evidence');
    assert.equal(existsSync(join(dir, 'settings.json')), false);
  });
});

test('settings are written with a schema version stamp', () => {
  withTempStore((store, dir) => {
    store.save({ snoozeMinutes: 9 });
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.snoozeMinutes, 9);
    assert.equal('todos' in raw, false);
    assert.equal('alarms' in raw, false);
    assert.equal('activeTaskId' in raw, false);
  });
});

test('history preferences use privacy-safe defaults and only accept supported retention', () => {
  assert.equal(sanitizeSettings({}).historyEnabled, true);
  assert.equal(sanitizeSettings({}).historyRetentionDays, 30);
  assert.equal(sanitizeSettings({ historyEnabled: false }).historyEnabled, false);
  assert.equal(sanitizeSettings({ historyRetentionDays: 90 }).historyRetentionDays, 90);
  assert.equal(
    sanitizeSettings({ historyRetentionDays: 365 as 30 }).historyRetentionDays,
    30
  );
});

test('activity threshold, theme and density use bounded supported values', () => {
  const defaults = sanitizeSettings({});
  assert.equal(defaults.naturalBreakMinutes, 5);
  assert.equal(defaults.theme, 'system');
  assert.equal(defaults.density, 'comfortable');

  assert.equal(sanitizeSettings({ naturalBreakMinutes: -4 }).naturalBreakMinutes, 1);
  assert.equal(sanitizeSettings({ naturalBreakMinutes: 90 }).naturalBreakMinutes, 30);
  assert.equal(defaults.dailyCapacityMinutes, 360);
  assert.equal(sanitizeSettings({ dailyCapacityMinutes: 12 }).dailyCapacityMinutes, 60);
  assert.equal(sanitizeSettings({ dailyCapacityMinutes: 5000 }).dailyCapacityMinutes, 960);
  assert.equal(sanitizeSettings({ dailyCapacityMinutes: 'lots' }).dailyCapacityMinutes, 360);
  assert.equal(sanitizeSettings({ theme: 'dark', density: 'compact' }).theme, 'dark');
  assert.equal(sanitizeSettings({ theme: 'dark', density: 'compact' }).density, 'compact');
  assert.equal(sanitizeSettings({ theme: 'neon', density: 'tiny' }).theme, 'system');
  assert.equal(sanitizeSettings({ theme: 'neon', density: 'tiny' }).density, 'comfortable');
});

test('scene and adaptive preferences sanitize times and executable names without paths', () => {
  const defaults = sanitizeSettings({});
  assert.equal(defaults.adaptiveEnabled, false);
  assert.equal(defaults.quietHoursEnabled, false);
  assert.equal(defaults.quietHoursStartMinutes, 22 * 60);
  assert.equal(defaults.quietHoursEndMinutes, 8 * 60);
  assert.equal(defaults.foregroundDetectionEnabled, false);
  assert.deepEqual(defaults.quietAppWhitelist, []);
  assert.equal(defaults.hotkeysEnabled, true);

  const sanitized = sanitizeSettings({
    adaptiveEnabled: true,
    quietHoursEnabled: true,
    quietHoursStartMinutes: -50,
    quietHoursEndMinutes: 4_000,
    foregroundDetectionEnabled: true,
    hotkeysEnabled: false,
    quietAppWhitelist: [
      ' C:\\Program Files\\Microsoft Office\\POWERPNT.EXE ',
      'powerpnt',
      ' Zoom.exe ',
      '',
      42 as unknown as string
    ]
  });
  assert.equal(sanitized.adaptiveEnabled, true);
  assert.equal(sanitized.quietHoursStartMinutes, 0);
  assert.equal(sanitized.quietHoursEndMinutes, 24 * 60 - 1);
  assert.deepEqual(sanitized.quietAppWhitelist, ['powerpnt', 'zoom']);
  assert.equal(sanitized.hotkeysEnabled, false);
});

test('sanitizeTodo trims, caps and drops whitespace-only text', () => {
  assert.equal(sanitizeTodo({ id: 'a', text: '   ', createdAt: 1 }), null);
  assert.equal(sanitizeTodo({ id: 'a', text: '  喝水  ', createdAt: 1 })?.text, '喝水');
  assert.equal(
    sanitizeTodo({ id: 'a', text: 'z'.repeat(TODO_TEXT_MAX + 40), createdAt: 1 })?.text.length,
    TODO_TEXT_MAX
  );
  assert.ok(
    Number.isFinite(sanitizeTodo({ id: 'a', text: 'x', createdAt: Number.NaN })?.createdAt),
    'non-finite timestamps fall back to now'
  );
});

test('sanitizeAlarm caps and trims labels, rejects non-finite timestamps', () => {
  const alarm = sanitizeAlarm({
    id: 'a1',
    hour: 7,
    minute: 0,
    label: `  ${'x'.repeat(ALARM_LABEL_MAX + 10)}  `,
    repeat: 'once',
    enabled: true,
    createdAt: Number.POSITIVE_INFINITY
  });
  assert.equal(alarm?.label?.length, ALARM_LABEL_MAX);
  assert.ok(Number.isFinite(alarm?.createdAt));
});
