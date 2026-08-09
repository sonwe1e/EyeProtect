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

export type StandaloneReminderSchedule =
  | { type: 'once'; fireAt: number }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekdays'; hour: number; minute: number }
  | { type: 'weekly'; weekdays: number[]; hour: number; minute: number }
  | { type: 'custom'; anchorAt: number; intervalDays: number };

export interface StandaloneReminder {
  id: string;
  label: string;
  schedule: StandaloneReminderSchedule;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StandaloneReminderInput {
  label?: string;
  schedule: StandaloneReminderSchedule;
  enabled?: boolean;
}

export interface PersistedScheduledEvent {
  id: string;
  owner: 'break' | 'task' | 'standalone' | 'system';
  type: string;
  fireAt: number;
  revision: number;
  payloadRef: string | null;
}

/**
 * v1.1 Task Core (USERPLAN §二). A Task is the canonical work item: richer than
 * the legacy TodoItem, with separate planned-vs-deadline dates, projects,
 * subtasks, tags, recurrence, and a desk/away/any context. TodoItem remains an
 * import-only compatibility shape; the first successful SQLite migration
 * removes its persisted source.
 */
export type TaskStatus = 'inbox' | 'active' | 'done' | 'archived';

export const TASK_STATUSES: TaskStatus[] = ['inbox', 'active', 'done', 'archived'];

/**
 * Where a task is normally handled. `away` tasks are surfaced during walk
 * reminders ("while you're up, consider…"); `desk` tasks are the default;
 * `any` tasks show in both. This is the plan's key product differentiator.
 */
export type TaskContext = 'desk' | 'away' | 'any';

export const TASK_CONTEXTS: TaskContext[] = ['desk', 'away', 'any'];

export interface RecurrenceRuleDaily {
  type: 'daily';
  interval: number;
}
export interface RecurrenceRuleWeekly {
  type: 'weekly';
  interval: number;
  /** 0 (Sun) – 6 (Sat). Fixed weekdays, distinct from "after completion". */
  weekdays: number[];
}
export interface RecurrenceRuleMonthly {
  type: 'monthly';
  interval: number;
  day: number;
}
export interface RecurrenceRuleAfterCompletion {
  type: 'after-completion';
  days: number;
}
export type RecurrenceRule =
  | RecurrenceRuleDaily
  | RecurrenceRuleWeekly
  | RecurrenceRuleMonthly
  | RecurrenceRuleAfterCompletion;

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TodoPriority;
  projectId: string | null;
  parentId: string | null;
  tags: string[];
  /** When you intend to work on it. Distinct from the hard deadline (USERPLAN §二 plannedAt !== dueAt). */
  plannedAt: number | null;
  /** Hard deadline. */
  dueAt: number | null;
  /** Optional standalone reminder deadline registered with the scheduler kernel. */
  reminderAt: number | null;
  recurrence: RecurrenceRule | null;
  context: TaskContext;
  estimateMinutes: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface Project {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** Fields a renderer may supply when creating a task. */
export interface TaskInput {
  title: string;
  notes?: string | null;
  priority?: TodoPriority;
  projectId?: string | null;
  parentId?: string | null;
  tags?: string[];
  plannedAt?: number | null;
  dueAt?: number | null;
  reminderAt?: number | null;
  recurrence?: RecurrenceRule | null;
  context?: TaskContext;
  estimateMinutes?: number | null;
}

/** Partial update; `status` is separate because it drives recurrence + stats. */
export type TaskUpdateInput = Partial<TaskInput> & {
  status?: TaskStatus;
  /** Used by the Workbench's explicit move controls. */
  sortOrder?: number;
};

export interface ProjectInput {
  name: string;
  color?: string | null;
  parentId?: string | null;
}

export type ProjectUpdateInput = Partial<ProjectInput>;

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
  /**
   * The task the user is currently working on (USERPLAN §四 rhythm loop). When
   * a break ends, the workbench can surface "resume: <active task>". Null when no
   * task is active. Persisted so it survives restarts.
   */
  activeTaskId: string | null;
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
  breakTask: Pick<Task, 'id' | 'title'> | null;
}

/**
 * The subset of an active reminder that survives a crash/restart (USERPLAN §一.3).
 * Persisted next to the scheduler snapshot: if the app dies mid-break, the next
 * launch restores the in-progress session instead of recomputing from a stale
 * deadline. Transient fields (the per-event `id`) are intentionally dropped.
 */
export interface PersistedBreakSession {
  kind: ReminderKind;
  kinds: SingleReminderKind[];
  startedAt: number;
  scheduledAt: number;
  unlockAt: number;
  snoozeAllowedAt: number;
  mode: ReminderMode;
  snoozeCount: number;
  activityIds: string[];
  breakTask: Pick<Task, 'id' | 'title'> | null;
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
  // --- v1.1 Task Core (USERPLAN §二) ---
  /** All tasks (any view/filter is applied in the renderer). */
  getTasks: () => Promise<Task[]>;
  getTask: (id: string) => Promise<Task | null>;
  createTask: (input: TaskInput) => Promise<Task[]>;
  updateTask: (id: string, input: TaskUpdateInput) => Promise<Task[]>;
  setTaskStatus: (id: string, status: TaskStatus) => Promise<Task[]>;
  deleteTask: (id: string) => Promise<Task[]>;
  onTasksChanged: (callback: (tasks: Task[]) => void) => () => void;
  getProjects: () => Promise<Project[]>;
  getProject: (id: string) => Promise<Project | null>;
  createProject: (input: ProjectInput) => Promise<Project[]>;
  updateProject: (id: string, input: ProjectUpdateInput) => Promise<Project[]>;
  deleteProject: (id: string) => Promise<Project[]>;
  onProjectsChanged: (callback: (projects: Project[]) => void) => () => void;
  getActiveTaskId: () => Promise<string | null>;
  setActiveTask: (id: string | null) => Promise<Task[]>;
  onActiveTaskChanged: (callback: (id: string | null) => void) => () => void;
  getStandaloneReminders: () => Promise<StandaloneReminder[]>;
  createStandaloneReminder: (input: StandaloneReminderInput) => Promise<StandaloneReminder[]>;
  updateStandaloneReminder: (id: string, input: Partial<StandaloneReminderInput>) => Promise<StandaloneReminder[]>;
  deleteStandaloneReminder: (id: string) => Promise<StandaloneReminder[]>;
  onStandaloneRemindersChanged: (callback: (reminders: StandaloneReminder[]) => void) => () => void;
  onStandaloneReminderFired: (callback: (reminder: StandaloneReminder) => void) => () => void;
  openWorkbench: (section?: 'today' | 'settings' | 'reminders') => Promise<void>;
  closeWorkbench: () => Promise<void>;
  getWorkbenchSection: () => Promise<'today' | 'settings' | 'reminders'>;
  onWorkbenchNavigate: (callback: (section: 'today' | 'settings' | 'reminders') => void) => () => void;
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
  todos: [],
  activeTaskId: null
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

export const sanitizeStandaloneReminderSchedule = (value: unknown): StandaloneReminderSchedule | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const validClock =
    Number.isInteger(candidate.hour) && Number(candidate.hour) >= 0 && Number(candidate.hour) <= 23 &&
    Number.isInteger(candidate.minute) && Number(candidate.minute) >= 0 && Number(candidate.minute) <= 59;
  switch (candidate.type) {
    case 'once':
      return typeof candidate.fireAt === 'number' && Number.isFinite(candidate.fireAt) && candidate.fireAt > 0
        ? { type: 'once', fireAt: candidate.fireAt }
        : null;
    case 'daily':
      return validClock ? { type: 'daily', hour: Number(candidate.hour), minute: Number(candidate.minute) } : null;
    case 'weekdays':
      return validClock ? { type: 'weekdays', hour: Number(candidate.hour), minute: Number(candidate.minute) } : null;
    case 'weekly': {
      const weekdays = Array.isArray(candidate.weekdays)
        ? [...new Set(candidate.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
        : [];
      return validClock && weekdays.length > 0
        ? { type: 'weekly', weekdays, hour: Number(candidate.hour), minute: Number(candidate.minute) }
        : null;
    }
    case 'custom':
      return typeof candidate.anchorAt === 'number' && Number.isFinite(candidate.anchorAt) && candidate.anchorAt > 0 &&
        Number.isInteger(candidate.intervalDays) && Number(candidate.intervalDays) > 0 && Number(candidate.intervalDays) <= 365
        ? { type: 'custom', anchorAt: candidate.anchorAt, intervalDays: Number(candidate.intervalDays) }
        : null;
    default:
      return null;
  }
};

export const sanitizeStandaloneReminder = (value: unknown, now: number = Date.now()): StandaloneReminder | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<StandaloneReminder>;
  const schedule = sanitizeStandaloneReminderSchedule(candidate.schedule);
  if (typeof candidate.id !== 'string' || !candidate.id || !schedule) {
    return null;
  }
  const createdAt = typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : now;
  return {
    id: candidate.id,
    label: typeof candidate.label === 'string' ? candidate.label.trim().slice(0, ALARM_LABEL_MAX) : '',
    schedule,
    enabled: candidate.enabled !== false,
    createdAt,
    updatedAt: typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : createdAt
  };
};

export const nextStandaloneReminderFireAt = (
  schedule: StandaloneReminderSchedule,
  now: number = Date.now()
): number | null => {
  if (schedule.type === 'once') {
    return schedule.fireAt >= now ? schedule.fireAt : null;
  }
  if (schedule.type === 'custom') {
    if (schedule.anchorAt >= now) {
      return schedule.anchorAt;
    }
    // Calendar-day recurrence must retain the user's local wall-clock time.
    // Adding 24-hour milliseconds drifts by an hour across a DST boundary.
    const candidate = new Date(schedule.anchorAt);
    const anchorDay = new Date(
      candidate.getFullYear(),
      candidate.getMonth(),
      candidate.getDate()
    ).getTime();
    const reference = new Date(now);
    const referenceDay = new Date(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate()
    ).getTime();
    const approximateDays = Math.max(0, Math.round((referenceDay - anchorDay) / 86_400_000));
    const jumps = Math.max(1, Math.floor(approximateDays / schedule.intervalDays));
    candidate.setDate(candidate.getDate() + jumps * schedule.intervalDays);
    while (candidate.getTime() < now) {
      candidate.setDate(candidate.getDate() + schedule.intervalDays);
    }
    return candidate.getTime();
  }
  const allowed = schedule.type === 'daily'
    ? [0, 1, 2, 3, 4, 5, 6]
    : schedule.type === 'weekdays'
      ? [1, 2, 3, 4, 5]
      : schedule.weekdays;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);
    if (allowed.includes(candidate.getDay()) && candidate.getTime() >= now) {
      return candidate.getTime();
    }
  }
  return null;
};

export const TASK_TITLE_MAX = 120;
export const TASK_NOTES_MAX = 2000;
export const TASK_TAGS_MAX = 10;
export const PROJECT_NAME_MAX = 60;

const sanitizeRecurrenceRule = (value: unknown): RecurrenceRule | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<RecurrenceRule> & Record<string, unknown>;
  const interval =
    typeof candidate.interval === 'number' && Number.isInteger(candidate.interval) && candidate.interval > 0
      ? candidate.interval
      : 1;
  switch (candidate.type) {
    case 'daily':
      return { type: 'daily', interval };
    case 'weekly': {
      const weekdays = Array.isArray(candidate.weekdays)
        ? candidate.weekdays
            .filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)
            .slice(0, 7)
        : [];
      return { type: 'weekly', interval, weekdays };
    }
    case 'monthly': {
      const day =
        typeof candidate.day === 'number' && Number.isInteger(candidate.day) && candidate.day >= 1 && candidate.day <= 31
          ? candidate.day
          : 1;
      return { type: 'monthly', interval, day };
    }
    case 'after-completion': {
      const days =
        typeof candidate.days === 'number' && Number.isInteger(candidate.days) && candidate.days > 0
          ? candidate.days
          : 1;
      return { type: 'after-completion', days };
    }
    default:
      return null;
  }
};

const normalizeTaskTimestamp = (value: unknown, fallback: number | null): number | null => {
  if (value === null || value === undefined) {
    return fallback;
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
};

const sanitizeTagList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const tag = entry.trim().slice(0, 24);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
    if (result.length >= TASK_TAGS_MAX) {
      break;
    }
  }
  return result;
};

const asTaskStatus = (value: unknown): TaskStatus =>
  TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : 'inbox';

const asTaskContext = (value: unknown): TaskContext =>
  TASK_CONTEXTS.includes(value as TaskContext) ? (value as TaskContext) : 'desk';

/**
 * Coerce arbitrary input into a Task, or reject it. Used on every IPC ingress
 * and on load from disk, so a corrupt value can never propagate into the store.
 * `now` is injectable for deterministic tests.
 */
export const sanitizeTask = (value: unknown, now: number = Date.now()): Task | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<Task> & Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id) {
    return null;
  }
  if (typeof candidate.title !== 'string') {
    return null;
  }
  const title = candidate.title.trim().slice(0, TASK_TITLE_MAX);
  if (!title) {
    return null;
  }
  const createdAt = normalizeTaskTimestamp(candidate.createdAt, now) ?? now;
  const updatedAt = normalizeTaskTimestamp(candidate.updatedAt, createdAt) ?? createdAt;
  // Legacy TodoItem uses a bare `completed` flag. Honor it: a completed flag
  // with no explicit done status means "done" (the migration path). An explicit
  // status always wins, so a task can also be forced not-done via status.
  const legacyCompleted =
    candidate.status !== 'done' && typeof candidate.completed === 'boolean' && candidate.completed;
  const status: TaskStatus = legacyCompleted ? 'done' : asTaskStatus(candidate.status);
  const completedAt =
    status === 'done'
      ? normalizeTaskTimestamp(candidate.completedAt, updatedAt) ?? updatedAt
      : null;
  const priority: TodoPriority =
    candidate.priority === 'important' || candidate.priority === 'urgent' ? candidate.priority : 'normal';
  const projectId = typeof candidate.projectId === 'string' && candidate.projectId ? candidate.projectId : null;
  const parentId = typeof candidate.parentId === 'string' && candidate.parentId ? candidate.parentId : null;
  const recurrence = sanitizeRecurrenceRule(candidate.recurrence);
  const context = asTaskContext(candidate.context);
  const estimateMinutes =
    typeof candidate.estimateMinutes === 'number' &&
    Number.isFinite(candidate.estimateMinutes) &&
    candidate.estimateMinutes > 0
      ? Math.round(candidate.estimateMinutes)
      : null;
  const sortOrder =
    typeof candidate.sortOrder === 'number' && Number.isFinite(candidate.sortOrder)
      ? Math.round(candidate.sortOrder)
      : 0;
  return {
    id: candidate.id,
    title,
    notes: typeof candidate.notes === 'string' ? candidate.notes.trim().slice(0, TASK_NOTES_MAX) : null,
    status,
    priority,
    projectId,
    parentId,
    tags: sanitizeTagList(candidate.tags),
    plannedAt: normalizeTaskTimestamp(candidate.plannedAt, null),
    dueAt: normalizeTaskTimestamp(candidate.dueAt, null),
    reminderAt: normalizeTaskTimestamp(candidate.reminderAt, null),
    recurrence,
    context,
    estimateMinutes,
    sortOrder,
    createdAt,
    updatedAt,
    completedAt
  };
};

export const sanitizeTasks = (value: unknown, now: number = Date.now()): Task[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => sanitizeTask(entry, now))
    .filter((entry): entry is Task => Boolean(entry));
};

const asProjectColor = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const color = value.trim();
  // Accept only #rgb / #rrggbb to keep the value render-safe.
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : null;
};

export const sanitizeProject = (value: unknown, now: number = Date.now()): Project | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<Project> & Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id) {
    return null;
  }
  if (typeof candidate.name !== 'string') {
    return null;
  }
  const name = candidate.name.trim().slice(0, PROJECT_NAME_MAX);
  if (!name) {
    return null;
  }
  const createdAt = normalizeTaskTimestamp(candidate.createdAt, now) ?? now;
  const updatedAt = normalizeTaskTimestamp(candidate.updatedAt, createdAt) ?? createdAt;
  const parentId = typeof candidate.parentId === 'string' && candidate.parentId ? candidate.parentId : null;
  const sortOrder =
    typeof candidate.sortOrder === 'number' && Number.isFinite(candidate.sortOrder)
      ? Math.round(candidate.sortOrder)
      : 0;
  return {
    id: candidate.id,
    name,
    color: asProjectColor(candidate.color),
    parentId,
    sortOrder,
    createdAt,
    updatedAt
  };
};

export const sanitizeProjects = (value: unknown, now: number = Date.now()): Project[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => sanitizeProject(entry, now))
    .filter((entry): entry is Project => Boolean(entry));
};

/**
 * Pure recurrence math (USERPLAN §二). Given a rule and an epoch-ms reference
 * time, return the next fire-at >= reference, or null if the rule cannot
 * produce one. No Date-state mutation, no I/O — safe to unit-test and to call
 * from the scheduler. Kept here (shared) so both main and tests import one copy.
 */
export const nextRecurrenceFireAt = (
  rule: RecurrenceRule,
  reference: number,
  now: number = Date.now()
): number | null => {
  if (!rule || !Number.isFinite(reference)) {
    return null;
  }
  const from = Math.max(reference, now);
  const anchor = new Date(reference);
  switch (rule.type) {
    case 'daily': {
      const candidate = new Date(reference);
      if (candidate.getTime() >= from) {
        return candidate.getTime();
      }
      const elapsedDays = Math.max(
        0,
        calendarDayNumber(new Date(from)) - calendarDayNumber(candidate)
      );
      candidate.setDate(candidate.getDate() + Math.max(1, Math.floor(elapsedDays / rule.interval)) * rule.interval);
      while (candidate.getTime() < from) {
        candidate.setDate(candidate.getDate() + rule.interval);
      }
      return candidate.getTime();
    }
    case 'weekly': {
      if (rule.weekdays.length === 0) {
        return null;
      }
      const sorted = [...new Set(rule.weekdays)].sort((a, b) => a - b);
      const firstDay = new Date(from);
      firstDay.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds());
      const anchorWeekDay = calendarDayNumber(anchor) - anchor.getDay();
      for (let offset = 0; offset <= 7 * (rule.interval + 1); offset += 1) {
        const probe = new Date(firstDay);
        probe.setDate(firstDay.getDate() + offset);
        const probeWeekDay = calendarDayNumber(probe) - probe.getDay();
        const weekIndex = Math.floor((probeWeekDay - anchorWeekDay) / 7);
        if (
          weekIndex >= 0 &&
          weekIndex % rule.interval === 0 &&
          sorted.includes(probe.getDay()) &&
          probe.getTime() >= from
        ) {
          return probe.getTime();
        }
      }
      return null;
    }
    case 'monthly': {
      const anchorMonth = anchor.getFullYear() * 12 + anchor.getMonth();
      const fromDate = new Date(from);
      const fromMonth = fromDate.getFullYear() * 12 + fromDate.getMonth();
      const elapsedMonths = Math.max(0, fromMonth - anchorMonth);
      const initialJump = Math.floor(elapsedMonths / rule.interval) * rule.interval;
      for (let i = 0; i < 24; i += 1) {
        const monthIndex = anchorMonth + initialJump + i * rule.interval;
        const candidate = new Date(
          Math.floor(monthIndex / 12),
          monthIndex % 12,
          1,
          anchor.getHours(),
          anchor.getMinutes(),
          anchor.getSeconds(),
          anchor.getMilliseconds()
        );
        const day = Math.min(rule.day, daysInMonth(candidate.getFullYear(), candidate.getMonth()));
        candidate.setDate(day);
        if (candidate.getTime() >= from) {
          return candidate.getTime();
        }
      }
      return null;
    }
    case 'after-completion':
      return addCalendarDays(reference, rule.days);
    default:
      return null;
  }
};

const calendarDayNumber = (date: Date): number =>
  Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

const addCalendarDays = (timestamp: number, days: number): number => {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

const daysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

/**
 * Which task list a renderer is showing. Pure filter predicates over a task's
 * timestamps; kept shared so main and renderer never drift on "what belongs in
 * Today". All ranges are [startOfDay, endOfDay) in local time.
 */
export type TaskView = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'archived';

export const TASK_VIEWS: TaskView[] = ['inbox', 'today', 'upcoming', 'overdue', 'completed', 'archived'];

const startOfDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const endOfDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
};

const isActiveStatus = (status: TaskStatus): boolean => status === 'inbox' || status === 'active';

/** Predicates a task matches a view. `now` injectable for deterministic tests. */
export const matchesTaskView = (task: Task, view: TaskView, now: number = Date.now()): boolean => {
  switch (view) {
    case 'inbox':
      return task.status === 'inbox';
    case 'today': {
      if (!isActiveStatus(task.status)) {
        return false;
      }
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);
      const planned = task.plannedAt !== null && task.plannedAt <= todayEnd;
      const due = task.dueAt !== null && task.dueAt <= todayEnd;
      const started = task.status === 'active';
      return planned || due || started;
    }
    case 'upcoming': {
      if (!isActiveStatus(task.status)) {
        return false;
      }
      const horizon = endOfDay(now + 7 * 86_400_000);
      const futureStart = endOfDay(now) + 1;
      const planned =
        task.plannedAt !== null && task.plannedAt >= futureStart && task.plannedAt <= horizon;
      const due = task.dueAt !== null && task.dueAt >= futureStart && task.dueAt <= horizon;
      return planned || due;
    }
    case 'overdue': {
      if (!isActiveStatus(task.status)) {
        return false;
      }
      const todayStart = startOfDay(now);
      const overduePlanned = task.plannedAt !== null && task.plannedAt < todayStart;
      const overdueDue = task.dueAt !== null && task.dueAt < todayStart;
      return overduePlanned || overdueDue;
    }
    case 'completed':
      return task.status === 'done';
    case 'archived':
      return task.status === 'archived';
    default:
      return false;
  }
};

/** Sort tasks for display within a view: overdue first, then by urgency
 * (dueAt/plannedAt asc, then priority, then sortOrder/createdAt). */
export const sortTasksForView = (tasks: Task[], now: number = Date.now()): Task[] => {
  const rank = (task: Task): number => {
    const overdue =
      isActiveTask(task) &&
      ((task.dueAt !== null && task.dueAt < startOfDay(now)) ||
        (task.plannedAt !== null && task.plannedAt < startOfDay(now)));
    if (overdue) {
      return 0;
    }
    const priorityRank = task.priority === 'urgent' ? 0 : task.priority === 'important' ? 1 : 2;
    return 1 + priorityRank;
  };
  return [...tasks].sort((a, b) => {
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    const aTime = a.dueAt ?? a.plannedAt ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.dueAt ?? b.plannedAt ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.sortOrder - b.sortOrder || a.createdAt - b.createdAt;
  });
};

const isActiveTask = (task: Task): boolean => isActiveStatus(task.status);
