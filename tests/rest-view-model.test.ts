import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRestDuration,
  restAnimalAction,
  restCountdown,
  restKindCopy,
  restPhase
} from '../src/renderer/src/features/reminders/restViewModel';
import { DEFAULT_SETTINGS, type ActiveReminder, type ReminderKind } from '../src/shared/types';

const settings = { ...DEFAULT_SETTINGS, eyeRestSeconds: 30, walkRestSeconds: 60 };

const makeReminder = (kind: ReminderKind, overrides: Partial<ActiveReminder> = {}): ActiveReminder => ({
  id: 'reminder-1',
  kind,
  kinds: kind === 'combined' ? ['eye', 'walk'] : [kind],
  startedAt: 1_000_000,
  restStartedAt: null,
  scheduledAt: 1_000_000,
  unlockAt: 1_030_000,
  snoozeAllowedAt: 1_000_000,
  mode: 'focused',
  snoozeCount: 0,
  activityIds: [],
  breakTask: null,
  ...overrides
});

test('every reminder kind has complete, distinct copy', () => {
  const kinds: ReminderKind[] = ['eye', 'walk', 'combined'];
  const titles = new Set(kinds.map((kind) => restKindCopy(kind).title));
  assert.equal(titles.size, 3);
  for (const kind of kinds) {
    const copy = restKindCopy(kind);
    assert.ok(copy.badge.length > 0, `${kind} badge`);
    assert.ok(copy.title.length > 0, `${kind} title`);
    assert.ok(copy.caption.length > 0, `${kind} caption`);
  }
});

test('phase follows restStartedAt and unlockAt only', () => {
  const ready = makeReminder('eye');
  assert.equal(restPhase(ready, ready.startedAt), 'ready');

  const started = makeReminder('eye', { restStartedAt: 1_000_000, unlockAt: 1_030_000 });
  assert.equal(restPhase(started, 1_029_999), 'resting');
  assert.equal(restPhase(started, 1_030_000), 'finished');
  assert.equal(restPhase(started, 1_060_000), 'finished');
});

test('before starting, the countdown previews the configured rest', () => {
  assert.deepEqual(restCountdown(makeReminder('eye'), 1_000_000, settings), {
    remainingSeconds: 30,
    totalSeconds: 30,
    progress: 0
  });
  assert.equal(restCountdown(makeReminder('walk'), 1_000_000, settings).totalSeconds, 60);
  // Combined reminders wait out the longer of the two rests.
  assert.equal(restCountdown(makeReminder('combined'), 1_000_000, settings).totalSeconds, 60);
});

test('while resting, progress tracks the main-process unlock window', () => {
  const active = makeReminder('eye', { restStartedAt: 1_000_000, unlockAt: 1_060_000 });
  const halfway = restCountdown(active, 1_030_000, settings);
  assert.equal(halfway.totalSeconds, 60);
  assert.equal(halfway.remainingSeconds, 30);
  assert.equal(halfway.progress, 0.5);

  const done = restCountdown(active, 1_060_000, settings);
  assert.equal(done.remainingSeconds, 0);
  assert.equal(done.progress, 1);

  // A stale/late renderer must never produce a negative countdown.
  const late = restCountdown(active, 1_120_000, settings);
  assert.equal(late.remainingSeconds, 0);
  assert.equal(late.progress, 1);
});

test('countdown reads total from the reminder, not from settings', () => {
  // A pomodoro break merged into the reminder extends unlockAt past the
  // configured eye rest; the ring must span the real window.
  const merged = makeReminder('eye', { restStartedAt: 1_000_000, unlockAt: 1_300_000 });
  const state = restCountdown(merged, 1_000_000, settings);
  assert.equal(state.totalSeconds, 300);
  assert.equal(state.remainingSeconds, 300);
  assert.equal(state.progress, 0);
});

test('animal action stays idle until the break starts', () => {
  assert.equal(restAnimalAction('combined', 'ready'), 'idle');
  assert.equal(restAnimalAction('combined', 'resting'), 'combined');
  assert.equal(restAnimalAction('walk', 'finished'), 'walk');
});

test('durations format as mm:ss and clamp invalid input', () => {
  assert.equal(formatRestDuration(0), '00:00');
  assert.equal(formatRestDuration(5), '00:05');
  assert.equal(formatRestDuration(65), '01:05');
  assert.equal(formatRestDuration(600), '10:00');
  assert.equal(formatRestDuration(-4), '00:00');
  assert.equal(formatRestDuration(Number.NaN), '00:00');
  assert.equal(formatRestDuration(0.4), '00:01');
});
