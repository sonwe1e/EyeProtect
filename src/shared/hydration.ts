import { localDateAtMinutes, localDateKey } from './calendar';
import type { Settings } from './types';

/**
 * Hydration (喝水) is a once-only "moment", not a fourth reminder kind: it never
 * enters `ReminderKind`, the scheduler kernel or the alert surface. These rules
 * are pure and take an injected `now`, so every timing decision is testable
 * without a running clock.
 *
 * The interval is DERIVED from the working window and the daily goal instead of
 * being stored: a stored interval can silently disagree with the two settings
 * the user actually changed (Q-05).
 */
export const HYDRATION_INTERVAL_MIN_MINUTES = 30;
export const HYDRATION_INTERVAL_MAX_MINUTES = 120;
/** The pet drinks for this long before the strip appears. */
export const HYDRATION_SIP_MS = 2_600;
/** The strip retires itself after this long. */
export const HYDRATION_STRIP_MS = 8_000;

/** One local day of counting; everything except the day key is reset on roll. */
export interface HydrationDayState {
  localDate: string;
  cups: number;
  lastCupAt: number | null;
  /** The slot already consumed. Persisted so a restart never re-opens it. */
  lastPromptAt: number | null;
}

export interface HydrationPrompt {
  id: string;
  phase: 'sipping' | 'strip';
  /** Absolute end of the current phase. The main process owns this clock. */
  endsAt: number;
}

export interface HydrationStatus {
  enabled: boolean;
  goalCups: number;
  cups: number;
  localDate: string;
  achieved: boolean;
  prompt: HydrationPrompt | null;
}

export const emptyHydrationDay = (localDate: string): HydrationDayState => ({
  localDate,
  cups: 0,
  lastCupAt: null,
  lastPromptAt: null
});

/** Status before anything is read — used as the default provider in AppWindows. */
export const EMPTY_HYDRATION_STATUS: HydrationStatus = {
  enabled: false,
  goalCups: 8,
  cups: 0,
  localDate: '',
  achieved: false,
  prompt: null
};

/**
 * Minutes between two hydration slots: the working window divided by the goal,
 * clamped to 30–120.
 *
 * `floor`, not `round`: rounding up shrinks the slot count below the goal, and a
 * goal the user can never reach makes "够了" unreachable — the chip would sit at
 * 19/20 forever (AC-16). Flooring guarantees `floor(window/interval) >= goal`
 * for every goal in 1–20 on the default 840-minute window.
 */
export const hydrationIntervalMinutes = (
  settings: Pick<Settings, 'workStartMinutes' | 'workEndMinutes' | 'hydrationGoalCups'>
): number => {
  const { workStartMinutes, workEndMinutes, hydrationGoalCups } = settings;
  const usable = [workStartMinutes, workEndMinutes, hydrationGoalCups].every(
    (value) => typeof value === 'number' && Number.isFinite(value)
  );
  if (!usable || hydrationGoalCups < 1 || workEndMinutes <= workStartMinutes) {
    return HYDRATION_INTERVAL_MIN_MINUTES;
  }
  const derived = Math.floor((workEndMinutes - workStartMinutes) / hydrationGoalCups);
  return Math.min(HYDRATION_INTERVAL_MAX_MINUTES, Math.max(HYDRATION_INTERVAL_MIN_MINUTES, derived));
};

/**
 * Reset on the first read of a new local day. Reading is the only trigger, so a
 * machine that was off at midnight still starts the new day at zero (AC-11).
 */
export const rollHydrationDay = (state: HydrationDayState | null, now: number): HydrationDayState => {
  const todayKey = localDateKey(now);
  if (!state || state.localDate !== todayKey) return emptyHydrationDay(todayKey);
  return { ...state };
};

/**
 * The first slot of today that is still ahead of `now` and of the slot already
 * consumed. Slots are `workStart + k * interval` for k = 1, 2, … and must fall
 * on or before `workEnd`; a slot only has to *start* inside the window, because
 * drinking needs no room to finish.
 *
 * Returns null when today has no slot left — the caller then waits for the next
 * local midnight instead of inventing an evening reminder.
 */
export const nextHydrationSlotAt = (input: {
  now: number;
  workStartMinutes: number;
  workEndMinutes: number;
  intervalMinutes: number;
  lastPromptAt: number | null;
}): number | null => {
  const { now, workStartMinutes, workEndMinutes, intervalMinutes, lastPromptAt } = input;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return null;
  if (!Number.isFinite(workStartMinutes) || !Number.isFinite(workEndMinutes)) return null;
  if (workEndMinutes <= workStartMinutes) return null;
  // A consumed slot must never come back, even if the clock moved backwards.
  const floor = lastPromptAt === null ? now : Math.max(now, lastPromptAt);
  const today = localDateKey(now);
  const slots = Math.floor((workEndMinutes - workStartMinutes) / intervalMinutes);
  for (let k = 1; k <= slots; k += 1) {
    const at = localDateAtMinutes(now, workStartMinutes + k * intervalMinutes);
    if (at <= floor) continue;
    // A slot has to start inside TODAY's working window. workEnd may be 24:00,
    // and `localDateAtMinutes(now, 1440)` is tomorrow 00:00 — a reminder outside
    // working hours, on a day whose count has just been reset. The slot that
    // lands exactly on workEnd within the same day is still valid.
    if (localDateKey(at) !== today) return null;
    return at;
  }
  return null;
};

/** Milliseconds until the next local midnight (DST-safe: no 24h arithmetic). */
export const msUntilNextLocalMidnight = (now: number): number => {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(0, next.getTime() - now);
};
