import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import type {
  CareStatus,
  ReminderEvent,
  ReminderEventAction,
  ReminderKind,
  ReminderMode,
  ReminderPeriodStats,
  Settings,
  WeeklyReport
} from '../shared/types';

const HISTORY_FILE = 'reminder-history.json';
const HISTORY_SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1_000;

const isKind = (value: unknown): value is ReminderKind =>
  value === 'eye' || value === 'walk' || value === 'combined';

const isAction = (value: unknown): value is ReminderEventAction =>
  value === 'complete' ||
  value === 'snooze' ||
  value === 'skip' ||
  value === 'natural-break';

const isMode = (value: unknown): value is ReminderMode =>
  value === 'gentle' || value === 'guided' || value === 'focused';

export const sanitizeReminderEvent = (value: unknown): ReminderEvent | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<ReminderEvent>;
  if (
    !Number.isFinite(candidate.timestamp) ||
    !Number.isFinite(candidate.scheduledAt) ||
    !Number.isFinite(candidate.shownAt) ||
    !isKind(candidate.kind) ||
    !isAction(candidate.action) ||
    !isMode(candidate.mode) ||
    !Number.isInteger(candidate.snoozeCount) ||
    (candidate.snoozeCount as number) < 0
  ) {
    return null;
  }
  return {
    timestamp: candidate.timestamp as number,
    kind: candidate.kind,
    scheduledAt: candidate.scheduledAt as number,
    shownAt: candidate.shownAt as number,
    action: candidate.action,
    snoozeCount: candidate.snoozeCount as number,
    mode: candidate.mode
  };
};

const startOfDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const startOfWeek = (timestamp: number): number => {
  const date = new Date(startOfDay(timestamp));
  const day = date.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - daysFromMonday);
  return date.getTime();
};

const emptyStats = (): ReminderPeriodStats => ({
  total: 0,
  complete: 0,
  snooze: 0,
  skip: 0,
  naturalBreak: 0,
  eyeComplete: 0,
  walkComplete: 0,
  completionRate: 0,
  mostSkippedHour: null,
  longestActiveMinutes: 0
});

export const summarizeEvents = (
  events: readonly ReminderEvent[],
  from: number,
  to: number
): ReminderPeriodStats => {
  const stats = emptyStats();
  const skippedHours = new Map<number, number>();
  const periodEvents = events
    .filter((event) => event.timestamp >= from && event.timestamp < to)
    .sort((a, b) => a.timestamp - b.timestamp);
  let streakStart: number | null = null;
  let lastActiveAt: number | null = null;
  let longestActiveMs = 0;
  const finishStreak = (): void => {
    if (streakStart !== null && lastActiveAt !== null) {
      longestActiveMs = Math.max(longestActiveMs, lastActiveAt - streakStart);
    }
    streakStart = null;
    lastActiveAt = null;
  };
  for (const event of periodEvents) {
    stats.total += 1;
    if (event.action === 'complete') {
      stats.complete += 1;
      if (event.kind === 'eye' || event.kind === 'combined') {
        stats.eyeComplete += 1;
      }
      if (event.kind === 'walk' || event.kind === 'combined') {
        stats.walkComplete += 1;
      }
    } else if (event.action === 'snooze') {
      stats.snooze += 1;
    } else if (event.action === 'skip') {
      stats.skip += 1;
      const hour = new Date(event.timestamp).getHours();
      skippedHours.set(hour, (skippedHours.get(hour) ?? 0) + 1);
    } else {
      stats.naturalBreak += 1;
    }
    if (event.action === 'natural-break') {
      finishStreak();
    } else if (lastActiveAt !== null && event.timestamp - lastActiveAt > 2 * 60 * 60 * 1_000) {
      finishStreak();
      streakStart = event.timestamp;
      lastActiveAt = event.timestamp;
    } else {
      streakStart ??= event.timestamp;
      lastActiveAt = event.timestamp;
    }
  }
  finishStreak();
  const handled = stats.complete + stats.snooze + stats.skip;
  stats.completionRate = handled > 0 ? stats.complete / handled : 0;
  stats.mostSkippedHour =
    [...skippedHours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ??
    null;
  stats.longestActiveMinutes = Math.round(longestActiveMs / 60_000);
  return stats;
};

const recommendInterval = (
  events: readonly ReminderEvent[],
  kind: 'eye' | 'walk',
  baseMinutes: number,
  weekStart: number,
  now: number
): {
  minutes: number;
  samples: number;
  difficult: number;
  direction: 'longer' | 'shorter' | 'base';
} => {
  const relevant = events.filter(
    (event) =>
      event.timestamp >= weekStart &&
      event.timestamp < now &&
      (event.kind === kind || event.kind === 'combined') &&
      event.action !== 'natural-break'
  );
  if (relevant.length < 4) {
    return {
      minutes: baseMinutes,
      samples: relevant.length,
      difficult: 0,
      direction: 'base'
    };
  }
  const difficult = relevant.filter(
    (event) => event.action === 'skip' || event.action === 'snooze'
  ).length;
  if (difficult > relevant.length / 2) {
    return {
      minutes: Math.max(1, Math.round(baseMinutes * 1.2)),
      samples: relevant.length,
      difficult,
      direction: 'longer'
    };
  }
  const span = relevant.length > 1
    ? Math.max(...relevant.map((event) => event.timestamp)) -
      Math.min(...relevant.map((event) => event.timestamp))
    : 0;
  if (relevant.length >= 6 && span >= 2 * 60 * 60 * 1_000) {
    return {
      minutes: Math.max(1, Math.round(baseMinutes * 0.9)),
      samples: relevant.length,
      difficult,
      direction: 'shorter'
    };
  }
  return {
    minutes: baseMinutes,
    samples: relevant.length,
    difficult,
    direction: 'base'
  };
};

export const buildWeeklyReport = (
  events: readonly ReminderEvent[],
  settings: Pick<
    Settings,
    'eyeIntervalMinutes' | 'walkIntervalMinutes' | 'historyRetentionDays' | 'reminderMode'
  >,
  now: number = Date.now()
): WeeklyReport => {
  const currentStart = startOfWeek(now);
  const previousStart = currentStart - 7 * DAY_MS;
  const current = summarizeEvents(events, currentStart, now + 1);
  const previous = summarizeEvents(events, previousStart, currentStart);
  const eyeRecommendation = recommendInterval(
    events,
    'eye',
    settings.eyeIntervalMinutes,
    currentStart,
    now + 1
  );
  const walkRecommendation = recommendInterval(
    events,
    'walk',
    settings.walkIntervalMinutes,
    currentStart,
    now + 1
  );
  const adjustedKinds = [
    eyeRecommendation.direction === 'longer' ? '护眼' : null,
    walkRecommendation.direction === 'longer' ? '走动' : null
  ].filter((kind): kind is string => Boolean(kind));
  const adaptiveSampleCount = eyeRecommendation.samples + walkRecommendation.samples;
  const recentAfternoon = events
    .filter((event) => {
      const hour = new Date(event.timestamp).getHours();
      return (
        event.timestamp >= currentStart &&
        event.timestamp <= now &&
        hour >= 12 &&
        hour < 18 &&
        event.action !== 'natural-break'
      );
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);
  const afternoonSnoozes = recentAfternoon.filter((event) => event.action === 'snooze').length;
  const recommendedMode =
    recentAfternoon.length >= 2 && afternoonSnoozes >= 2
      ? 'gentle'
      : settings.reminderMode;
  const shortenedKinds = [
    eyeRecommendation.direction === 'shorter' ? '护眼' : null,
    walkRecommendation.direction === 'shorter' ? '走动' : null
  ].filter((kind): kind is string => Boolean(kind));
  const recommendationReason =
    recommendedMode !== settings.reminderMode
      ? '下午连续选择稍后，下一次临时使用温和模式，完成后仍按原设置'
      : adaptiveSampleCount < 4
      ? `本周仅有 ${adaptiveSampleCount} 个可用样本，先沿用你的基准节奏`
      : adjustedKinds.length > 0
        ? `${adjustedKinds.join('和')}提醒中，稍后或跳过超过一半，因此仅放宽 20%`
        : shortenedKinds.length > 0
          ? `${shortenedKinds.join('和')}连续活跃超过 2 小时，下一周期暂时缩短 10%`
        : '本周完成节奏稳定，继续沿用你的基准间隔';
  return {
    generatedAt: now,
    currentStart,
    previousStart,
    current,
    previous,
    completedDelta: current.complete - previous.complete,
    recommendedEyeMinutes: eyeRecommendation.minutes,
    recommendedWalkMinutes: walkRecommendation.minutes,
    recommendedMode,
    recommendationReason,
    adaptiveSampleCount,
    retentionDays: settings.historyRetentionDays
  };
};

export const buildCareStatus = (
  events: readonly ReminderEvent[],
  now: number = Date.now()
): CareStatus => {
  const todayStart = startOfDay(now);
  const today = events.filter((event) => event.timestamp >= todayStart && event.timestamp <= now);
  const completedToday = today.filter((event) => event.action === 'complete').length;
  const snoozedToday = today.filter((event) => event.action === 'snooze').length;
  const skippedToday = today.filter((event) => event.action === 'skip').length;
  const naturalBreaksToday = today.filter(
    (event) => event.action === 'natural-break'
  ).length;
  const score = Math.max(
    0,
    Math.min(
      100,
      50 +
        completedToday * 10 +
        naturalBreaksToday * 8 -
        snoozedToday * 4 -
        skippedToday * 8
    )
  );
  const hour = new Date(now).getHours();
  const lastComplete = [...today]
    .reverse()
    .find((event) => event.action === 'complete');
  const recentlyCompleted = Boolean(
    lastComplete && now - lastComplete.timestamp <= 10 * 60 * 1_000
  );
  const mood =
    hour >= 22 || hour < 7
      ? 'sleeping'
      : recentlyCompleted
        ? 'happy'
        : snoozedToday >= 2 && snoozedToday > completedToday
          ? 'tired'
          : 'calm';
  const accessory =
    completedToday >= 8
      ? 'leaf'
      : completedToday >= 5
        ? 'glasses'
        : completedToday >= 3
          ? 'cup'
          : 'none';
  const message =
    today.length === 0
      ? '今天从轻松开始'
      : mood === 'happy'
        ? '休息得很好，继续保持舒服的节奏'
        : mood === 'tired'
          ? '今天稍后有点多，下一次试着停一小会儿'
          : mood === 'sleeping'
            ? '夜深了，青蛙也准备休息'
            : `今天已认真休息 ${completedToday + naturalBreaksToday} 次`;
  return {
    score,
    completedToday,
    snoozedToday,
    skippedToday,
    naturalBreaksToday,
    mood,
    accessory,
    message
  };
};

export class ReminderHistoryStore extends EventEmitter {
  private readonly filePath: string;
  private events: ReminderEvent[];

  constructor(private readonly dataDir: string) {
    super();
    this.filePath = join(dataDir, HISTORY_FILE);
    this.events = this.read();
  }

  getEvents(): ReminderEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  record(event: ReminderEvent, settings: Settings): void {
    if (!settings.historyEnabled) {
      return;
    }
    const sanitized = sanitizeReminderEvent(event);
    if (!sanitized) {
      return;
    }
    this.events = [...this.events, sanitized];
    this.prune(settings.historyRetentionDays, sanitized.timestamp);
    this.write();
    this.emit('changed');
  }

  applyRetention(days: 30 | 90, now: number = Date.now()): void {
    const before = this.events.length;
    this.prune(days, now);
    if (this.events.length !== before) {
      this.write();
      this.emit('changed');
    }
  }

  clear(): void {
    if (this.events.length === 0) {
      return;
    }
    this.events = [];
    this.write();
    this.emit('changed');
  }

  replaceEvents(events: readonly ReminderEvent[], settings: Settings): void {
    const sanitized = events
      .map((event) => sanitizeReminderEvent(event))
      .filter((event): event is ReminderEvent => Boolean(event));
    this.events = sanitized;
    this.prune(settings.historyRetentionDays, Date.now());
    this.write();
    this.emit('changed');
  }

  getWeeklyReport(settings: Settings, now: number = Date.now()): WeeklyReport {
    return buildWeeklyReport(this.events, settings, now);
  }

  getCareStatus(now: number = Date.now()): CareStatus {
    return buildCareStatus(this.events, now);
  }

  export(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return `${JSON.stringify({ version: HISTORY_SCHEMA_VERSION, events: this.events }, null, 2)}\n`;
    }
    const escape = (value: string | number): string => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const rows = [
      ['timestamp', 'kind', 'scheduledAt', 'shownAt', 'action', 'snoozeCount', 'mode'],
      ...this.events.map((event) => [
        new Date(event.timestamp).toISOString(),
        event.kind,
        new Date(event.scheduledAt).toISOString(),
        new Date(event.shownAt).toISOString(),
        event.action,
        event.snoozeCount,
        event.mode
      ])
    ];
    return `${rows.map((row) => row.map(escape).join(',')).join('\n')}\n`;
  }

  onChanged(callback: () => void): void {
    this.on('changed', callback);
  }

  private prune(days: 30 | 90, now: number): void {
    const cutoff = now - days * DAY_MS;
    this.events = this.events.filter((event) => event.timestamp >= cutoff);
  }

  private read(): ReminderEvent[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as {
        version?: unknown;
        events?: unknown;
      };
      if (parsed.version !== HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.events)) {
        throw new Error('unsupported reminder history');
      }
      return parsed.events
        .map((event) => sanitizeReminderEvent(event))
        .filter((event): event is ReminderEvent => Boolean(event));
    } catch {
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch {
        // Best effort; the caller still receives a clean local history.
      }
      return [];
    }
  }

  private write(): void {
    mkdirSync(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(
      tempPath,
      `${JSON.stringify({ version: HISTORY_SCHEMA_VERSION, events: this.events }, null, 2)}\n`,
      'utf8'
    );
    renameSync(tempPath, this.filePath);
  }
}
