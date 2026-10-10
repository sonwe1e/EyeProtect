import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildCareStatus,
  buildRestCompanion,
  buildWeeklyReport,
  ReminderHistoryStore,
  sanitizeReminderEvent,
  summarizeEvents
} from '../src/main/reminderHistory';
import { DEFAULT_SETTINGS, type ReminderEvent, type Settings } from '../src/shared/types';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = new Date(2026, 6, 29, 12, 0, 0, 0).getTime();

const event = (
  action: ReminderEvent['action'],
  timestamp: number = NOW,
  kind: ReminderEvent['kind'] = 'eye'
): ReminderEvent => ({
  timestamp,
  kind,
  scheduledAt: timestamp - 1_000,
  shownAt: timestamp - 500,
  action,
  snoozeCount: action === 'snooze' ? 1 : 0,
  mode: 'guided'
});

const settings = (
  overrides: Partial<Settings> = {}
): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

const withStore = (run: (store: ReminderHistoryStore, dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-history-'));
  try {
    run(new ReminderHistoryStore(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('sanitizeReminderEvent rejects malformed records and keeps valid records', () => {
  assert.equal(sanitizeReminderEvent(null), null);
  assert.equal(sanitizeReminderEvent({ ...event('complete'), timestamp: Number.NaN }), null);
  assert.deepEqual(sanitizeReminderEvent(event('skip')), event('skip'));
});

test('summarizeEvents reports actions, completion rate, kinds and skipped hour', () => {
  const events = [
    event('complete', NOW - 4_000, 'combined'),
    event('complete', NOW - 3_000, 'eye'),
    event('snooze', NOW - 2_000, 'walk'),
    event('skip', NOW - 1_000, 'walk'),
    event('natural-break', NOW, 'eye')
  ];
  const stats = summarizeEvents(events, NOW - 10_000, NOW + 1);

  assert.equal(stats.total, 5);
  assert.equal(stats.complete, 2);
  assert.equal(stats.snooze, 1);
  assert.equal(stats.skip, 1);
  assert.equal(stats.naturalBreak, 1);
  assert.equal(stats.eyeComplete, 2);
  assert.equal(stats.walkComplete, 1);
  assert.equal(stats.completionRate, 0.5);
  assert.equal(stats.mostSkippedHour, 11);
});

test('weekly activity streak ends at a natural break or a gap over two hours', () => {
  const minute = 60_000;
  const events = [
    event('complete', NOW - 5 * 60 * minute),
    event('complete', NOW - 4 * 60 * minute),
    event('natural-break', NOW - 3.5 * 60 * minute),
    event('complete', NOW - 90 * minute),
    event('complete', NOW)
  ];
  const stats = summarizeEvents(events, NOW - 6 * 60 * minute, NOW + 1);
  assert.equal(stats.longestActiveMinutes, 90);
});

test('weekly report compares weeks and keeps recommendations inside the 20 percent boundary', () => {
  const difficultEye = Array.from({ length: 5 }, (_, index) =>
    event(index < 3 ? 'skip' : 'complete', NOW - index * 1_000, 'eye')
  );
  const previousComplete = event('complete', NOW - 8 * DAY_MS, 'walk');
  const report = buildWeeklyReport(
    [...difficultEye, previousComplete],
    settings({ eyeIntervalMinutes: 20, walkIntervalMinutes: 60 }),
    NOW
  );

  assert.equal(report.current.complete, 2);
  assert.equal(report.previous.complete, 1);
  assert.equal(report.completedDelta, 1);
  assert.equal(report.recommendedEyeMinutes, 24);
  assert.equal(report.recommendedWalkMinutes, 60);
});

test('long uninterrupted work shortens only the next interval within bounds', () => {
  const events = Array.from({ length: 6 }, (_, index) =>
    event('complete', NOW - index * 30 * 60_000, 'eye')
  );
  const report = buildWeeklyReport(events, settings({ eyeIntervalMinutes: 20 }), NOW);
  assert.equal(report.recommendedEyeMinutes, 18);
  assert.match(report.recommendationReason, /连续活跃/);
});

test('consecutive afternoon snoozes temporarily recommend gentle mode', () => {
  const afternoon = new Date(2026, 6, 29, 15, 0, 0, 0).getTime();
  const report = buildWeeklyReport(
    [
      event('snooze', afternoon - 60_000, 'eye'),
      event('snooze', afternoon - 2 * 60_000, 'eye')
    ],
    settings({ reminderMode: 'focused' }),
    afternoon
  );
  assert.equal(report.recommendedMode, 'gentle');
  assert.match(report.recommendationReason, /下午连续/);
});

test('care status is low pressure and celebrates recent completion', () => {
  assert.equal(buildCareStatus([], NOW).score, 50);

  const completed = Array.from({ length: 5 }, (_, index) =>
    event('complete', NOW - index * 1_000, index % 2 === 0 ? 'eye' : 'walk')
  );
  const care = buildCareStatus(completed, NOW);
  assert.equal(care.completedToday, 5);
  assert.equal(care.score, 100);
});

test('postponing or skipping never lowers care or changes it into a reprimand', () => {
  const positive = [event('complete', NOW - 60_000)];
  const baseline = buildCareStatus(positive, NOW);
  const mixed = buildCareStatus([...positive, ...Array.from({ length: 10 }, () => event('skip')), event('snooze')], NOW);
  assert.equal(mixed.score, baseline.score);
  assert.equal(mixed.message, baseline.message);
  assert.equal(buildCareStatus([event('skip'), event('snooze')], NOW).message, buildCareStatus([], NOW).message);
});

test('weekly companion uses Monday through Sunday and counts combined completion once', () => {
  const monday = new Date(2026, 6, 27, 0).getTime();
  const summary = buildRestCompanion([
    event('complete', monday, 'combined'), event('complete', NOW),
    event('skip', NOW), event('snooze', NOW), event('natural-break', NOW),
    event('complete', monday - 1), event('complete', NOW + 1)
  ], true, NOW);
  assert.equal(summary.completed, 2);
  assert.deepEqual(summary.days.map((day) => day.completed), [1, 0, 1, 0, 0, 0, 0]);
  assert.equal(summary.days[0].date, '2026-07-27');
  assert.equal(summary.days[6].date, '2026-08-02');
  assert.doesNotMatch(summary.message, /跳过|推迟|扣|少|目标|分数/);
});

test('disabled and empty histories give neutral encouragement', () => {
  assert.equal(buildRestCompanion([], true, NOW).completed, 0);
  assert.match(buildRestCompanion([], true, NOW).message, /自己的节奏/);
  const disabled = buildRestCompanion([event('complete')], false, NOW);
  assert.equal(disabled.enabled, false);
  assert.match(disabled.message, /已关闭/);
});

test('history store persists, prunes, exports and clears local records', () => {
  withStore((store, dir) => {
    const seen: number[] = [];
    store.onChanged(() => seen.push(store.getEvents().length));
    store.record(event('complete', NOW - 40 * DAY_MS), settings({ historyRetentionDays: 30 }));
    store.record(event('skip', NOW), settings({ historyRetentionDays: 30 }));

    assert.equal(store.getEvents().length, 1, 'second record prunes data older than retention');
    assert.equal(new ReminderHistoryStore(dir).getEvents().length, 1, 'history reloads from disk');
    assert.match(store.export('csv'), /timestamp,kind,scheduledAt/);
    assert.match(store.export('json'), /"action": "skip"/);

    store.clear();
    assert.equal(store.getEvents().length, 0);
    assert.deepEqual(seen, [1, 1, 0]);
  });
});

test('disabled history writes nothing and a corrupt file is quarantined', () => {
  withStore((store, dir) => {
    store.record(event('complete'), settings({ historyEnabled: false }));
    assert.equal(store.getEvents().length, 0);
    assert.equal(existsSync(join(dir, 'reminder-history.json')), false);

    writeFileSync(join(dir, 'reminder-history.json'), '{broken', 'utf8');
    const recovered = new ReminderHistoryStore(dir);
    assert.equal(recovered.getEvents().length, 0);
    assert.ok(
      readdirSync(dir).some((name) => name.startsWith('reminder-history.json.corrupt-')),
      'broken history is kept for recovery'
    );
  });
});
