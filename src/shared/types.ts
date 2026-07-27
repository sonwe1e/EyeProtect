export type ReminderKind = 'eye' | 'walk' | 'combined';
export type SingleReminderKind = Exclude<ReminderKind, 'combined'>;
export type ReminderAction = 'complete' | 'snooze' | 'skip';
export type ReminderEventAction = ReminderAction | 'natural-break';
export type TodoPriority = 'normal' | 'important' | 'urgent';

export const TODO_PRIORITIES: TodoPriority[] = ['normal', 'important', 'urgent'];

/** Cycle helper for the priority dot: 普通 → 重要 → 紧急 → 普通. */
export const nextTodoPriority = (current: TodoPriority): TodoPriority => {
  const index = TODO_PRIORITIES.indexOf(current);
  return TODO_PRIORITIES[(index + 1) % TODO_PRIORITIES.length];
};

export type PetSkin = 'stable' | 'eye' | 'fu' | 'sleep';

export const PET_SKINS: PetSkin[] = ['stable', 'eye', 'fu', 'sleep'];

/**
 * Enforcement style of a reminder, chosen in settings:
 * - 'gentle': a pet-side bubble; no dimming; every action available at once.
 * - 'guided': the alert card without an enforced wait; complete is immediate.
 * - 'focused': dim overlays plus the enforced rest wait before completing.
 */
export type ReminderMode = 'gentle' | 'guided' | 'focused';

export const REMINDER_MODES: ReminderMode[] = ['gentle', 'guided', 'focused'];

/** Seconds before a deadline that the soft pre-alert bubble appears; 0 disables it. */
export const PRE_ALERT_LIMIT = { min: 0, max: 120 } as const;

/** A soft heads-up shown ahead of the real reminder (USERPLAN §一.2). */
export interface PreAlertInfo {
  kind: SingleReminderKind;
  /** Epoch ms when the full reminder fires if the user takes no action. */
  firesAt: number;
}

export type PreAlertAction = 'start' | 'snooze' | 'dismiss';

/**
 * A concrete micro-break suggestion (USERPLAN §一.3). The main process picks
 * one when a reminder starts and stores its id in ActiveReminder, so a
 * renderer reload shows the same activity instead of re-rolling.
 */
export interface BreakActivity {
  id: string;
  kind: SingleReminderKind;
  title: string;
  steps: string[];
  /** Roughly how long the activity takes; used to pace the step progress. */
  durationSeconds: number;
  tags: string[];
}

export type AlarmRepeat = 'once' | 'daily';

export type PanelTab = 'alarms' | 'todos';

export interface Alarm {
  id: string;
  hour: number;
  minute: number;
  label?: string;
  repeat: AlarmRepeat;
  enabled: boolean;
  createdAt: number;
}

export interface PetPosition {
  x: number;
  y: number;
}

export interface TodoItem {
  id: string;
  text: string;
  createdAt: number;
  completed: boolean;
  /** Epoch ms when the item was last marked completed; cleared on un-complete. */
  completedAt?: number;
  /** Display priority; higher levels sort first. Defaults to 'normal'. */
  priority: TodoPriority;
  /** Whether this is normally handled at the desk or while away from it. */
  context?: 'desk' | 'away';
  /** Surface this item inside the next walk/combined reminder. */
  remindOnBreak?: boolean;
}

export interface Settings {
  eyeIntervalMinutes: number;
  walkIntervalMinutes: number;
  snoozeMinutes: number;
  /** How reminders enforce themselves; see ReminderMode. */
  reminderMode: ReminderMode;
  /** Soft bubble this many seconds before each deadline; 0 turns it off. */
  preAlertSeconds: number;
  startWithWindows: boolean;
  petScale: number;
  petPosition: PetPosition | null;
  /** One absolute pet position per connected-display topology. */
  petPositionsByLayout: Record<string, PetPosition>;
  petSkin: PetSkin;
  /** Dims the desktop behind focused-mode reminders. */
  dimDesktop: boolean;
  /** Persist local reminder behavior for care feedback and weekly reports. */
  historyEnabled: boolean;
  /** Rolling local retention window; no history is uploaded. */
  historyRetentionDays: 30 | 90;
  /** Automatically use bounded, history-derived intervals for the next cycle. */
  adaptiveEnabled: boolean;
  /** Suppress reminders between these local minute-of-day values. */
  quietHoursEnabled: boolean;
  quietHoursStartMinutes: number;
  quietHoursEndMinutes: number;
  /**
   * Check the foreground application once when a reminder becomes due.
   * Matching is restricted to the explicit local whitelist below.
   */
  foregroundDetectionEnabled: boolean;
  quietAppWhitelist: string[];
  hotkeysEnabled: boolean;
  alarms: Alarm[];
  todos: TodoItem[];
}

export interface ActiveReminder {
  id: string;
  kind: ReminderKind;
  kinds: SingleReminderKind[];
  startedAt: number;
  /** Original deadline represented by this reminder. */
  scheduledAt: number;
  /**
   * Epoch ms before which 'complete' is rejected by the main process. The
   * renderer only displays the countdown; it cannot grant itself early
   * completion (reload or duplicate IPC cannot bypass the rule).
   */
  unlockAt: number;
  /**
   * Epoch ms before which another 'snooze' is rejected. The first snooze of a
   * cycle is immediate; later snoozes have to wait out the rest countdown.
   */
  snoozeAllowedAt: number;
  mode: ReminderMode;
  /** How many times this reminder cycle has been snoozed; resets on complete/skip. */
  snoozeCount: number;
  /**
   * Main-process-selected micro-break activities. One entry for eye/walk
   * reminders; combined reminders carry one eye and one walk activity.
   */
  activityIds: string[];
  /**
   * Snapshot of one pending away-from-desk todo selected when a walk break
   * starts. Keeping the copy here makes the reminder stable across renderer
   * reloads while the live todo remains addressable by id.
   */
  breakTodo: Pick<TodoItem, 'id' | 'text'> | null;
}

export interface ReminderEvent {
  timestamp: number;
  kind: ReminderKind;
  scheduledAt: number;
  shownAt: number;
  action: ReminderEventAction;
  snoozeCount: number;
  mode: ReminderMode;
}

export interface ReminderPeriodStats {
  total: number;
  complete: number;
  snooze: number;
  skip: number;
  naturalBreak: number;
  eyeComplete: number;
  walkComplete: number;
  completionRate: number;
  mostSkippedHour: number | null;
  longestActiveMinutes: number;
}

export interface WeeklyReport {
  generatedAt: number;
  currentStart: number;
  previousStart: number;
  current: ReminderPeriodStats;
  previous: ReminderPeriodStats;
  completedDelta: number;
  recommendedEyeMinutes: number;
  recommendedWalkMinutes: number;
  recommendedMode: ReminderMode;
  recommendationReason: string;
  adaptiveSampleCount: number;
  retentionDays: 30 | 90;
}

export type PetMood = 'calm' | 'anticipating' | 'happy' | 'tired' | 'sleeping';
export type PetAccessory = 'none' | 'cup' | 'glasses' | 'leaf';
export type HotkeyAction =
  | 'break-now'
  | 'pause-toggle'
  | 'todo-add'
  | 'todos'
  | 'pet-toggle';

export interface HotkeyStatus {
  enabled: boolean;
  registered: HotkeyAction[];
  conflicts: HotkeyAction[];
}

export interface DataActionResult {
  success: boolean;
  message: string;
}

export interface DataRecoveryInfo {
  dataDir: string;
  corruptBackups: string[];
}

export interface CareStatus {
  score: number;
  completedToday: number;
  snoozedToday: number;
  skippedToday: number;
  naturalBreaksToday: number;
  mood: PetMood;
  accessory: PetAccessory;
  message: string;
}

export interface ContextDeferral {
  until: number;
  reason: string;
  foregroundApp: string | null;
  consecutiveCount: number;
}

export interface ReminderStatus {
  nextEyeAt: number;
  nextWalkAt: number;
  pausedUntil: number | null;
  activeReminder: ActiveReminder | null;
  /** Set while the soft pre-alert bubble is up; null otherwise. */
  preAlert: PreAlertInfo | null;
  /** Last automatic scene-aware postponement, cleared when a reminder is shown or manually controlled. */
  contextDeferral: ContextDeferral | null;
}

export interface RuntimeInfo {
  appVersion: string;
  isPackaged: boolean;
  dataDir: string;
}

export interface EyeProtectApi {
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Partial<Settings>) => Promise<Settings>;
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  getReminderStatus: () => Promise<ReminderStatus>;
  reminderAction: (action: ReminderAction, reminderId: string) => Promise<ReminderStatus>;
  /** Act on the soft pre-alert: start now, push back 2 min, or keep the plan. */
  preAlertAction: (action: PreAlertAction) => Promise<ReminderStatus>;
  testReminder: (kind: ReminderKind) => Promise<ReminderStatus>;
  triggerNow: () => Promise<ReminderStatus>;
  pause: (minutes: number) => Promise<ReminderStatus>;
  openSettings: () => Promise<void>;
  closeSettings: () => Promise<void>;
  openPanel: (tab: PanelTab) => Promise<void>;
  openQuickTodo: () => Promise<void>;
  closePanel: () => Promise<void>;
  getPanelTab: () => Promise<PanelTab>;
  consumeQuickAddTodo: () => Promise<boolean>;
  onPanelTab: (callback: (tab: PanelTab) => void) => () => void;
  /** Fired when the panel lost focus to a window outside the app. */
  onPanelBlur: (callback: () => void) => () => void;
  onQuickAddTodo: (callback: () => void) => () => void;
  onSettingsChanged: (callback: (settings: Settings) => void) => () => void;
  onReminderChanged: (callback: (status: ReminderStatus) => void) => () => void;
  getAlarms: () => Promise<Alarm[]>;
  setAlarm: (input: Omit<Alarm, 'id' | 'createdAt'>) => Promise<Alarm[]>;
  cancelAlarm: (id: string) => Promise<Alarm[]>;
  onAlarmFired: (callback: (alarm: Alarm) => void) => () => void;
  onAlarmsChanged: (callback: (alarms: Alarm[]) => void) => () => void;
  getTodos: () => Promise<TodoItem[]>;
  addTodo: (text: string) => Promise<TodoItem[]>;
  toggleTodo: (id: string) => Promise<TodoItem[]>;
  updateTodo: (id: string, text: string) => Promise<TodoItem[]>;
  removeTodo: (id: string) => Promise<TodoItem[]>;
  setTodoPriority: (id: string, priority: TodoPriority) => Promise<TodoItem[]>;
  setTodoBreakReminder: (id: string, enabled: boolean) => Promise<TodoItem[]>;
  clearCompletedTodos: () => Promise<TodoItem[]>;
  onTodosChanged: (callback: (todos: TodoItem[]) => void) => () => void;
  getWeeklyReport: () => Promise<WeeklyReport>;
  getCareStatus: () => Promise<CareStatus>;
  clearReminderHistory: () => Promise<WeeklyReport>;
  exportReminderHistory: (format: 'json' | 'csv') => Promise<boolean>;
  onWeeklyReportChanged: (callback: (report: WeeklyReport) => void) => () => void;
  onCareStatusChanged: (callback: (status: CareStatus) => void) => () => void;
  getHotkeyStatus: () => Promise<HotkeyStatus>;
  onHotkeyStatusChanged: (callback: (status: HotkeyStatus) => void) => () => void;
  exportBackup: () => Promise<DataActionResult>;
  importBackup: () => Promise<DataActionResult>;
  resetToDefaults: () => Promise<DataActionResult>;
  openDataDirectory: () => Promise<DataActionResult>;
  getDataRecoveryInfo: () => Promise<DataRecoveryInfo>;
  /** Continue a paused countdown from now (no-op when not paused). */
  resume: () => Promise<ReminderStatus>;
  /** Discard pause/progress and start both cycles over. */
  restartCycle: () => Promise<ReminderStatus>;
}

export const DEFAULT_SETTINGS: Settings = {
  eyeIntervalMinutes: 20,
  walkIntervalMinutes: 60,
  snoozeMinutes: 5,
  reminderMode: 'guided',
  preAlertSeconds: 30,
  startWithWindows: false,
  petScale: 1,
  petPosition: null,
  petPositionsByLayout: {},
  petSkin: 'stable',
  dimDesktop: true,
  historyEnabled: true,
  historyRetentionDays: 30,
  adaptiveEnabled: false,
  quietHoursEnabled: false,
  quietHoursStartMinutes: 22 * 60,
  quietHoursEndMinutes: 8 * 60,
  foregroundDetectionEnabled: false,
  quietAppWhitelist: [],
  hotkeysEnabled: true,
  alarms: [],
  todos: []
};

export const SETTINGS_LIMITS = {
  eyeIntervalMinutes: { min: 1, max: 240 },
  walkIntervalMinutes: { min: 1, max: 240 },
  snoozeMinutes: { min: 1, max: 60 },
  preAlertSeconds: PRE_ALERT_LIMIT,
  petScale: { min: 0.7, max: 1.8 },
  minuteOfDay: { min: 0, max: 24 * 60 - 1 }
} as const;

export const TODO_TEXT_MAX = 60;
export const ALARM_LABEL_MAX = 20;

export const sanitizeTodo = (value: unknown): TodoItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<TodoItem>;
  if (typeof candidate.id !== 'string' || !candidate.id) {
    return null;
  }
  if (typeof candidate.text !== 'string') {
    return null;
  }
  const text = candidate.text.trim().slice(0, TODO_TEXT_MAX);
  if (!text) {
    return null;
  }
  const createdAt =
    typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
      ? candidate.createdAt
      : Date.now();
  const completed = typeof candidate.completed === 'boolean' ? candidate.completed : false;
  const completedAt =
    typeof candidate.completedAt === 'number' && Number.isFinite(candidate.completedAt)
      ? candidate.completedAt
      : undefined;
  const priority: TodoPriority =
    candidate.priority === 'important' || candidate.priority === 'urgent' ? candidate.priority : 'normal';
  const remindOnBreak = candidate.remindOnBreak === true;
  const context = candidate.context === 'away' || remindOnBreak ? 'away' : 'desk';
  return {
    id: candidate.id,
    text,
    createdAt,
    completed,
    completedAt,
    priority,
    context,
    remindOnBreak
  };
};

export const sanitizeTodos = (value: unknown): TodoItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => sanitizeTodo(entry)).filter((entry): entry is TodoItem => Boolean(entry));
};

const PRIORITY_RANK: Record<TodoPriority, number> = { urgent: 0, important: 1, normal: 2 };

/** Display order: pending items first (higher priority first, then insertion
 * order), then completed sunk to the bottom ordered by when they were
 * completed. Storage stays append-only. */
export const sortTodosForDisplay = (todos: TodoItem[]): TodoItem[] => {
  const pending = todos
    .filter((todo) => !todo.completed)
    .sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt
    );
  const done = todos
    .filter((todo) => todo.completed)
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
  return [...pending, ...done];
};

export const sanitizeAlarm = (value: unknown): Alarm | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<Alarm>;
  if (typeof candidate.id !== 'string' || !candidate.id) {
    return null;
  }
  if (typeof candidate.hour !== 'number' || candidate.hour < 0 || candidate.hour > 23 || !Number.isInteger(candidate.hour)) {
    return null;
  }
  if (typeof candidate.minute !== 'number' || candidate.minute < 0 || candidate.minute > 59 || !Number.isInteger(candidate.minute)) {
    return null;
  }
  if (candidate.label !== undefined && typeof candidate.label !== 'string') {
    return null;
  }
  if (candidate.repeat !== 'once' && candidate.repeat !== 'daily') {
    return null;
  }
  if (typeof candidate.enabled !== 'boolean') {
    return null;
  }
  const label =
    typeof candidate.label === 'string'
      ? candidate.label.trim().slice(0, ALARM_LABEL_MAX) || undefined
      : undefined;
  const createdAt =
    typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
      ? candidate.createdAt
      : Date.now();
  return {
    id: candidate.id,
    hour: candidate.hour,
    minute: candidate.minute,
    label,
    repeat: candidate.repeat,
    enabled: candidate.enabled,
    createdAt
  };
};

export const sanitizeAlarms = (value: unknown): Alarm[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => sanitizeAlarm(entry)).filter((entry): entry is Alarm => Boolean(entry));
};
