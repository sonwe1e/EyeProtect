import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRestDuration,
  activityAnimalAction,
  restActivityStates,
  getActivityProgress,
  restAnimalAction,
  restCountdown,
  restKindCopy,
  restLede,
  restPhase
} from '../src/renderer/src/features/reminders/restViewModel';
import {
  CAPTION_POOLS,
  COMBINED_PHASE_TITLES,
  EGG_POOLS,
  FINISHED_TITLE_POOLS,
  HYDRATION_BUBBLE_LINES,
  HYDRATION_LEGENDARY_LINES,
  HYDRATION_RARE_LINES,
  LEGENDARY_TITLE_POOLS,
  fnv1a,
  hydrationBubbleLine,
  pickLine,
  pickTier,
  pickTierName,
  pickWithEggs,
  restCaptionLine,
  restTitleLine
} from '../src/renderer/src/features/reminders/restCopyPool';
import { DEFAULT_SETTINGS, type ActiveReminder, type BreakActivity, type ReminderKind } from '../src/shared/types';
import { BREAK_ACTIVITIES } from '../src/shared/breakActivities';

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

test('lede copy is shared between the alert window and the gentle bubble', () => {
  assert.equal(restLede('ready', 30), '准备好后，点击开始休息。');
  assert.equal(
    restLede('ready', 30, { mergedWithPomodoro: true }),
    '将与本轮番茄休息合并，点击开始休息。'
  );
  assert.equal(restLede('finished', 0), '这次休息时间已到');
  assert.equal(restLede('resting', 12), '还有 12 秒，跟着节奏放松');
});

test('animal action stays idle until the break starts', () => {
  assert.equal(restAnimalAction('combined', 'ready'), 'idle');
  assert.equal(restAnimalAction('combined', 'resting'), 'combined');
  assert.equal(restAnimalAction('walk', 'finished'), 'celebrate');
});

test('every built-in rest step carries its matching animal action', () => {
  for (const activity of BREAK_ACTIVITIES) {
    assert.equal(activity.stepActions?.length, activity.steps.length);
    activity.steps.forEach((_text, index) => assert.equal(activityAnimalAction(activity, index), activity.stepActions![index]));
  }
  const far = BREAK_ACTIVITIES.find((activity) => activity.id === 'eye-far-gaze')!;
  assert.equal(activityAnimalAction(far, 0), 'gaze');
  assert.equal(activityAnimalAction(far, 2), 'blink');
  assert.equal(activityAnimalAction({ ...far, stepActions: undefined }, 1), 'eye');
});

test('combined activities run sequentially inside the actual rest duration', () => {
  const eye = BREAK_ACTIVITIES[0];
  const walk = BREAK_ACTIVITIES.find((activity) => activity.id === 'walk-in-place')!;
  const at = 1_000_000;
  const first = restActivityStates([eye, walk], at, at + 60_000, at + 19_999);
  assert.equal(first[0].step.complete, false);
  assert.equal(first[1].step.progress, 0);
  const second = restActivityStates([eye, walk], at, at + 60_000, at + 20_000);
  assert.equal(second[0].step.complete, true);
  assert.equal(second[1].step.stepIndex, 0);
  const final = restActivityStates([eye, walk], at, at + 60_000, at + 60_000);
  assert.ok(final.every((entry) => entry.step.complete));
  assert.deepEqual(restActivityStates([], at, at, at), []);
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

test('activity steps are spread evenly across the suggested duration', () => {
  // 30s over 3 steps: one step per 10s, and the last step holds to the end.
  const activity: BreakActivity = { id: 'a', kind: 'eye', title: 't', steps: ['一', '二', '三'], durationSeconds: 30, tags: [] };
  const startedAt = 1_000_000;

  assert.deepEqual(getActivityProgress(activity, startedAt, startedAt), {
    stepIndex: 0,
    complete: false,
    progress: 0
  });
  assert.equal(getActivityProgress(activity, startedAt, startedAt + 9_999).stepIndex, 0);
  assert.equal(getActivityProgress(activity, startedAt, startedAt + 10_000).stepIndex, 1);
  assert.equal(getActivityProgress(activity, startedAt, startedAt + 20_000).stepIndex, 2);
  // Never index past the final step, and clamp a clock that ran backwards.
  assert.equal(getActivityProgress(activity, startedAt, startedAt + 999_999).stepIndex, 2);
  assert.equal(getActivityProgress(activity, startedAt, startedAt - 5_000).stepIndex, 0);
});

test('activity progress reports completion at the suggested duration', () => {
  const activity: BreakActivity = { id: 'a', kind: 'walk', title: 't', steps: ['一', '二'], durationSeconds: 60, tags: [] };
  const startedAt = 2_000_000;
  assert.equal(getActivityProgress(activity, startedAt, startedAt + 59_000).complete, false);
  assert.equal(getActivityProgress(activity, startedAt, startedAt + 60_000).complete, true);
  assert.equal(getActivityProgress(activity, startedAt, startedAt + 60_000).progress, 1);
});

// ── quirk copy pool (restCopyPool.ts, ux interaction-spec §5.2) ─────────────

test('fnv1a matches the FNV-1a reference vectors', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
});

test('every pool line meets the quirk constraints', () => {
  const KINDS: ReminderKind[] = ['eye', 'walk', 'combined'];
  // combined owns no rare pool of its own (it draws from the eye+walk merge at
  // pick time); its legendary pool is its own (ux §10.2), so the merged rare
  // surface is audited as one entry below.
  const pools: Array<{ lines: readonly string[]; max: number; label: string }> = [
    ...KINDS.map((kind) => ({ lines: FINISHED_TITLE_POOLS[kind], max: 14, label: `${kind} finished title` })),
    ...(['eye', 'walk'] as const).map((kind) => ({ lines: EGG_POOLS[kind], max: 14, label: `${kind} rare` })),
    { lines: [...EGG_POOLS.eye, ...EGG_POOLS.walk], max: 14, label: 'combined merged rare' },
    ...KINDS.map((kind) => ({ lines: LEGENDARY_TITLE_POOLS[kind], max: 14, label: `${kind} legendary title` })),
    ...(['ready', 'resting'] as const).map((phase) => ({
      lines: COMBINED_PHASE_TITLES[phase],
      max: 14,
      label: `combined ${phase} title`
    })),
    ...(['eye', 'walk'] as const).flatMap((kind) =>
      (['ready', 'resting'] as const).map((phase) => ({
        lines: CAPTION_POOLS[kind][phase],
        max: 12,
        label: `${kind} ${phase} caption`
      }))
    ),
    { lines: HYDRATION_BUBBLE_LINES, max: 16, label: 'hydration common' },
    { lines: HYDRATION_RARE_LINES, max: 16, label: 'hydration rare' },
    { lines: HYDRATION_LEGENDARY_LINES, max: 16, label: 'hydration legendary' }
  ];
  const noEmoji = /\p{Extended_Pictographic}/u;
  const banned: Array<[RegExp, string]> = [
    [/[%％]/, 'percent / statistics'],
    [/全勤|打卡|绩效/, 'scoring wording']
  ];
  for (const { lines, max, label } of pools) {
    assert.ok(lines.length > 0, `${label} pool must not be empty`);
    assert.equal(new Set(lines).size, lines.length, `${label} pool must not repeat a line`);
    for (const line of lines) {
      assert.ok(line.length > 0, `${label} line must be non-empty`);
      assert.equal(noEmoji.test(line), false, `${label} line must not contain an emoji: ${line}`);
      assert.ok(line.length <= max, `${label} line must be ≤${max} chars: ${line}`);
      for (const [pattern, why] of banned) {
        assert.equal(pattern.test(line), false, `${label} line must avoid ${why}: ${line}`);
      }
    }
  }
});

test('line choice is deterministic and in-bounds', () => {
  for (const key of ['a', 'reminder-7', 'x|y|z|title']) {
    assert.equal(pickLine(HYDRATION_BUBBLE_LINES, key), pickLine(HYDRATION_BUBBLE_LINES, key));
  }
  const pair = ['甲', '乙'];
  const hits = new Set<string>();
  for (let n = 0; n < 200; n += 1) {
    const key = `r-${n}`;
    const line = pickLine(pair, key);
    assert.ok(pair.includes(line), `pick for ${key} must be a pool member`);
    hits.add(line);
    assert.equal(restTitleLine(`r-${n}`, 'combined', 'resting'), restTitleLine(`r-${n}`, 'combined', 'resting'));
  }
  assert.equal(hits.size, 2, 'a 2-line pool must not degenerate to a single line');
});

test('pickWithEggs keeps the released 10% band anchor', () => {
  // Compatibility anchor (ux §12.3): the deprecated wrapper's semantics are
  // untouched by the Round 2 tier migration.
  const eggs = EGG_POOLS.eye;
  const finished = FINISHED_TITLE_POOLS.eye;
  for (const egg of eggs) assert.equal(finished.includes(egg), false, 'rare lines must not duplicate common lines');
  let bandHits = 0;
  for (let n = 0; n < 1000; n += 1) {
    const key = `reminder-${n}`;
    const inBand = fnv1a(key) % 100 < 10;
    const line = pickWithEggs(finished, eggs, key);
    if (inBand) {
      bandHits += 1;
      assert.ok(eggs.includes(line), `band hit ${key} must return a rare line`);
    } else {
      assert.ok(finished.includes(line), `band miss ${key} must return a common line`);
    }
  }
  assert.ok(bandHits >= 50 && bandHits <= 150, `easter-egg frequency must land in [5%, 15%], got ${bandHits / 10}%`);
});

test('finished titles land in three exclusive tiers (ux §9 / §12.1)', () => {
  const KINDS: ReminderKind[] = ['eye', 'walk', 'combined'];
  const rareFor = (kind: ReminderKind): readonly string[] =>
    kind === 'combined' ? [...EGG_POOLS.eye, ...EGG_POOLS.walk] : EGG_POOLS[kind];
  // Per-kind pools are pairwise disjoint.
  for (const kind of KINDS) {
    const rare = rareFor(kind);
    const legendary = LEGENDARY_TITLE_POOLS[kind];
    const common = FINISHED_TITLE_POOLS[kind];
    for (const rareLine of rare) {
      assert.equal(common.includes(rareLine), false, `${kind} rare must not duplicate common`);
      assert.equal(legendary.includes(rareLine), false, `${kind} rare must not duplicate legendary`);
    }
    for (const legendaryLine of legendary) {
      assert.equal(common.includes(legendaryLine), false, `${kind} legendary must not duplicate common`);
    }
  }
  // Sweep 1000 ids: pickTierName mirrors the band math, and each pick lands in
  // the named tier with the §12.1 frequency windows.
  const counts = { common: 0, rare: 0, legendary: 0 };
  for (let n = 0; n < 1000; n += 1) {
    const id = `reminder-${n}`;
    const key = `${id}|eye|finished|title`;
    const band = fnv1a(key) % 100;
    const expected = band < 85 ? 'common' : band < 97 ? 'rare' : 'legendary';
    assert.equal(pickTierName(key), expected, `tier name must mirror the band math for ${key}`);
    const line = restTitleLine(id, 'eye', 'finished');
    if (expected === 'legendary') {
      counts.legendary += 1;
      assert.ok(LEGENDARY_TITLE_POOLS.eye.includes(line), `legendary hit ${id} must return a legendary line`);
    } else if (expected === 'rare') {
      counts.rare += 1;
      assert.ok(rareFor('eye').includes(line), `rare hit ${id} must return a rare line`);
    } else {
      counts.common += 1;
      assert.ok(FINISHED_TITLE_POOLS.eye.includes(line), `common ${id} must return a common line`);
    }
  }
  assert.ok(counts.legendary >= 10 && counts.legendary <= 50, `legendary frequency must land in [1%, 5%], got ${counts.legendary / 10}%`);
  assert.ok(counts.rare >= 90 && counts.rare <= 150, `rare frequency must land in [9%, 15%], got ${counts.rare / 10}%`);
  assert.ok(counts.common >= 800, `common must cover ≥80%, got ${counts.common / 10}%`);
  // Combined draws its rare lines from the merged eye+walk surface.
  const merged = [...EGG_POOLS.eye, ...EGG_POOLS.walk];
  for (let n = 0; n < 300; n += 1) {
    const id = `combined-${n}`;
    if (pickTierName(`${id}|combined|finished|title`) === 'rare') {
      assert.ok(merged.includes(restTitleLine(id, 'combined', 'finished')), `combined rare ${id} must come from the merged pool`);
    }
  }
  // Fallback chain never returns empty (ux §9.2): a tierless pool serves common
  // to every key, and a missing rare pool serves common on the rare band.
  const tierless = { common: ['甲', '乙'] };
  for (let n = 0; n < 300; n += 1) {
    const key = `tierless-${n}`;
    assert.ok(tierless.common.includes(pickTier(tierless, key)), `tierless pick for ${key} must fall back to common`);
  }
  const noRare = { common: ['丙'], legendary: ['丁'] };
  for (let n = 0; n < 300; n += 1) {
    const key = `norare-${n}`;
    if (pickTierName(key) === 'rare') {
      assert.equal(pickTier(noRare, key), '丙', 'a rare hit with no rare pool falls back to common (§9.2)');
    }
  }
});

test('slot coverage matches the merged decision: eye/walk keep instructional titles', () => {
  // eye/walk ready/resting return '' so AlertView keeps suggestion?.title.
  assert.equal(restTitleLine('r-1', 'eye', 'ready'), '');
  assert.equal(restTitleLine('r-1', 'walk', 'resting'), '');
  assert.notEqual(restTitleLine('r-1', 'combined', 'ready'), '');
  assert.notEqual(restTitleLine('r-1', 'combined', 'resting'), '');
  // Captions exist only for eye/walk ready/resting; combined/finished stay fixed.
  assert.notEqual(restCaptionLine('r-1', 'eye', 'ready'), '');
  assert.notEqual(restCaptionLine('r-1', 'walk', 'resting'), '');
  assert.equal(restCaptionLine('r-1', 'combined', 'ready'), '');
});

test('hydration strip lines are deterministic and reachable per prompt id', () => {
  // Quantified paradigm (Phase 3): sweep synthetic prompt ids — every pick is
  // deterministic and in-pool across all three tiers, and the pools must not
  // degenerate to one line. No assertion binds a specific id to a specific
  // line (that would be a hash coincidence, not a contract).
  const allTiers = [...HYDRATION_BUBBLE_LINES, ...HYDRATION_RARE_LINES, ...HYDRATION_LEGENDARY_LINES];
  const distinct = new Set<string>();
  for (let n = 0; n < 100; n += 1) {
    const line = hydrationBubbleLine(`h-${n}`);
    assert.ok(allTiers.includes(line), `pick for h-${n} must be a pool member`);
    assert.equal(hydrationBubbleLine(`h-${n}`), line, 'same id must keep its line');
    distinct.add(line);
  }
  assert.ok(distinct.size >= 2, 'the hydration pool must stay reachable, not collapsed to one line');
});
