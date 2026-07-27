export type ReminderKind = 'eye' | 'walk' | 'combined';
export type SingleReminderKind = Exclude<ReminderKind, 'combined'>;
export type ReminderAction = 'complete' | 'snooze' | 'skip';
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
 * Enforcement style of a reminder. The scheduler currently always emits
 * 'focused' (dim + wait before complete); the other modes are reserved for
 * the settings-preset work described in USERPLAN §6.
 */
export type ReminderMode = 'gentle' | 'guided' | 'focused';

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
}

export interface Settings {
  eyeIntervalMinutes: number;
  walkIntervalMinutes: number;
  snoozeMinutes: number;
  startWithWindows: boolean;
  petScale: number;
  petPosition: PetPosition | null;
  petSkin: PetSkin;
  dimDesktop: boolean;
  alarms: Alarm[];
  todos: TodoItem[];
}

export interface ActiveReminder {
  id: string;
  kind: ReminderKind;
  kinds: SingleReminderKind[];
  startedAt: number;
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
}

export interface ReminderStatus {
  nextEyeAt: number;
  nextWalkAt: number;
  pausedUntil: number | null;
  activeReminder: ActiveReminder | null;
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
  testReminder: (kind: ReminderKind) => Promise<ReminderStatus>;
  pause: (minutes: number) => Promise<ReminderStatus>;
  openSettings: () => Promise<void>;
  closeSettings: () => Promise<void>;
  openPanel: (tab: PanelTab) => Promise<void>;
  closePanel: () => Promise<void>;
  getPanelTab: () => Promise<PanelTab>;
  onPanelTab: (callback: (tab: PanelTab) => void) => () => void;
  /** Fired when the panel lost focus to a window outside the app. */
  onPanelBlur: (callback: () => void) => () => void;
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
  clearCompletedTodos: () => Promise<TodoItem[]>;
  onTodosChanged: (callback: (todos: TodoItem[]) => void) => () => void;
  /** Continue a paused countdown from now (no-op when not paused). */
  resume: () => Promise<ReminderStatus>;
  /** Discard pause/progress and start both cycles over. */
  restartCycle: () => Promise<ReminderStatus>;
}

export const DEFAULT_SETTINGS: Settings = {
  eyeIntervalMinutes: 20,
  walkIntervalMinutes: 60,
  snoozeMinutes: 5,
  startWithWindows: false,
  petScale: 1,
  petPosition: null,
  petSkin: 'stable',
  dimDesktop: true,
  alarms: [],
  todos: []
};

export const SETTINGS_LIMITS = {
  eyeIntervalMinutes: { min: 1, max: 240 },
  walkIntervalMinutes: { min: 1, max: 240 },
  snoozeMinutes: { min: 1, max: 60 },
  petScale: { min: 0.7, max: 1.8 }
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
  return { id: candidate.id, text, createdAt, completed, completedAt, priority };
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
