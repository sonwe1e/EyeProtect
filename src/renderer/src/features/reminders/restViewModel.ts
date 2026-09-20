import type { ActiveReminder, BreakActivity, ReminderKind, Settings } from '../../../../shared/types';

/**
 * Pure view model for the rest/reminder surface. The alert window re-renders
 * once per second while a countdown runs, so everything the renderer shows is
 * derived here from main-process state instead of being stored locally: the
 * main process owns `unlockAt` and only it can grant early completion.
 */

export type RestPhase = 'ready' | 'resting' | 'finished';

export interface RestKindCopy {
  /** Short label for the stage badge, e.g. 护眼提醒. */
  badge: string;
  title: string;
  detail: string;
  /** Stage caption: the three key beats of the break. */
  caption: string;
}

/** Phase lede shared by the alert window and the gentle bubble. */
export type RestLedeOptions = {
  /** True when a pomodoro break will merge into this rest. */
  mergedWithPomodoro?: boolean;
};

export const restLede = (
  phase: RestPhase,
  remainingSeconds: number,
  options: RestLedeOptions = {}
): string => {
  if (phase === 'ready') {
    return options.mergedWithPomodoro
      ? '将与本轮番茄休息合并，点击开始休息。'
      : '准备好后，点击开始休息。';
  }
  if (phase === 'finished') {
    return '这次休息时间已到';
  }
  return `还有 ${remainingSeconds} 秒，跟着节奏放松`;
};

const REST_COPY: Record<ReminderKind, RestKindCopy> = {
  eye: {
    badge: '护眼提醒',
    title: '让眼睛休息一下',
    detail: '跟它一起看向远处，慢慢眨几次眼。',
    caption: '远望 · 眨眼 · 放松'
  },
  walk: {
    badge: '走动提醒',
    title: '起来走动一下',
    detail: '起身活动肩颈，顺便喝口水。',
    caption: '起身 · 迈步 · 伸展'
  },
  combined: {
    badge: '综合休息',
    title: '离开屏幕，起来走动一下',
    detail: '先把视线移远，再离开座位活动一下。',
    caption: '远望之后，走一小圈'
  }
};

export const restKindCopy = (kind: ReminderKind): RestKindCopy => REST_COPY[kind];

/** 'ready' until the user starts the break, then 'resting' until `unlockAt`. */
export const restPhase = (active: ActiveReminder, now: number): RestPhase => {
  if (typeof active.restStartedAt !== 'number') {
    return 'ready';
  }
  return now >= active.unlockAt ? 'finished' : 'resting';
};

/** The pixel animal only animates once the break actually runs. */
export const restAnimalAction = (kind: ReminderKind, phase: RestPhase): string =>
  phase === 'ready' ? 'idle' : kind;

/**
 * Rest seconds this reminder would take if the user started it now. Combined
 * reminders wait out the longer of the two configured rests (see
 * ReminderScheduler.beginRest), so the hint must show the same value.
 */
const plannedRestSeconds = (kind: ReminderKind, settings: Settings): number =>
  kind === 'eye'
    ? settings.eyeRestSeconds
    : kind === 'walk'
      ? settings.walkRestSeconds
      : Math.max(settings.eyeRestSeconds, settings.walkRestSeconds);

export const restCountdown = (
  active: ActiveReminder,
  now: number,
  settings: Settings
): { remainingSeconds: number; totalSeconds: number; progress: number } => {
  if (typeof active.restStartedAt !== 'number') {
    const totalSeconds = Math.max(0, plannedRestSeconds(active.kind, settings));
    return { remainingSeconds: totalSeconds, totalSeconds, progress: 0 };
  }

  // Actual window from the main process: it can exceed the configured rest
  // when a pomodoro break merges into this reminder.
  const totalSeconds = Math.max(1, Math.round((active.unlockAt - active.restStartedAt) / 1000));
  const remainingSeconds = Math.max(0, Math.ceil((active.unlockAt - now) / 1000));
  const progress = Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds));
  return { remainingSeconds, totalSeconds, progress };
};

/** mm:ss for the countdown ring; values stay non-negative and padded. */
export const formatRestDuration = (seconds: number): string => {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export interface ActivityStepProgress {
  /** Index of the step the user should be on right now. */
  stepIndex: number;
  complete: boolean;
  /** 0..1 across the activity's suggested duration. */
  progress: number;
}

/**
 * Where the user is inside a suggested micro-break. Activities carry a
 * suggested duration and an ordered step list; the steps are spread evenly
 * across that duration, so this is the single place that maps "elapsed time"
 * onto "which instruction to show".
 */
export const getActivityProgress = (
  activity: BreakActivity,
  startedAt: number,
  now: number
): ActivityStepProgress => {
  const durationMs = Math.max(1, activity.durationSeconds * 1_000);
  const elapsed = Math.max(0, now - startedAt);
  const progress = Math.min(1, elapsed / durationMs);
  const stepIndex = Math.min(
    activity.steps.length - 1,
    Math.floor(progress * activity.steps.length)
  );
  return {
    stepIndex: Math.max(0, stepIndex),
    complete: progress >= 1,
    progress
  };
};
