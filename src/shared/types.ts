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

export type CharacterStyle = 'soft' | 'doodle' | 'pixel' | 'toy';
export type CharacterMaterial = 'paper' | 'glow' | 'plush' | 'candy' | 'cosmic';
export type CharacterPersonality = 'curious' | 'mischievous' | 'dreamy' | 'brave' | 'gentle';
export type CharacterAppearanceMode = 'daily-random' | 'pinned';

export interface CharacterAppendage {
  angle: number;
  length: number;
  width: number;
  tipSize: number;
  bend: number;
}

export interface CharacterRecipe {
  bodyWidth: number;
  bodyHeight: number;
  bodyRoundness: number;
  bodyTilt: number;
  attentionCount: number;
  attentionSpread: number;
  appendages: CharacterAppendage[];
  orbitCount: number;
  pattern: 'none' | 'spots' | 'stripes' | 'sparkles';
  palette: [string, string, string];
}

export interface CharacterRig {
  center: { x: number; y: number };
  attention: { x: number; y: number };
  locomotionY: number;
  actionPoints: Array<{ x: number; y: number }>;
}

export interface CollectibleCharacter {
  id: string;
  seed: string;
  generatorVersion: number;
  name: string;
  style: CharacterStyle;
  personality: CharacterPersonality;
  favoriteActions: [string, string];
  recipe: CharacterRecipe;
  rig: CharacterRig;
  material: CharacterMaterial;
  accessory: PetAccessory;
  favorite: boolean;
  createdAt: number;
}

export interface DailyCharacterCandidate {
  localDate: string;
  character: CollectibleCharacter;
  decision: 'pending' | 'collected' | 'discarded';
}

export interface CharacterCollectionState {
  installSalt: string;
  characters: CollectibleCharacter[];
  candidate: DailyCharacterCandidate | null;
  appearanceMode: CharacterAppearanceMode;
  pinnedCharacterId: string | null;
  activeCharacterId: string;
}

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
export type TaskStatus = 'open' | 'done' | 'archived';

export const TASK_STATUSES: TaskStatus[] = ['open', 'done', 'archived'];

export type ThemePreference = 'system' | 'light' | 'dark';
export type DensityPreference = 'comfortable' | 'compact';

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
  /** Whether an away/any task may be suggested inside a walk reminder. */
  remindOnBreak: boolean;
  estimateMinutes: number | null;
  /** Project workflow section (Board column). Independent of focus state (ADR-002). */
  sectionId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export type ProjectStatus = 'active' | 'onHold' | 'completed' | 'archived';

export const PROJECT_STATUSES: ProjectStatus[] = ['active', 'onHold', 'completed', 'archived'];

export interface Project {
  id: string;
  name: string;
  goal: string | null;
  viewMode: 'list' | 'board';
  color: string | null;
  parentId: string | null;
  /** Project lifecycle (USERPLAN 1.2 PR1). Deletion stays a rare destructive act. */
  status: ProjectStatus;
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
  remindOnBreak?: boolean;
  estimateMinutes?: number | null;
  /** Board/workflow section within the task's project (schema v4). */
  sectionId?: string | null;
}

/** Partial update; `status` is separate because it drives recurrence + stats. */
export type TaskUpdateInput = Partial<TaskInput> & {
  status?: TaskStatus;
  /** Used by the Workbench's explicit move controls. */
  sortOrder?: number;
};

export interface TaskMoveInput {
  taskId: string;
  beforeTaskId: string | null;
  scope: { type: 'inbox' } | { type: 'project'; projectId: string };
}

export interface TaskWorkSummary {
  taskId: string | null;
  taskActiveMs: number;
  currentSessionMs: number;
  continuousActiveMs: number;
  timeboxNotified: boolean;
}

export interface UndoState {
  operationId: string;
  kind: 'complete' | 'delete';
  taskTitle: string;
  expiresAt: number;
}

export interface ProjectInput {
  name: string;
  goal?: string | null;
  viewMode?: 'list' | 'board';
  color?: string | null;
  parentId?: string | null;
  status?: ProjectStatus;
}

export type ProjectUpdateInput = Partial<ProjectInput>;

// ── Schema v4 planning domain (USERPLAN 1.2 §九, PR1) ────────────────────────

/**
 * One task's commitment on one local calendar day. `plannedMinutes` is how
 * much the user intends to invest THAT day — not the task's total estimate.
 * `dailyRank` (max 3 per day) separates "today's real commitments" from the
 * task's long-lived priority (Akiflow/Sunsama split, §五/§十).
 */
export interface DailyTaskPlan {
  taskId: string;
  /** Local calendar day, `YYYY-MM-DD` (civil date — never derived via +86_400_000). */
  localDate: string;
  plannedMinutes: number | null;
  dailyRank: 1 | 2 | 3 | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface DailyTaskPlanInput {
  taskId: string;
  localDate: string;
  plannedMinutes?: number | null;
  dailyRank?: 1 | 2 | 3 | null;
  sortOrder?: number;
}

export type TimeBlockSource = 'manual' | 'planner';

/**
 * A scheduled interval of work on a task. One task may own N blocks (a 240m
 * task can live on Monday 10:00–12:00 and Tuesday 14:00–16:00). Replaces the
 * overloaded `plannedAt ≈ calendar block` interpretation (ADR-001).
 */
export interface TimeBlock {
  id: string;
  taskId: string;
  startAt: number;
  endAt: number;
  /** IANA zone captured at scheduling time (display/audit aid). */
  timeZone: string;
  source: TimeBlockSource;
  createdAt: number;
  updatedAt: number;
}

export interface TimeBlockInput {
  taskId: string;
  startAt: number;
  endAt: number;
  timeZone?: string;
  source?: TimeBlockSource;
}

/**
 * A named stage/column inside a project (Todoist sections). Board columns
 * ARE sections — never derived from the global active/focus task (ADR-002).
 */
export interface ProjectSection {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSectionInput {
  projectId: string;
  name: string;
}

export type FocusSessionOutcome = 'completed' | 'paused' | 'interrupted';

/**
 * One logical focus run on a task: start → (work, break, work…) → end.
 * The existing work_sessions rows stay as the precise low-level segments
 * underneath (ADR-005). At most ONE session may be live globally.
 */
export interface FocusSession {
  id: string;
  taskId: string;
  /** Set when the session was started from a TimeBlock. */
  timeBlockId: string | null;
  startedAt: number;
  endedAt: number | null;
  activeMs: number;
  outcome: FocusSessionOutcome | null;
  createdAt: number;
}

export interface FocusSessionStartInput {
  taskId: string;
  timeBlockId?: string | null;
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
  /** Idle/lock duration that qualifies as a completed natural break. */
  naturalBreakMinutes: number;
  /** How reminders enforce themselves; see ReminderMode. */
  reminderMode: ReminderMode;
  /** Soft bubble this many seconds before each deadline; 0 turns it off. */
  preAlertSeconds: number;
  startWithWindows: boolean;
  petScale: number;
  petPosition: PetPosition | null;
  /** One absolute pet position per connected-display topology. */
  petPositionsByLayout: Record<string, PetPosition>;
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
  theme: ThemePreference;
  density: DensityPreference;
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
  taskDatabase: {
    readOnly: boolean;
    snapshotPath: string | null;
    reason: string | null;
  };
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

// ── Command Layer contract (USERPLAN §十五, §二十七) ────────────────────────
// Every user mutation flows through the command layer so the UI can never
// silently swallow a failure. A command is never fire-and-forget: it reports
// its state and either returns data or a structured, recoverable error.

export type CommandState = 'idle' | 'pending' | 'success' | 'error';

/**
 * The result of a command. `ok: true` carries the domain data; `ok: false`
 * carries a stable error code, a human message, and whether the user can retry.
 * `T` matches the success payload of the underlying IPC call (e.g. Task[]).
 */
export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; recoverable: boolean };

/** Stable error codes the UI can switch on to show targeted recovery actions. */
export type ErrorCode =
  | 'database/read-only'
  | 'database/unavailable'
  | 'validation'
  | 'not-found'
  | 'conflict'
  | 'unknown';

/**
 * Translate a raw thrown value (an IPC rejection) into a structured result.
 * Kept pure and shared so main-side mapping and renderer-side catch-blocks
 * never drift. Matches known main-process messages to stable codes; anything
 * unknown is surfaced as `unknown` (recoverable) rather than swallowed.
 */
export const toCommandResult = (err: unknown): Extract<CommandResult<never>, { ok: false }> => {
  const message = err instanceof Error ? err.message : String(err);
  if (/恢复模式|read.only|readOnly|未被修改/i.test(message)) {
    return { ok: false, code: 'database/read-only', message, recoverable: true };
  }
  if (/无法打开|cannot open|数据库/i.test(message)) {
    return { ok: false, code: 'database/unavailable', message, recoverable: true };
  }
  // Validation problems (bad input) are recoverable and distinct from a
  // missing entity — keep them in their own bucket so the UI can tell the
  // user the input was rejected rather than that nothing was found.
  if (/invalid|非法|参数|输入/i.test(message)) {
    return { ok: false, code: 'validation', message, recoverable: true };
  }
  if (/不存在|not found|未找到/i.test(message)) {
    return { ok: false, code: 'not-found', message, recoverable: false };
  }
  if (/冲突|already|duplicate/i.test(message)) {
    return { ok: false, code: 'conflict', message, recoverable: false };
  }
  return { ok: false, code: 'unknown', message, recoverable: true };
};

// ── AppHealth (USERPLAN §二十八) ────────────────────────────────────────────
// First-class global state so the UI can explain *why* an action is unavailable
// instead of pretending everything is fine while mutations silently fail.

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable';
export type NotificationAvailability = 'available' | 'unavailable';

export interface AppHealth {
  database: HealthStatus;
  scheduler: HealthStatus;
  notification: NotificationAvailability;
}

export interface FailedDeliveryNotice {
  id: string;
  source: 'task' | 'standalone' | 'timebox';
  sourceId: string;
  occurrenceAt: number;
  title: string;
  body: string;
  failedAt: number | null;
}

export interface EyeProtectApi {
  getSettings: () => Promise<Settings>;
  saveSettings: (settings: Partial<Settings>) => Promise<Settings>;
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  // --- AppHealth (USERPLAN §二十八) ---
  /** Current health of database, scheduler, and notification subsystems. */
  getAppHealth: () => Promise<AppHealth>;
  onAppHealthChanged: (callback: (health: AppHealth) => void) => () => void;
  /**
   * Relaunch the whole app (renderer + main process). A renderer-only reload
   * cannot leave database-recovery mode because the main-process TaskStore is
   * constructed once at startup, so exiting recovery requires a full restart.
   */
  relaunchApp: () => Promise<void>;
  getReminderStatus: () => Promise<ReminderStatus>;
  reminderAction: (action: ReminderAction, reminderId: string) => Promise<ReminderStatus>;
  /** Act on the soft pre-alert: start now, push back 2 min, or keep the plan. */
  preAlertAction: (action: PreAlertAction) => Promise<ReminderStatus>;
  testReminder: (kind: ReminderKind) => Promise<ReminderStatus>;
  triggerNow: () => Promise<ReminderStatus>;
  pause: (minutes: number) => Promise<ReminderStatus>;
  onSettingsChanged: (callback: (settings: Settings) => void) => () => void;
  onReminderChanged: (callback: (status: ReminderStatus) => void) => () => void;
  // --- v1.1 Task Core (USERPLAN §二) ---
  /** All tasks (any view/filter is applied in the renderer). */
  getTasks: () => Promise<Task[]>;
  getTask: (id: string) => Promise<Task | null>;
  createTask: (input: TaskInput) => Promise<Task[]>;
  updateTask: (id: string, input: TaskUpdateInput) => Promise<Task[]>;
  moveTask: (input: TaskMoveInput) => Promise<Task[]>;
  setTaskStatus: (id: string, status: TaskStatus) => Promise<Task[]>;
  deleteTask: (id: string) => Promise<Task[]>;
  getUndoState: () => Promise<UndoState | null>;
  undoTaskOperation: (operationId: string) => Promise<Task[]>;
  onUndoChanged: (callback: (state: UndoState | null) => void) => () => void;
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
  getTaskWorkSummary: () => Promise<TaskWorkSummary>;
  onTaskWorkChanged: (callback: (summary: TaskWorkSummary) => void) => () => void;
  getStandaloneReminders: () => Promise<StandaloneReminder[]>;
  createStandaloneReminder: (input: StandaloneReminderInput) => Promise<StandaloneReminder[]>;
  updateStandaloneReminder: (id: string, input: Partial<StandaloneReminderInput>) => Promise<StandaloneReminder[]>;
  deleteStandaloneReminder: (id: string) => Promise<StandaloneReminder[]>;
  onStandaloneRemindersChanged: (callback: (reminders: StandaloneReminder[]) => void) => () => void;
  onStandaloneReminderFired: (callback: (reminder: StandaloneReminder) => void) => () => void;
  getFailedDeliveries: () => Promise<FailedDeliveryNotice[]>;
  retryFailedDelivery: (id: string) => Promise<FailedDeliveryNotice[]>;
  dismissFailedDelivery: (id: string) => Promise<FailedDeliveryNotice[]>;
  onFailedDeliveriesChanged: (callback: (notices: FailedDeliveryNotice[]) => void) => () => void;
  getCharacterCollection: () => Promise<CharacterCollectionState>;
  collectDailyCharacter: () => Promise<CharacterCollectionState>;
  discardDailyCharacter: () => Promise<CharacterCollectionState>;
  renameCharacter: (id: string, name: string) => Promise<CharacterCollectionState>;
  deleteCharacter: (id: string) => Promise<CharacterCollectionState>;
  setCharacterFavorite: (id: string, favorite: boolean) => Promise<CharacterCollectionState>;
  setCharacterAppearance: (mode: CharacterAppearanceMode, id?: string | null) => Promise<CharacterCollectionState>;
  setCharacterMaterial: (id: string, material: CharacterMaterial) => Promise<CharacterCollectionState>;
  setCharacterAccessory: (id: string, accessory: PetAccessory) => Promise<CharacterCollectionState>;
  onCharacterCollectionChanged: (callback: (state: CharacterCollectionState) => void) => () => void;
  openWorkbench: (section?: 'today' | 'settings' | 'reminders' | 'collection') => Promise<void>;
  closeWorkbench: () => Promise<void>;
  getWorkbenchSection: () => Promise<'today' | 'settings' | 'reminders' | 'collection'>;
  onWorkbenchNavigate: (callback: (section: 'today' | 'settings' | 'reminders' | 'collection') => void) => () => void;
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
  naturalBreakMinutes: 5,
  reminderMode: 'guided',
  preAlertSeconds: 30,
  startWithWindows: false,
  petScale: 1,
  petPosition: null,
  petPositionsByLayout: {},
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
  theme: 'system',
  density: 'comfortable',
  alarms: [],
  todos: [],
  activeTaskId: null
};

export const SETTINGS_LIMITS = {
  eyeIntervalMinutes: { min: 1, max: 240 },
  walkIntervalMinutes: { min: 1, max: 240 },
  snoozeMinutes: { min: 1, max: 60 },
  naturalBreakMinutes: { min: 1, max: 30 },
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
export const PROJECT_GOAL_MAX = 240;

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

const asTaskStatus = (value: unknown): TaskStatus => {
  if (value === 'inbox' || value === 'active') {
    return 'open';
  }
  return TASK_STATUSES.includes(value as TaskStatus) ? (value as TaskStatus) : 'open';
};

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
  const sectionId = typeof candidate.sectionId === 'string' && candidate.sectionId ? candidate.sectionId : null;
  const recurrence = sanitizeRecurrenceRule(candidate.recurrence);
  const context = asTaskContext(candidate.context);
  const remindOnBreak = candidate.remindOnBreak === true && context !== 'desk';
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
    remindOnBreak,
    estimateMinutes,
    sectionId,
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
  const goal = typeof candidate.goal === 'string'
    ? candidate.goal.trim().slice(0, PROJECT_GOAL_MAX) || null
    : null;
  const viewMode = candidate.viewMode === 'board' ? 'board' : 'list';
  const status: ProjectStatus = PROJECT_STATUSES.includes(candidate.status as ProjectStatus)
    ? (candidate.status as ProjectStatus)
    : 'active';
  return {
    id: candidate.id,
    name,
    goal,
    viewMode,
    color: asProjectColor(candidate.color),
    parentId,
    status,
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

// ── Schema v4 sanitizers (USERPLAN 1.2 PR1) ──────────────────────────────────

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Strict civil-date key check: backups and IPC must never smuggle raw timestamps in here. */
export const isLocalDateKey = (value: unknown): value is string =>
  typeof value === 'string' && LOCAL_DATE_PATTERN.test(value);

const normalizePositiveInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

export const sanitizeDailyTaskPlan = (value: unknown, now: number = Date.now()): DailyTaskPlan | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DailyTaskPlan> & Record<string, unknown>;
  if (typeof candidate.taskId !== 'string' || !candidate.taskId) return null;
  if (!isLocalDateKey(candidate.localDate)) return null;
  const rank =
    candidate.dailyRank === 1 || candidate.dailyRank === 2 || candidate.dailyRank === 3
      ? candidate.dailyRank
      : null;
  const createdAt = normalizeTaskTimestamp(candidate.createdAt, now) ?? now;
  const updatedAt = normalizeTaskTimestamp(candidate.updatedAt, createdAt) ?? createdAt;
  return {
    taskId: candidate.taskId,
    localDate: candidate.localDate,
    plannedMinutes: normalizePositiveInt(candidate.plannedMinutes),
    dailyRank: rank,
    sortOrder:
      typeof candidate.sortOrder === 'number' && Number.isFinite(candidate.sortOrder)
        ? Math.round(candidate.sortOrder)
        : 0,
    createdAt,
    updatedAt
  };
};

export const sanitizeDailyTaskPlans = (value: unknown, now: number = Date.now()): DailyTaskPlan[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeDailyTaskPlan(entry, now))
    .filter((entry): entry is DailyTaskPlan => Boolean(entry));
};

export const sanitizeTimeBlock = (value: unknown, now: number = Date.now()): TimeBlock | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<TimeBlock> & Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id) return null;
  if (typeof candidate.taskId !== 'string' || !candidate.taskId) return null;
  const startAt = normalizeTaskTimestamp(candidate.startAt, null);
  const endAt = normalizeTaskTimestamp(candidate.endAt, null);
  // Invariant: end_at > start_at (USERPLAN §二十). Reject, don't clamp.
  if (startAt === null || endAt === null || endAt <= startAt) return null;
  const createdAt = normalizeTaskTimestamp(candidate.createdAt, now) ?? now;
  const updatedAt = normalizeTaskTimestamp(candidate.updatedAt, createdAt) ?? createdAt;
  return {
    id: candidate.id,
    taskId: candidate.taskId,
    startAt,
    endAt,
    timeZone:
      typeof candidate.timeZone === 'string' && candidate.timeZone.trim()
        ? candidate.timeZone.trim().slice(0, 64)
        : 'local',
    source: candidate.source === 'planner' ? 'planner' : 'manual',
    createdAt,
    updatedAt
  };
};

export const sanitizeTimeBlocks = (value: unknown, now: number = Date.now()): TimeBlock[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeTimeBlock(entry, now))
    .filter((entry): entry is TimeBlock => Boolean(entry));
};

export const SECTION_NAME_MAX = 60;

export const sanitizeProjectSection = (value: unknown, now: number = Date.now()): ProjectSection | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<ProjectSection> & Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id) return null;
  if (typeof candidate.projectId !== 'string' || !candidate.projectId) return null;
  if (typeof candidate.name !== 'string') return null;
  const name = candidate.name.trim().slice(0, SECTION_NAME_MAX);
  if (!name) return null;
  const createdAt = normalizeTaskTimestamp(candidate.createdAt, now) ?? now;
  const updatedAt = normalizeTaskTimestamp(candidate.updatedAt, createdAt) ?? createdAt;
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    name,
    sortOrder:
      typeof candidate.sortOrder === 'number' && Number.isFinite(candidate.sortOrder)
        ? Math.round(candidate.sortOrder)
        : 0,
    createdAt,
    updatedAt
  };
};

export const sanitizeProjectSections = (value: unknown, now: number = Date.now()): ProjectSection[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeProjectSection(entry, now))
    .filter((entry): entry is ProjectSection => Boolean(entry));
};

export const sanitizeFocusSession = (value: unknown, now: number = Date.now()): FocusSession | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<FocusSession> & Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id) return null;
  if (typeof candidate.taskId !== 'string' || !candidate.taskId) return null;
  const startedAt = normalizeTaskTimestamp(candidate.startedAt, null);
  if (startedAt === null) return null;
  const endedAt = normalizeTaskTimestamp(candidate.endedAt, null);
  // Invariants: ended_at >= started_at, active_ms >= 0.
  if (endedAt !== null && endedAt < startedAt) return null;
  const activeMs =
    typeof candidate.activeMs === 'number' && Number.isFinite(candidate.activeMs) && candidate.activeMs >= 0
      ? Math.round(candidate.activeMs)
      : null;
  if (activeMs === null) return null;
  const outcome: FocusSessionOutcome | null =
    candidate.outcome === 'completed' || candidate.outcome === 'paused' || candidate.outcome === 'interrupted'
      ? candidate.outcome
      : null;
  // A finished session must carry an outcome; a live one must not.
  if (endedAt !== null && outcome === null) return null;
  if (endedAt === null && outcome !== null) return null;
  const createdAt = normalizeTaskTimestamp(candidate.createdAt, now) ?? now;
  return {
    id: candidate.id,
    taskId: candidate.taskId,
    timeBlockId: typeof candidate.timeBlockId === 'string' && candidate.timeBlockId ? candidate.timeBlockId : null,
    startedAt,
    endedAt,
    activeMs,
    outcome,
    createdAt
  };
};

export const sanitizeFocusSessions = (value: unknown, now: number = Date.now()): FocusSession[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeFocusSession(entry, now))
    .filter((entry): entry is FocusSession => Boolean(entry));
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
export type TaskView = 'inbox' | 'today' | 'upcoming' | 'overdue' | 'away' | 'completed' | 'archived';

export const TASK_VIEWS: TaskView[] = ['inbox', 'today', 'upcoming', 'overdue', 'away', 'completed', 'archived'];

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

const isActiveStatus = (status: TaskStatus): boolean => status === 'open';

export const matchesProjectView = (task: Task, projectId: string): boolean =>
  task.projectId === projectId && isActiveStatus(task.status);

/** Predicates a task matches a view. `now` injectable for deterministic tests. */
export const matchesTaskView = (
  task: Task,
  view: TaskView,
  now: number = Date.now(),
  activeTaskId: string | null = null
): boolean => {
  switch (view) {
    case 'inbox':
      return task.status === 'open' && task.projectId === null;
    case 'today': {
      if (!isActiveStatus(task.status)) {
        return false;
      }
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);
      const planned = task.plannedAt !== null && task.plannedAt <= todayEnd;
      const due = task.dueAt !== null && task.dueAt <= todayEnd;
      return planned || due || task.id === activeTaskId;
    }
    case 'upcoming': {
      if (!isActiveStatus(task.status)) {
        return false;
      }
      // Calendar-day horizon: +7 calendar days, not +7*24h (DST-safe, §二十一).
      const horizon = endOfDay(addCalendarDays(now, 7));
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
    case 'away':
      return isActiveStatus(task.status) && task.context === 'away';
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
