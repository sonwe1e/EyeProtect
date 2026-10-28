import {
  HYDRATION_SIP_MS,
  HYDRATION_STRIP_MS,
  hydrationIntervalMinutes,
  msUntilNextLocalMidnight,
  nextHydrationSlotAt,
  rollHydrationDay,
  type HydrationDayState,
  type HydrationPrompt,
  type HydrationStatus
} from '../shared/hydration';
import type { Settings } from '../shared/types';
import type { HydrationStore } from './hydrationStore';

/**
 * The two clocks this service needs. They are injectable so tests can drive
 * every transition with a fake `now` and never start a real timer — a service
 * that can only be tested by waiting eight real seconds is not testable.
 */
export interface HydrationTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HydrationServiceOptions {
  store: HydrationStore;
  settingsStore: { get: () => Settings };
  /**
   * Quiet hours / fullscreen / meeting gate. Read-only reuse of the reminder
   * context monitor: it must never re-arm or reset the health-reminder schedule.
   */
  gate: (now: number) => 'show' | 'defer';
  /** True while another surface owns the screen (pre-alert, gentle reminder, pomodoro). */
  surfaceBusy: () => boolean;
  onChange: (status: HydrationStatus) => void;
  /** Ask the pet to drink (a one-shot reaction, no new channel). */
  sendSip: () => void;
  /**
   * True when the operating system asks for reduced motion. The pet renderer
   * already honours `prefers-reduced-motion`, so without this the main process
   * would still wait out 2.6s of an animation nobody is going to see (S1-2).
   */
  reducedMotion?: () => boolean;
  now?: () => number;
  timers?: HydrationTimers;
}

const defaultTimers: HydrationTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** Never arm a timer shorter than this: a zero-delay timer would spin. */
const MIN_ARM_MS = 1_000;

/**
 * Owns today's cup count and the single hydration moment.
 *
 * Division of labour with the rest of the app: this service decides *when* (it
 * holds the clock and the persisted "slot consumed" marker) and *whether* (the
 * gate and the surface check), while the pet and the bubble only render what it
 * publishes. Nothing here registers a `ReminderKind`, a scheduler deadline or an
 * alert window — a drink is never a rest.
 *
 * The prompt lives in memory only. It lasts at most 8 seconds, so persisting it
 * would only resurrect a stale strip after a restart.
 */
export class HydrationService {
  private day: HydrationDayState;
  private prompt: HydrationPrompt | null = null;
  private slotTimer: unknown = null;
  private promptTimer: unknown = null;
  private sequence = 0;
  private readonly now: () => number;
  private readonly timers: HydrationTimers;

  constructor(private readonly options: HydrationServiceOptions) {
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? defaultTimers;
    this.day = rollHydrationDay(options.store.load(this.now()), this.now());
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  getStatus(now = this.now()): HydrationStatus {
    this.day = rollHydrationDay(this.day, now);
    return this.statusOf(this.settings());
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Arm the first slot. Deliberately does NOT tick: a cold start or a wake
   *  after hours must not replay the moments that passed while we were away. */
  start(): void {
    this.day = rollHydrationDay(this.day, this.now());
    this.arm();
    this.publish();
  }

  stop(): void {
    this.clearTimers();
  }

  /** Sleep / quit: drop every timer so nothing fires late. */
  suspend(): void {
    this.clearTimers();
    if (this.prompt) {
      this.prompt = null;
      this.publish();
    }
  }

  /** Wake / unlock: re-derive the next slot from the current clock only. */
  resume(): void {
    this.day = rollHydrationDay(this.day, this.now());
    this.arm();
    this.publish();
  }

  /**
   * A settings edit re-derives the schedule. Turning the feature off also drops
   * a visible prompt, so the switch means "stop now", not "stop next time".
   */
  onSettingsChanged(): void {
    this.day = rollHydrationDay(this.day, this.now());
    if (!this.settings().hydrationEnabled) {
      this.clearTimers();
      this.prompt = null;
      this.publish();
      return;
    }
    this.arm();
    this.publish();
  }

  // ── The one moment ──────────────────────────────────────────────────────

  /**
   * Fire the slot that has just come due.
   *
   * Every branch — disabled, already at the goal, drank recently, gate said
   * defer, another surface is busy — records `lastPromptAt` and re-arms. The
   * slot is consumed either way, which is what makes "quiet hours" mean "skip",
   * not "queue three missed drinks for later" (B4 / AC-12).
   *
   * `slotAt` is the scheduled instant of the slot; `now` is the instant this
   * call actually happened. They are never assumed equal: a real `setTimeout`
   * fires late (by milliseconds, sometimes by seconds under load), and stamping
   * the marker with `now` shifts the whole grid a little later on every slot —
   * after eight slots the grid has drifted far enough that the last slots fall
   * outside the working window and the day silently loses cups. The grid is
   * authoritative, the timer is not.
   */
  tick(now = this.now(), slotAt = now): HydrationStatus {
    this.day = rollHydrationDay(this.day, now);
    const settings = this.settings();
    const intervalMs = hydrationIntervalMinutes(settings) * 60_000;
    const consumeSlot = (): void => {
      // Written from `slotAt`, never from `now`: the marker means "this grid
      // slot is used up", and the marker only ever moves forward so a clock
      // that jumped backwards cannot re-open a slot the user already answered.
      const marker = Math.max(this.day.lastPromptAt ?? slotAt, slotAt);
      this.day = { ...this.day, lastPromptAt: marker };
      this.options.store.save(this.day);
    };
    const skip = (): HydrationStatus => {
      consumeSlot();
      this.arm();
      return this.publish();
    };

    // This grid slot was already consumed — a timer firing while a wake-up
    // callback lands on the same slot must not drink twice. Compared on
    // `slotAt`: `now` can be a few milliseconds past the slot (or a millisecond
    // before it, when Node truncates the timer delay), and those milliseconds
    // must not be read as "a new slot".
    // The `now` clause is the clock going backwards (DST fall-back, manual
    // change): the slot the timer was armed for is still ahead of the marker,
    // but the clock now sits before it, so prompting here would repeat a moment
    // the user already answered. Both the slot and the clock must be ahead of
    // the marker for this to be a fresh moment.
    // The re-arm matters: the timer that called us has already cleared itself,
    // and without it a backwards jump would silence hydration for the day.
    const consumedAt = this.day.lastPromptAt;
    if (consumedAt !== null && (slotAt <= consumedAt || now <= consumedAt)) {
      this.arm();
      return this.publish();
    }
    if (!settings.hydrationEnabled) return skip();
    if (this.day.cups >= settings.hydrationGoalCups) return skip();
    // "Drank recently" is decided on the grid too: a cup recorded in answer to
    // a prompt is stamped with its slot, so `slotAt - lastCupAt` is exactly one
    // interval and the next slot is always allowed through. A manually recorded
    // cup keeps its click time, so this still suppresses the next slot.
    if (this.day.lastCupAt !== null && slotAt - this.day.lastCupAt < intervalMs) return skip();
    if (this.options.gate(now) !== 'show') return skip();
    if (this.options.surfaceBusy()) return skip();

    consumeSlot();
    this.startPrompt(now, settings);
    this.arm();
    return this.publish();
  }

  /** Record one cup, retire the prompt, and never exceed the daily goal. */
  recordCup(now = this.now()): HydrationStatus {
    this.day = rollHydrationDay(this.day, now);
    const goalCups = this.settings().hydrationGoalCups;
    // B4: a cup recorded in answer to a prompt belongs to THAT slot, not to the
    // second the user clicked. Stamping the click time would push the next slot
    // later by the reaction time, and with a five-second reaction every second
    // slot would be suppressed — 8 prompts could never add up to 8 cups.
    const slot = this.prompt !== null ? this.day.lastPromptAt : null;
    this.day = {
      ...this.day,
      cups: Math.min(goalCups, this.day.cups + 1),
      lastCupAt: slot ?? now
    };
    this.options.store.save(this.day);
    this.clearPromptTimer();
    this.prompt = null;
    this.arm();
    return this.publish();
  }

  /** The "×": hide the strip, record nothing, ask nothing. */
  dismissPrompt(): HydrationStatus {
    this.clearPromptTimer();
    if (!this.prompt) return this.getStatus();
    this.prompt = null;
    return this.publish();
  }

  // ── Prompt lifecycle (main process owns the clock) ──────────────────────

  private startPrompt(now: number, settings: Settings): void {
    this.clearPromptTimer();
    const id = `${now}-${++this.sequence}`;
    if (!settings.petMotion || this.options.reducedMotion?.() === true) {
      // Reduced motion: no sipping act. The strip appears at once so the
      // recording path is byte-for-byte the same (S1-2).
      this.prompt = { id, phase: 'strip', endsAt: now + HYDRATION_STRIP_MS };
      this.promptTimer = this.timers.setTimeout(() => this.onStripExpired(), HYDRATION_STRIP_MS);
      return;
    }
    this.options.sendSip();
    this.prompt = { id, phase: 'sipping', endsAt: now + HYDRATION_SIP_MS };
    this.promptTimer = this.timers.setTimeout(() => this.onSipDone(), HYDRATION_SIP_MS);
  }

  private onSipDone(): void {
    this.promptTimer = null;
    const current = this.prompt;
    if (!current || current.phase !== 'sipping') return;
    const now = this.now();
    this.prompt = { id: current.id, phase: 'strip', endsAt: now + HYDRATION_STRIP_MS };
    this.promptTimer = this.timers.setTimeout(() => this.onStripExpired(), HYDRATION_STRIP_MS);
    this.publish();
  }

  private onStripExpired(): void {
    this.promptTimer = null;
    if (!this.prompt) return;
    // A strip that was pushed off screen by a higher-priority surface still
    // ends here: its lifetime never restarts, so it cannot reappear later.
    this.prompt = null;
    this.publish();
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private arm(): void {
    this.clearSlotTimer();
    const settings = this.settings();
    if (!settings.hydrationEnabled) return;
    const now = this.now();
    this.day = rollHydrationDay(this.day, now);
    const slot = nextHydrationSlotAt({
      now,
      workStartMinutes: settings.workStartMinutes,
      workEndMinutes: settings.workEndMinutes,
      intervalMinutes: hydrationIntervalMinutes(settings),
      lastPromptAt: this.day.lastPromptAt
    });
    // No slot left today: wait for the next local midnight and re-derive there.
    // Ticking at midnight would be a reminder outside the working window.
    const at = slot ?? now + msUntilNextLocalMidnight(now);
    const delay = Math.max(MIN_ARM_MS, at - now);
    this.slotTimer = this.timers.setTimeout(() => {
      this.slotTimer = null;
      if (slot === null) {
        // Crossing midnight is a real state change: the count restarts at zero.
        // Re-arming silently would leave the pet showing yesterday's "8/8 · 够了"
        // until the first slot of the new day.
        this.arm();
        this.publish();
        return;
      }
      // Hand the scheduled instant to `tick`, not the moment this callback
      // happens to run: that difference is the whole cadence guarantee.
      this.tick(this.now(), slot);
    }, delay);
  }

  private statusOf(settings: Settings): HydrationStatus {
    const goalCups = settings.hydrationGoalCups;
    return {
      enabled: settings.hydrationEnabled,
      goalCups,
      cups: Math.min(this.day.cups, goalCups),
      localDate: this.day.localDate,
      achieved: this.day.cups >= goalCups,
      prompt: this.prompt
    };
  }

  private publish(): HydrationStatus {
    const status = this.statusOf(this.settings());
    this.options.onChange(status);
    return status;
  }

  private settings(): Settings {
    return this.options.settingsStore.get();
  }

  private clearSlotTimer(): void {
    if (this.slotTimer === null) return;
    this.timers.clearTimeout(this.slotTimer);
    this.slotTimer = null;
  }

  private clearPromptTimer(): void {
    if (this.promptTimer === null) return;
    this.timers.clearTimeout(this.promptTimer);
    this.promptTimer = null;
  }

  private clearTimers(): void {
    this.clearSlotTimer();
    this.clearPromptTimer();
  }
}
