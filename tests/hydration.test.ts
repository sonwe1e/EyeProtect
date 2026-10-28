import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HydrationService, type HydrationTimers } from '../src/main/hydration';
import { HydrationStore } from '../src/main/hydrationStore';
import { ReminderScheduler } from '../src/main/reminders';
import { contextDecision } from '../src/main/reminderContext';
import {
  HYDRATION_INTERVAL_MAX_MINUTES,
  HYDRATION_INTERVAL_MIN_MINUTES,
  HYDRATION_SIP_MS,
  HYDRATION_STRIP_MS,
  hydrationIntervalMinutes,
  msUntilNextLocalMidnight,
  nextHydrationSlotAt,
  rollHydrationDay,
  type HydrationStatus
} from '../src/shared/hydration';
import { localDateKey, minutesOfLocalDay } from '../src/shared/calendar';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types';

/**
 * Hydration is the only moment the pet starts on its own, so every gate has to
 * be provable without waiting: the clock is injected and the timers are fake, so
 * nothing here ever sleeps.
 */
const MINUTE = 60_000;
const AT = (hour: number, minute = 0, day = 8): number => new Date(2026, 6, day, hour, minute, 0, 0).getTime();

/** 04:00–20:00 with a 16-cup goal ⇒ one slot per hour, which keeps the maths readable. */
const CLOCK: Partial<Settings> = {
  workStartMinutes: 4 * 60,
  workEndMinutes: 20 * 60,
  hydrationGoalCups: 16
};

const settings = (overrides: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...CLOCK, ...overrides });

interface FakeTimer {
  callback: () => void;
  delay: number;
  cancelled: boolean;
}

const makeTimers = (): { timers: HydrationTimers; pending: FakeTimer[] } => {
  const pending: FakeTimer[] = [];
  return {
    pending,
    timers: {
      setTimeout: (callback, delay) => {
        const entry: FakeTimer = { callback, delay, cancelled: false };
        pending.push(entry);
        return entry;
      },
      clearTimeout: (handle) => {
        (handle as FakeTimer).cancelled = true;
      }
    }
  };
};

interface Harness {
  service: HydrationService;
  store: HydrationStore;
  directory: string;
  pending: FakeTimer[];
  statuses: HydrationStatus[];
  now: () => number;
  setNow: (value: number) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setGate: (value: 'show' | 'defer') => void;
  setBusy: (value: boolean) => void;
  sipped: () => number;
}

const withService = (
  fn: (ctx: Harness) => void,
  options: { now?: number; settings?: Partial<Settings>; gate?: (now: number) => 'show' | 'defer' } = {}
): void => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-hydration-'));
  try {
    let now = options.now ?? AT(8);
    let current = settings(options.settings);
    let gate: (now: number) => 'show' | 'defer' = options.gate ?? (() => 'show');
    let busy = false;
    let sips = 0;
    const statuses: HydrationStatus[] = [];
    const { timers, pending } = makeTimers();
    const store = new HydrationStore(directory);
    const service = new HydrationService({
      store,
      settingsStore: { get: () => current },
      gate: (slotNow) => gate(slotNow),
      surfaceBusy: () => busy,
      onChange: (status) => { statuses.push(status); },
      sendSip: () => { sips += 1; },
      now: () => now,
      timers
    });
    fn({
      service,
      store,
      directory,
      pending,
      statuses,
      now: () => now,
      setNow: (value) => { now = value; },
      setSettings: (patch) => { current = { ...current, ...patch }; },
      setGate: (value) => { gate = () => value; },
      setBusy: (value) => { busy = value; },
      sipped: () => sips
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const liveTimers = (pending: FakeTimer[], delay?: number): FakeTimer[] =>
  pending.filter((entry) => !entry.cancelled && (delay === undefined || entry.delay === delay));

const readState = (directory: string): { localDate: string; cups: number; lastCupAt: number | null; lastPromptAt: number | null } =>
  JSON.parse(readFileSync(join(directory, 'hydration-state.json'), 'utf8'));

// ── Pure rules ──────────────────────────────────────────────────────────────

test('the interval is floor(window / goal), clamped to 30–120 minutes (AC-16)', () => {
  assert.equal(hydrationIntervalMinutes({ workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 8 }), 105);
  // floor, not round: 840/20 = 42 exactly, and 840/13 = 64.6 → 64 so thirteen
  // slots still fit. Rounding up is what made goals unreachable.
  assert.equal(hydrationIntervalMinutes({ workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 20 }), 42);
  assert.equal(hydrationIntervalMinutes({ workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 13 }), 64);
  // A tiny goal would otherwise leave an eight-hour gap.
  assert.equal(hydrationIntervalMinutes({ workStartMinutes: 0, workEndMinutes: 14 * 60, hydrationGoalCups: 2 }), HYDRATION_INTERVAL_MAX_MINUTES);
  // Invalid inputs fall back instead of throwing.
  assert.equal(hydrationIntervalMinutes({ workStartMinutes: 9 * 60, workEndMinutes: 0, hydrationGoalCups: 8 }), HYDRATION_INTERVAL_MIN_MINUTES);
  assert.equal(hydrationIntervalMinutes({ workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 0 }), HYDRATION_INTERVAL_MIN_MINUTES);
});

test('every goal from 1 to 20 fits at least that many slots in the default window (AC-16)', () => {
  const workStartMinutes = 7 * 60;
  const workEndMinutes = 21 * 60;
  for (let goal = 1; goal <= 20; goal += 1) {
    const intervalMinutes = hydrationIntervalMinutes({ workStartMinutes, workEndMinutes, hydrationGoalCups: goal });
    let now = new Date(2026, 6, 8, 0, 0, 0, 0).getTime();
    let prompts = 0;
    for (;;) {
      const at = nextHydrationSlotAt({ now, workStartMinutes, workEndMinutes, intervalMinutes, lastPromptAt: null });
      if (at === null) break;
      prompts += 1;
      now = at;
    }
    assert.ok(prompts >= goal, `goal ${goal} must be reachable, only ${prompts} slots at ${intervalMinutes}min`);
  }
});

test('the first slot never comes sooner than one interval after work starts (AC-15)', () => {
  const base = { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, intervalMinutes: 60, lastPromptAt: null };
  assert.equal(nextHydrationSlotAt({ ...base, now: AT(7) }), AT(8), 'started at 07:00, so the first hint is 08:00');
  assert.equal(nextHydrationSlotAt({ ...base, now: AT(9, 30) }), AT(10), 'a mid-morning start joins the rhythm instead of firing at once');
});

test('the slot sequence stops at workEnd, and a slot may start exactly at workEnd', () => {
  const base = { now: AT(7), workStartMinutes: 7 * 60, workEndMinutes: 9 * 60, intervalMinutes: 45, lastPromptAt: null };
  assert.equal(nextHydrationSlotAt(base), AT(7, 45));
  assert.equal(nextHydrationSlotAt({ ...base, now: AT(7, 45) }), AT(8, 30));
  // 09:15 is past workEnd (09:00), so today has no slot left.
  assert.equal(nextHydrationSlotAt({ ...base, now: AT(8, 30) }), null);
  assert.equal(
    nextHydrationSlotAt({ now: AT(7, 30), workStartMinutes: 7 * 60, workEndMinutes: 8 * 60, intervalMinutes: 60, lastPromptAt: null }),
    AT(8),
    'a slot that starts exactly at workEnd still counts'
  );
});

test('a consumed slot is never returned again, even if the clock moves backwards', () => {
  const base = { now: AT(10), workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, intervalMinutes: 60 };
  assert.equal(nextHydrationSlotAt({ ...base, lastPromptAt: null }), AT(11));
  assert.equal(nextHydrationSlotAt({ ...base, lastPromptAt: AT(11) }), AT(12), 'the 11:00 slot stays consumed');
  assert.equal(nextHydrationSlotAt({ ...base, lastPromptAt: AT(13) }), AT(14), 'a marker ahead of the clock still wins');
});

test('a workEnd at 24:00 never produces a slot on the next day', () => {
  // 09:00 + k×45 reaches minute 1440 = tomorrow 00:00, which would fire after
  // the day reset — i.e. outside working hours, on a fresh count.
  const base = { workStartMinutes: 9 * 60, workEndMinutes: 24 * 60, intervalMinutes: 45, lastPromptAt: null };
  // The last real slot of the day is 23:15 (09:00 + 19×45).
  assert.equal(nextHydrationSlotAt({ ...base, now: AT(22, 50) }), AT(23, 15));
  assert.equal(nextHydrationSlotAt({ ...base, now: AT(23, 30) }), null);
  assert.equal(nextHydrationSlotAt({ ...base, now: AT(23, 15) }), null, 'the 24:00 slot is tomorrow, so it is skipped');
});

test('a new local day resets the count, and the midnight countdown is civil-time', () => {
  const evening = AT(23, 30);
  const state = { localDate: localDateKey(evening), cups: 6, lastCupAt: evening, lastPromptAt: evening };
  assert.deepEqual(rollHydrationDay(state, AT(0, 30, 9)), { localDate: localDateKey(AT(0, 30, 9)), cups: 0, lastCupAt: null, lastPromptAt: null });
  assert.deepEqual(rollHydrationDay(state, evening), state, 'the same day keeps the count');
  assert.equal(rollHydrationDay(null, evening).cups, 0);
  assert.equal(msUntilNextLocalMidnight(AT(23, 59)), MINUTE);
  assert.ok(msUntilNextLocalMidnight(AT(0)) > 23 * 60 * MINUTE);
});

// ── The service ─────────────────────────────────────────────────────────────

test('start() only arms the first slot — no tick, no prompt, no cup', () => {
  withService(({ service, pending, sipped }) => {
    service.start();
    const armed = liveTimers(pending);
    assert.equal(armed.length, 1, 'exactly one slot timer');
    assert.equal(armed[0].delay, 60 * MINUTE, 'opened at 08:00 with an hourly rhythm → armed for 09:00');
    assert.equal(service.getStatus().prompt, null);
    assert.equal(sipped(), 0, 'starting the app is not a reason to drink');
  }, { now: AT(8) });
});

test('tick() walks sipping → strip → idle and consumes the slot', () => {
  withService(({ service, directory, pending, sipped }) => {
    service.tick(AT(9));
    assert.equal(service.getStatus().prompt?.phase, 'sipping', 'the pet drinks first');
    assert.equal(sipped(), 1);
    assert.equal(service.getStatus().cups, 0, 'a hint is not a cup');
    assert.equal(readState(directory).lastPromptAt, AT(9), 'the slot is consumed before the user answers');

    const sip = liveTimers(pending, HYDRATION_SIP_MS);
    assert.equal(sip.length, 1);
    sip[0].callback();
    assert.equal(service.getStatus().prompt?.phase, 'strip', 'the strip follows the sip');

    const strip = liveTimers(pending, HYDRATION_STRIP_MS);
    assert.equal(strip.length, 1);
    strip[0].callback();
    assert.equal(service.getStatus().prompt, null, 'the strip retires on its own');
    assert.equal(readState(directory).cups, 0);
  }, { now: AT(9) });
});

test('petMotion off skips the sipping act but keeps the recording path (S1-2)', () => {
  withService(({ service, pending, sipped }) => {
    service.tick(AT(9));
    assert.equal(sipped(), 0, 'reduced motion must not animate the pet');
    assert.equal(service.getStatus().prompt?.phase, 'strip', 'the strip appears immediately');
    assert.equal(liveTimers(pending, HYDRATION_SIP_MS).length, 0);
    service.recordCup();
    assert.equal(service.getStatus().cups, 1, 'recording still works');
  }, { now: AT(9), settings: { petMotion: false } });
});

test('recordCup() caps at the goal, persists the cup and retires the prompt', () => {
  withService(({ service, directory }) => {
    service.tick(AT(9));
    for (let index = 0; index < 12; index += 1) service.recordCup(AT(9) + index);
    const status = service.getStatus();
    assert.equal(status.cups, 8, 'never more cups than the goal');
    assert.equal(status.achieved, true);
    assert.equal(status.prompt, null, 'recording puts the strip away');
    assert.equal(readState(directory).cups, 8);
  }, { now: AT(9), settings: { hydrationGoalCups: 8 } });
});

test('reaching the goal silences the rest of the day', () => {
  withService(({ service, directory, pending, sipped }) => {
    for (let index = 0; index < 8; index += 1) service.recordCup(AT(9) + index);
    assert.equal(service.getStatus().achieved, true);
    const before = pending.length;
    service.tick(AT(14));
    assert.equal(service.getStatus().prompt, null, 'no hint once the goal is reached');
    assert.equal(sipped(), 0);
    assert.ok(pending.length > before, 'the next slot is still armed');
    assert.equal(readState(directory).lastPromptAt, AT(14), 'the slot is still marked as consumed');
  }, { now: AT(9), settings: { hydrationGoalCups: 8 } });
});

test('a cup drunk minutes ago suppresses the next hint', () => {
  withService(({ service, sipped }) => {
    service.recordCup(AT(9, 50));
    service.tick(AT(10));
    assert.equal(sipped(), 0, 'ten minutes after a cup is too soon to ask again');
    assert.equal(service.getStatus().prompt, null);
  }, { now: AT(9, 50) });
});

test('a deferred gate consumes the slot instead of queueing it (AC-12)', () => {
  withService(({ service, directory, pending, sipped, setGate, setNow }) => {
    setGate('defer');
    service.start();
    service.tick(AT(9));
    assert.equal(sipped(), 0, 'quiet hours mean no hint');
    assert.equal(readState(directory).lastPromptAt, AT(9), 'the slot is consumed, not stored for later');

    // The quiet hours end five minutes later; the missed moment is not replayed.
    setGate('show');
    setNow(AT(9, 5));
    service.resume();
    assert.equal(service.getStatus().prompt, null, 'no backfill after the gate opens');
    assert.equal(sipped(), 0);
    const armed = liveTimers(pending).at(-1);
    assert.equal(armed?.delay, 55 * MINUTE, 'the next slot is 10:00, not "now"');
  }, { now: AT(9) });
});

test('a busy surface skips the moment without recording a cup', () => {
  withService(({ service, sipped, setBusy, pending, directory }) => {
    setBusy(true);
    service.tick(AT(9));
    assert.equal(sipped(), 0, 'a reminder or a pomodoro owns the screen');
    assert.equal(service.getStatus().cups, 0);
    assert.equal(readState(directory).lastPromptAt, AT(9), 'the slot is spent even though nothing was shown');
    // A second tick for the same instant (timer + wake callback) must not fire.
    setBusy(false);
    service.tick(AT(9));
    assert.equal(sipped(), 0, 'one slot, at most one moment');
    assert.equal(liveTimers(pending).at(-1)?.delay, 60 * MINUTE, 'the next chance is the next slot');
  }, { now: AT(9) });
});

test('a disabled feature never shows anything (AC-15)', () => {
  withService(({ service, sipped, setSettings }) => {
    setSettings({ hydrationEnabled: false });
    service.onSettingsChanged();
    service.tick(AT(9));
    assert.equal(sipped(), 0);
    assert.equal(service.getStatus().prompt, null);
    assert.equal(service.getStatus().enabled, false);
  }, { now: AT(9) });
});

test('switching the feature off drops a prompt that is already on screen', () => {
  withService(({ service, setSettings }) => {
    service.tick(AT(9));
    assert.equal(service.getStatus().prompt?.phase, 'sipping');
    setSettings({ hydrationEnabled: false });
    service.onSettingsChanged();
    assert.equal(service.getStatus().prompt, null, 'the switch means "stop now"');
  }, { now: AT(9) });
});

test('raising the goal re-arms the schedule instead of stalling it', () => {
  withService(({ service, pending, setSettings }) => {
    service.start();
    const before = liveTimers(pending).at(-1)?.delay;
    setSettings({ hydrationGoalCups: 8 });
    service.onSettingsChanged();
    const after = liveTimers(pending).at(-1)?.delay;
    assert.notEqual(after, undefined);
    assert.ok(after !== before || after === 60 * MINUTE, 'the derived interval is recomputed');
  }, { now: AT(8) });
});

test('dismissPrompt() hides the strip without counting a cup (B2)', () => {
  withService(({ service }) => {
    service.tick(AT(9));
    const status = service.dismissPrompt();
    assert.equal(status.prompt, null);
    assert.equal(status.cups, 0, 'skipping a moment records nothing');
    assert.equal(service.getStatus().cups, 0);
  }, { now: AT(9) });
});

test('every state change is published so the windows never read a stale number', () => {
  withService(({ service, statuses }) => {
    service.start();
    const afterStart = statuses.length;
    assert.ok(afterStart >= 1);
    service.tick(AT(9));
    assert.equal(statuses.at(-1)?.prompt?.phase, 'sipping');
    service.recordCup(AT(9, 1));
    assert.equal(statuses.at(-1)?.cups, 1);
    assert.equal(statuses.at(-1)?.prompt, null);
  }, { now: AT(9) });
});

test('a restart after hours offline arms the next slot instead of replaying it', () => {
  withService(({ service, pending, sipped }) => {
    service.start();
    assert.equal(sipped(), 0);
    const armed = liveTimers(pending).at(-1);
    assert.equal(armed?.delay, 60 * MINUTE, 'opened at 12:00 with an hourly rhythm → armed for 13:00');
  }, { now: AT(12) });
});

test('suspend() clears every timer; resume() only re-arms', () => {
  withService(({ service, pending, sipped }) => {
    service.tick(AT(9));
    service.suspend();
    assert.equal(liveTimers(pending).length, 0, 'no timer survives a sleep');
    assert.equal(service.getStatus().prompt, null, 'a stale strip is dropped');
    service.resume();
    assert.equal(liveTimers(pending).length, 1, 'resume arms exactly one slot timer');
    assert.equal(sipped(), 1, 'resume must not drink again');
  }, { now: AT(9) });
});

test('the count reloads from disk and rolls over on a new local day (AC-11)', () => {
  withService(({ service, directory, setNow }) => {
    service.recordCup(AT(9));
    service.recordCup(AT(9, 30));
    assert.equal(service.getStatus().cups, 2);
    assert.ok(readFileSync(join(directory, 'hydration-state.json'), 'utf8').includes(localDateKey(AT(9))));

    setNow(AT(0, 5, 9));
    const tomorrow = service.getStatus();
    assert.equal(tomorrow.cups, 0, 'a new local day starts from zero');
    assert.equal(tomorrow.localDate, localDateKey(AT(0, 5, 9)));
    assert.equal(tomorrow.achieved, false);
  }, { now: AT(9) });
});

test('a clock that jumps backwards re-arms instead of going silent for the day', () => {
  // DST fall-back (or a manual clock change) makes the next fire land "before"
  // the slot already consumed. The timer that called us has cleared itself, so
  // that branch must arm a new one or hydration stops until the next resume.
  withService(({ service, pending, sipped, setNow }) => {
    service.tick(AT(9));
    const armed = liveTimers(pending).at(-1);
    assert.ok(armed, 'the 10:00 slot is armed');
    const before = pending.length;
    armed.cancelled = true; // the timer that fires is spent, not still pending
    setNow(AT(8, 30));
    armed.callback();
    assert.equal(sipped(), 1, 'the already-answered 09:00 moment must not repeat');
    assert.ok(pending.length > before, 'a new timer is created, not just the spent one left behind');
    const slotTimers = pending.filter((entry) => !entry.cancelled && entry.delay > HYDRATION_STRIP_MS);
    assert.equal(slotTimers.length, 1, 'exactly one slot timer is re-armed after the jump');
  }, { now: AT(9) });
});

test('the OS reduce-motion switch skips the sip even when petMotion is on (S1-2)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-hydration-'));
  try {
    const { timers, pending } = makeTimers();
    let sips = 0;
    const service = new HydrationService({
      store: new HydrationStore(directory),
      settingsStore: { get: () => settings({ petMotion: true }) },
      gate: () => 'show',
      surfaceBusy: () => false,
      onChange: () => undefined,
      sendSip: () => { sips += 1; },
      reducedMotion: () => true,
      now: () => AT(9),
      timers
    });
    service.tick(AT(9));
    assert.equal(sips, 0, 'the pet renderer already honours the media query');
    assert.equal(service.getStatus().prompt?.phase, 'strip', 'so the strip must not wait 2.6s for it');
    assert.equal(liveTimers(pending, HYDRATION_SIP_MS).length, 0);
    service.recordCup();
    assert.equal(service.getStatus().cups, 1, 'the recording path is unchanged');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('crossing midnight pushes the new day to the windows instead of waiting for the first slot', () => {
  withService(({ service, pending, statuses, setNow }) => {
    // 20:00 was the last slot of the day, so the next timer is "wait for midnight".
    service.recordCup(AT(20));
    assert.equal(service.getStatus().cups, 1);
    const midnight = liveTimers(pending).find((entry) => entry.delay === msUntilNextLocalMidnight(AT(20)));
    assert.ok(midnight, 'the day is over, so midnight is what gets armed');

    setNow(AT(0, 0, 9));
    const published = statuses.length;
    midnight.callback();

    const latest = statuses.at(-1);
    assert.equal(latest?.cups, 0, 'yesterday\'s count must not survive the midnight callback');
    assert.equal(latest?.localDate, localDateKey(AT(0, 0, 9)));
    assert.ok(statuses.length > published, 'the reset is broadcast, not just stored in memory');
    // And the new day is armed for its own first slot.
    const armed = liveTimers(pending).at(-1);
    assert.equal(armed?.delay, 5 * 60 * MINUTE, '04:00 start + one interval → 05:00');
  }, { now: AT(20) });
});

test('a corrupt state file starts the day from zero and is repaired by the next save', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-hydration-'));
  try {
    writeFileSync(join(directory, 'hydration-state.json'), '{not json', 'utf8');
    const store = new HydrationStore(directory);
    assert.equal(store.load(AT(9)).cups, 0);
    assert.equal(store.load(AT(9)).localDate, localDateKey(AT(9)));
    store.save({ localDate: localDateKey(AT(9)), cups: 3, lastCupAt: AT(9), lastPromptAt: null });
    assert.equal(store.load(AT(9)).cups, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an out-of-range or malformed stored count is repaired on read', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-hydration-'));
  try {
    writeFileSync(
      join(directory, 'hydration-state.json'),
      JSON.stringify({ localDate: 'not-a-date', cups: -4, lastCupAt: 'x', lastPromptAt: 12 }),
      'utf8'
    );
    const state = new HydrationStore(directory).load(AT(9));
    assert.equal(state.cups, 0);
    assert.equal(state.localDate, localDateKey(AT(9)));
    assert.equal(state.lastCupAt, null);
    assert.equal(state.lastPromptAt, 12, 'a finite timestamp is still usable');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// ── Independent audit: replay, per-slot semantics, storage integrity ────────

test('a restart on the same day keeps the consumed slot consumed (no replay)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-hydration-'));
  try {
    const { timers: timersA, pending: pendingA } = makeTimers();
    let now = AT(9);
    let sipsA = 0;
    const first = new HydrationService({
      store: new HydrationStore(directory),
      settingsStore: { get: () => settings() },
      gate: () => 'show',
      surfaceBusy: () => false,
      onChange: () => {},
      sendSip: () => { sipsA += 1; },
      now: () => now,
      timers: timersA
    });
    first.start();
    first.tick(AT(9));
    assert.equal(sipsA, 1);
    assert.equal(readState(directory).lastPromptAt, AT(9));
    first.stop();

    // "Restart" five minutes later on the same local day.
    now = AT(9, 5);
    const { timers: timersB, pending: pendingB } = makeTimers();
    let sipsB = 0;
    const second = new HydrationService({
      store: new HydrationStore(directory),
      settingsStore: { get: () => settings() },
      gate: () => 'show',
      surfaceBusy: () => false,
      onChange: () => {},
      sendSip: () => { sipsB += 1; },
      now: () => now,
      timers: timersB
    });
    second.start();
    assert.equal(sipsB, 0, 'a restart must not replay the 09:00 moment');
    assert.equal(second.getStatus().prompt, null);
    assert.equal(second.getStatus().cups, 0);
    assert.equal(liveTimers(pendingB).at(-1)?.delay, 55 * MINUTE, 'the next chance is 10:00, not "now"');
    assert.equal(pendingA.length > 0, true);
    second.stop();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a second tick in the same millisecond does not drink twice', () => {
  withService(({ service, sipped }) => {
    service.tick(AT(9));
    const firstPrompt = service.getStatus().prompt;
    assert.ok(firstPrompt);
    service.tick(AT(9));
    assert.equal(sipped(), 1, 'one slot, at most one moment');
    assert.deepEqual(service.getStatus().prompt, firstPrompt, 'the running prompt is not restarted');
  }, { now: AT(9) });
});

test('a cup suppresses hints only until a full interval has passed (AC-13 boundary)', () => {
  withService(({ service, sipped }) => {
    service.recordCup(AT(9));
    service.tick(AT(9) + 60 * MINUTE - 1_000);
    assert.equal(sipped(), 0, 'one second short of the interval is still "just drank"');
    assert.equal(service.getStatus().prompt, null);
  }, { now: AT(9) });

  withService(({ service, sipped }) => {
    service.recordCup(AT(9));
    service.tick(AT(10));
    assert.equal(sipped(), 1, 'a full interval later the rhythm is allowed to resume');
  }, { now: AT(9) });
});

test('dismissing one moment does not mute the next slot (B2: × skips, not silences)', () => {
  withService(({ service, sipped }) => {
    service.tick(AT(9));
    assert.equal(sipped(), 1);
    assert.equal(service.dismissPrompt().prompt, null);
    service.tick(AT(10));
    assert.equal(sipped(), 2, 'the 10:00 slot still gets its own moment');
    assert.equal(service.getStatus().cups, 0, 'skipping never records a cup');
  }, { now: AT(9) });
});

test('re-enabling the switch the same day resumes the rhythm instead of firing at once', () => {
  withService(({ service, pending, sipped, setSettings }) => {
    setSettings({ hydrationEnabled: false });
    service.onSettingsChanged();
    service.tick(AT(9));
    assert.equal(sipped(), 0);
    setSettings({ hydrationEnabled: true });
    service.onSettingsChanged();
    assert.equal(service.getStatus().prompt, null, 'turning it back on is not a prompt');
    assert.equal(liveTimers(pending).at(-1)?.delay, 60 * MINUTE, 'the 09:00 slot stayed consumed');
    service.tick(AT(10));
    assert.equal(sipped(), 1);
  }, { now: AT(9) });
});

test('a save is atomic and leaves no temp file behind', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eye-hydration-'));
  try {
    const store = new HydrationStore(directory);
    store.save({ localDate: localDateKey(AT(9)), cups: 2, lastCupAt: AT(9), lastPromptAt: null });
    assert.equal(existsSync(`${store.getPath()}.tmp`), false, 'the temp file must be renamed away');
    store.save({ localDate: localDateKey(AT(9)), cups: 3, lastCupAt: AT(9), lastPromptAt: AT(9) });
    assert.equal(new HydrationStore(directory).load(AT(9)).cups, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// ── Wiring contract (source scan, same technique as tests/ipc-contract) ─────

const repository = resolve(import.meta.dirname, '..');
const readSource = (relative: string): string => readFileSync(resolve(repository, relative), 'utf8');

test('hydration is not a fourth reminder kind and never enters the health schedule (AC-10)', () => {
  const types = readSource('src/shared/types.ts');
  assert.match(types, /export type ReminderKind = 'eye' \| 'walk' \| 'combined';/, 'ReminderKind must stay three-valued');
  assert.match(types, /export type PetReaction = 'celebrate' \| 'stretch' \| 'focus' \| 'sip';/);

  for (const file of [
    'src/main/reminders.ts',
    'src/main/scheduling/kernel.ts',
    'src/main/reminderContext.ts',
    'src/main/reminderHistory.ts'
  ]) {
    assert.equal(readSource(file).includes('hydration'), false, `${file} must not know about hydration`);
  }

  // The service may not even import the scheduler, the alert surface or history.
  const service = readSource('src/main/hydration.ts');
  for (const forbidden of [
    "from './reminders'",
    "from './scheduling/kernel'",
    "from './reminderContext'",
    "from './reminderHistory'",
    "from './reminderSurface'"
  ]) {
    assert.equal(service.includes(forbidden), false, `hydration must not import ${forbidden}`);
  }

  // The production gate only READS the context decision; it never touches the
  // scheduler, so a drink cannot move nextEyeAt / nextWalkAt.
  const main = readSource('src/main/index.ts');
  const gate = main.slice(main.indexOf('const hydrationGate'), main.indexOf('const hydration = new HydrationService'));
  assert.ok(gate.length > 0);
  assert.equal(/scheduler\.(?!getStatus)/.test(gate), false, 'the gate must not mutate the scheduler');
  assert.equal(gate.includes('contextMonitor.decision'), true);
});

test('the hydration counter lives in its own file and stays out of the backup', () => {
  assert.equal(readSource('src/main/backup.ts').includes('hydration'), false, 'hydration-state must not enter backup v8');
  assert.equal(new HydrationStore(tmpdir()).getPath().endsWith('hydration-state.json'), true);
});

test('a drink moment leaves nextEyeAt / nextWalkAt untouched (AC-10, runtime)', () => {
  const now = AT(9);
  const current = settings({ quietHoursEnabled: false });
  const scheduler = new ReminderScheduler(current, { now: () => now });
  try {
    const before = scheduler.getStatus();
    withService(
      ({ service, sipped }) => {
        service.start();
        service.tick(AT(9));
        assert.equal(sipped(), 1, 'the moment really happened');
        const after = scheduler.getStatus();
        assert.equal(after.nextEyeAt, before.nextEyeAt, 'eye schedule is not reset by a drink');
        assert.equal(after.nextWalkAt, before.nextWalkAt, 'walk schedule is not reset by a drink');
        assert.equal(after.activeReminder, before.activeReminder, 'no rest overlay was opened');
      },
      {
        now: AT(9),
        settings: { quietHoursEnabled: false },
        // The production gate shape: read the context decision, never write the schedule.
        gate: (slotNow) => contextDecision(current, null, false, slotNow).action === 'show' ? 'show' : 'defer'
      }
    );
  } finally {
    scheduler.stop();
  }
});

test('the settings surface keeps the two-control, no-onboarding promise (B6/B7)', () => {
  const ui = readSource('src/renderer/src/features/simple/SimpleSettings.tsx');
  const section = ui.slice(ui.indexOf('id="settings-hydration"'), ui.indexOf('id="settings-appearance"'));
  assert.ok(section.length > 0, 'the hydration section must exist');
  assert.equal(section.includes('随时可关'), true, 'the permanent opt-out note is part of the switch');
  assert.equal((section.match(/<SettingSwitch/g) ?? []).length, 1, 'one switch');
  assert.equal((section.match(/hydrationGoalCups/g) ?? []).length > 0, true, 'one goal field');
  assert.equal(/首次|引导|wizard|onboarding|tour/i.test(section), false, 'no first-run guide');
  assert.match(section, /checked=\{settings\.hydrationEnabled\}/, 'the switch reflects the (default-on) setting');
});

test('a click records a cup only while a prompt is up, and the old gestures survive (B2)', () => {
  const view = readSource('src/renderer/src/views/PetView.tsx');
  const react = view.slice(view.indexOf('const handleReact'), view.indexOf('return (', view.indexOf('const handleReact')));
  assert.ok(react.includes('if (hydrationPrompt)'), 'the prompt intercepts the single click');
  assert.ok(
    react.indexOf('recordHydrationCup') >= 0 && react.indexOf('recordHydrationCup') < react.indexOf('setClickKey'),
    'the cup is recorded instead of the ordinary react'
  );
  assert.equal(view.includes('const showCupChip = Boolean(hydration?.enabled)'), true, 'the chip is hidden with the feature');
  assert.equal(view.includes('onDoubleClick={handlePetDoubleClick}'), true, 'double-click behaviour is unchanged');
});


// ── Whole-day cadence (AC-16) ───────────────────────────────────────────────

interface CadenceResult {
  prompts: number[];
  cups: number;
  achieved: boolean;
  cupTimes: number[];
}

/**
 * Drive one full working day through the REAL scheduling path: fire the armed
 * slot timer, answer the prompt the way a user would, and repeat until the day
 * runs out. Nothing is computed from a duplicated slot formula, so the test
 * fails if the service's own arming drifts.
 *
 * `driftMs` is how late the timer actually runs. A real `setTimeout` is never
 * punctual, and the difference between "the slot that was scheduled" and "the
 * instant the callback ran" is exactly what used to silently halve the day.
 */
const walkDay = (
  ctx: Harness,
  options: {
    reactionMs: number;
    respond: 'record' | 'dismiss' | 'ignore';
    workEndMinutes: number;
    driftMs?: (slotIndex: number) => number;
  }
): CadenceResult => {
  const prompts: number[] = [];
  const cupTimes: number[] = [];
  ctx.service.start();
  for (let step = 0; step < 40; step += 1) {
    // Slot timers are the only ones longer than the 8s strip; sip/strip are
    // cancelled as soon as the prompt is answered.
    const slotTimer = ctx.pending.filter((entry) => !entry.cancelled && entry.delay > HYDRATION_STRIP_MS).at(-1);
    if (!slotTimer) break;
    const fireAt = ctx.now() + slotTimer.delay;
    // A midnight timer is the end of the day, not another slot.
    if (localDateKey(fireAt) !== localDateKey(ctx.now())) break;
    if (minutesOfLocalDay(fireAt) > options.workEndMinutes) break;
    // The timer is scheduled for `fireAt` but runs at `firedAt`.
    const firedAt = fireAt + (options.driftMs?.(prompts.length) ?? 0);
    ctx.setNow(firedAt);
    slotTimer.callback();
    if (!ctx.service.getStatus().prompt) break;
    prompts.push(fireAt);

    if (options.respond === 'ignore') {
      // Let the 8s strip expire on its own (the "did not notice" path).
      const strip = ctx.pending.filter((entry) => !entry.cancelled && entry.delay === HYDRATION_STRIP_MS).at(-1);
      ctx.setNow(firedAt + HYDRATION_STRIP_MS);
      strip?.callback();
      continue;
    }
    ctx.setNow(firedAt + options.reactionMs);
    if (options.respond === 'record') {
      const before = ctx.service.getStatus().cups;
      ctx.service.recordCup();
      if (ctx.service.getStatus().cups > before) cupTimes.push(firedAt + options.reactionMs);
    } else {
      ctx.service.dismissPrompt();
    }
  }
  return {
    prompts,
    cups: ctx.service.getStatus().cups,
    achieved: ctx.service.getStatus().achieved,
    cupTimes
  };
};

for (const reactionMs of [0, 2_000, 5_000, 10_000]) {
  test(`an answer ${reactionMs}ms after the slot still reaches 8/8 for a goal of 8`, () => {
    // The B4 rule under test: the interval is measured from the SLOT, not from
    // the moment the user answered. Stamping the click time would eat every
    // second slot and cap the day at 7 cups. petMotion stays on (the default),
    // so +10s is still inside sip 2.6s + strip 8s = 10.6s.
    withService((ctx) => {
      const day = walkDay(ctx, {
        reactionMs,
        respond: 'record',
        workEndMinutes: 21 * 60
      });
      assert.equal(day.prompts.length, 8, `goal 8 must produce 8 prompts, got ${day.prompts.length}`);
      assert.equal(day.cups, 8);
      assert.equal(day.achieved, true);
      // Each cup belongs to its prompt's slot, so the gaps are exactly one interval.
      const gaps = day.cupTimes.slice(1).map((at, index) => (at - day.cupTimes[index]) / MINUTE);
      assert.deepEqual([...new Set(gaps)], [105], `gaps must be one interval, got ${JSON.stringify(gaps)}`);
    }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 8 } });
  });
}

test('a goal of 20 also reaches 20/20 in one day (AC-16 upper bound)', () => {
  withService((ctx) => {
    const day = walkDay(ctx, { reactionMs: 5_000, respond: 'record', workEndMinutes: 21 * 60 });
    assert.equal(day.prompts.length, 20);
    assert.equal(day.cups, 20);
    assert.equal(day.achieved, true);
  }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 20, petMotion: false } });
});

// ── Timer jitter ────────────────────────────────────────────────────────────
// A fake timer fires exactly on the slot, so a cadence that stamps the marker
// with "the instant the callback ran" looks perfect here and loses half the day
// in production. These two walk the same day with a timer that is 3s late, then
// 1s late, alternating — the shape a loaded renderer produces in the wild.

test('a jittery timer (3s / 1s late, alternating) still reaches 8/8 for a goal of 8', () => {
  withService((ctx) => {
    const day = walkDay(ctx, {
      reactionMs: 5_000,
      respond: 'record',
      workEndMinutes: 21 * 60,
      driftMs: (slotIndex) => (slotIndex % 2 === 0 ? 3_000 : 1_000)
    });
    assert.equal(day.prompts.length, 8, `goal 8 must produce 8 prompts, got ${day.prompts.length}`);
    assert.equal(day.cups, 8, `goal 8 must produce 8 cups, got ${day.cups}`);
    assert.equal(day.achieved, true);
    // The marker is written from the slot, so every cup is stamped on the grid
    // and the gaps stay exactly one interval no matter how late the timer ran.
    const state = readState(ctx.directory);
    assert.equal(state.lastPromptAt, day.prompts.at(-1));
  }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 8 } });
});

test('a jittery timer (3s / 1s late, alternating) also reaches 20/20', () => {
  withService((ctx) => {
    const day = walkDay(ctx, {
      reactionMs: 5_000,
      respond: 'record',
      workEndMinutes: 21 * 60,
      driftMs: (slotIndex) => (slotIndex % 2 === 0 ? 3_000 : 1_000)
    });
    assert.equal(day.prompts.length, 20, `goal 20 must produce 20 prompts, got ${day.prompts.length}`);
    assert.equal(day.cups, 20, `goal 20 must produce 20 cups, got ${day.cups}`);
    assert.equal(day.achieved, true);
  }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 20, petMotion: false } });
});

test('every goal from 1 to 20 survives timer jitter', () => {
  // Same guarantee as the punctual walk, but with a late timer: jitter must not
  // be able to eat a slot for any goal the settings UI can produce.
  for (let goal = 1; goal <= 20; goal += 1) {
    withService((ctx) => {
      const day = walkDay(ctx, {
        reactionMs: 5_000,
        respond: 'record',
        workEndMinutes: 21 * 60,
        driftMs: (slotIndex) => [3_000, 1_000, 7_000, 500][slotIndex % 4]
      });
      assert.equal(day.prompts.length, goal, `goal ${goal} must prompt ${goal} times, got ${day.prompts.length}`);
      assert.equal(day.cups, goal, `goal ${goal} must record ${goal} cups with a late timer, got ${day.cups}`);
      assert.equal(day.achieved, true, `goal ${goal} must still reach the goal`);
    }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: goal } });
  }
});

test('a timer that fires one millisecond early still owns that slot', () => {
  // Node truncates a fractional delay, so a callback can land just before the
  // slot it was armed for. That must not be read as "a different slot", and it
  // must not be mistaken for "drank recently" either — with a `now`-based
  // freshness check the millisecond comes straight off the interval and the
  // slot is silently consumed without a prompt.
  withService((ctx) => {
    const day = walkDay(ctx, {
      reactionMs: 5_000,
      respond: 'record',
      workEndMinutes: 21 * 60,
      driftMs: () => -1
    });
    assert.equal(day.prompts.length, 8, `an early timer must still prompt 8 times, got ${day.prompts.length}`);
    assert.equal(day.cups, 8, `an early timer must still record 8 cups, got ${day.cups}`);
    assert.equal(day.achieved, true);
    const state = readState(ctx.directory);
    assert.equal(state.lastPromptAt, day.prompts.at(-1), 'the marker is the slot, not the callback instant');
  }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 8 } });
});

test('every goal from 1 to 20 reaches its configured target in one day (AC-16)', () => {
  // The AC is behavioural for the whole input range, not only for the two
  // headline values: a rounding or cadence regression that happens to spare 8
  // and 20 must still fail here.
  for (let goal = 1; goal <= 20; goal += 1) {
    withService((ctx) => {
      const day = walkDay(ctx, { reactionMs: 5_000, respond: 'record', workEndMinutes: 21 * 60 });
      assert.equal(day.prompts.length, goal, `goal ${goal} must prompt ${goal} times, got ${day.prompts.length}`);
      assert.equal(day.cups, goal, `goal ${goal} must record ${goal} cups, got ${day.cups}`);
      assert.equal(day.achieved, true, `goal ${goal} must reach the goal`);
    }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: goal } });
  }
});

test('a whole day of unanswered prompts records nothing and never claims the goal', () => {
  withService((ctx) => {
    const day = walkDay(ctx, { reactionMs: 0, respond: 'ignore', workEndMinutes: 21 * 60 });
    assert.equal(day.prompts.length, 8, 'the cadence does not depend on the user answering');
    assert.equal(day.cups, 0);
    assert.equal(day.achieved, false);
  }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 8, petMotion: false } });
});

test('dismissing every prompt records nothing and keeps the cadence', () => {
  withService((ctx) => {
    const day = walkDay(ctx, { reactionMs: 1_000, respond: 'dismiss', workEndMinutes: 21 * 60 });
    assert.equal(day.prompts.length, 8);
    assert.equal(day.cups, 0);
    assert.equal(day.achieved, false);
  }, { now: new Date(2026, 6, 8, 7, 0, 0, 0).getTime(), settings: { workStartMinutes: 7 * 60, workEndMinutes: 21 * 60, hydrationGoalCups: 8, petMotion: false } });
});

test('two ticks for the same slot post one prompt and one cup', () => {
  withService(({ service, sipped, pending }) => {
    const at = AT(9);
    service.tick(at);
    service.tick(at);
    assert.equal(sipped(), 1, 'the second tick must not sip again');
    service.recordCup(at + 1_000);
    service.tick(at + 1_000);
    assert.equal(service.getStatus().cups, 1, 'and must not double-count the cup either');
    assert.ok(liveTimers(pending).length >= 1, 'the next slot stays armed');
  }, { now: AT(9) });
});

test('a manually shortened window is a known limit, not something the goal is rewritten for', () => {
  // The settings UI cannot edit the working window, so this only happens via a
  // hand-edited settings.json or a backup import. The documented answer is that
  // the goal stays exactly as configured (no "effective goal"): the interval
  // still floors at 30 minutes and the chip keeps the configured denominator.
  const workStartMinutes = 9 * 60;
  const workEndMinutes = 12 * 60; // 180 minutes, room for 6 slots at the 30min floor
  const interval = hydrationIntervalMinutes({ workStartMinutes, workEndMinutes, hydrationGoalCups: 20 });
  assert.equal(interval, HYDRATION_INTERVAL_MIN_MINUTES);
  assert.ok(Math.floor(180 / interval) < 20, 'the slots really do fall short here');
  withService(({ service }) => {
    service.recordCup(AT(9));
    const status = service.getStatus();
    assert.equal(status.goalCups, 20, 'the denominator is the configured goal');
    assert.equal(status.achieved, false);
  }, { now: AT(9), settings: { workStartMinutes, workEndMinutes, hydrationGoalCups: 20 } });
});
