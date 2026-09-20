import { contextBridge, ipcRenderer } from 'electron';
import type {
  CareStatus,
  DailyReviewSummary,
  DailyReflection,
  DailyReflectionInput,
  DailyTaskPlan,
  DailyTaskPlanInput,
  DataActionResult,
  DataRecoveryInfo,
  AppHealth,
  EyeProtectApi,
  FailedDeliveryNotice,
  FocusStatus,
  HotkeyStatus,
  PetPosition,
  PreAlertAction,
  Project,
  ProjectInput,
  ProjectSection,
  ProjectSectionInput,
  ProjectWorkstreamSummary,
  ProjectUpdateInput,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  RuntimeInfo,
  Settings,
  StandaloneReminder,
  StandaloneReminderInput,
  Task,
  TaskCheckpoint,
  TaskCheckpointDraft,
  TaskCheckpointInput,
  TaskInput,
  TaskMoveInput,
  TaskStatus,
  TaskWorkSummary,
  TimeBlock,
  TimeBlockInput,
  UndoState,
  TaskUpdateInput,
  WeeklyReport
} from '../shared/types';

const on = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api: EyeProtectApi = {
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings) as Promise<Settings>,
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:get') as Promise<RuntimeInfo>,
  // --- AppHealth (USERPLAN §二十八) ---
  getAppHealth: () => ipcRenderer.invoke('app:health:get') as Promise<AppHealth>,
  onAppHealthChanged: (callback) => on<AppHealth>('app:health:changed', callback),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch') as Promise<void>,
  getReminderStatus: () => ipcRenderer.invoke('reminder:status') as Promise<ReminderStatus>,
  reminderAction: (action: ReminderAction, reminderId: string) =>
    ipcRenderer.invoke('reminder:action', action, reminderId) as Promise<ReminderStatus>,
  preAlertAction: (action: PreAlertAction) =>
    ipcRenderer.invoke('reminder:pre-alert', action) as Promise<ReminderStatus>,
  testReminder: (kind: ReminderKind) => ipcRenderer.invoke('reminder:test', kind) as Promise<ReminderStatus>,
  triggerNow: () => ipcRenderer.invoke('reminder:now') as Promise<ReminderStatus>,
  pause: (minutes: number) => ipcRenderer.invoke('reminder:pause', minutes) as Promise<ReminderStatus>,
  resume: () => ipcRenderer.invoke('reminder:resume') as Promise<ReminderStatus>,
  restartCycle: () => ipcRenderer.invoke('reminder:restart') as Promise<ReminderStatus>,
  onSettingsChanged: (callback) => on<Settings>('settings:changed', callback),
  onReminderChanged: (callback) => on<ReminderStatus>('reminder:changed', callback),
  completeTaskTree: (id, revisions) => ipcRenderer.invoke('task:complete-tree', id, revisions) as Promise<Task[]>,
  moveStep: (id, direction) => ipcRenderer.invoke('task:move-step', id, direction),
  createStep: (rootId, title) => ipcRenderer.invoke('task:create-step', rootId, title) as Promise<Task[]>,
  preparePomodoro: (taskId, replace) => ipcRenderer.invoke('pomodoro:prepare', taskId, replace),
  getPomodoro: () => ipcRenderer.invoke('pomodoro:get'),
  startPomodoro: (taskId, minutes, replace) => ipcRenderer.invoke('pomodoro:start', taskId, minutes, replace),
  pomodoroAction: (action) => ipcRenderer.invoke('pomodoro:action', action),
  onPomodoroChanged: (callback) => on('pomodoro:changed', callback),
  beginHealthRest: (id) => ipcRenderer.invoke('reminder:begin-rest', id),
  getLegacyData: () => ipcRenderer.invoke('data:legacy'),
  restoreLegacyTask: (id) => ipcRenderer.invoke('task:restore-legacy', id),
  getTasks: () => ipcRenderer.invoke('task:list') as Promise<Task[]>,
  getTask: (id: string) => ipcRenderer.invoke('task:get', id) as Promise<Task | null>,
  createTask: (input: TaskInput) => ipcRenderer.invoke('task:create', input) as Promise<Task[]>,
  updateTask: (id: string, input: TaskUpdateInput) =>
    ipcRenderer.invoke('task:update', id, input) as Promise<Task[]>,
  moveTask: (input: TaskMoveInput) => ipcRenderer.invoke('task:move', input) as Promise<Task[]>,
  setTaskStatus: (id: string, status: TaskStatus) =>
    ipcRenderer.invoke('task:set-status', id, status) as Promise<Task[]>,
  deleteTask: (id: string) => ipcRenderer.invoke('task:delete', id) as Promise<Task[]>,
  getUndoState: () => ipcRenderer.invoke('task:undo:get') as Promise<UndoState | null>,
  undoTaskOperation: (operationId: string) => ipcRenderer.invoke('task:undo', operationId) as Promise<Task[]>,
  onUndoChanged: (callback) => on<UndoState | null>('task:undo-changed', callback),
  onTasksChanged: (callback) => on<Task[]>('task:changed', callback),
  onTaskUpserted: (callback) => on<Task>('task:upserted', callback),
  onTaskRemoved: (callback) => on<string>('task:removed', callback),
  getPendingTaskCount: () => ipcRenderer.invoke('task:pending-count') as Promise<number>,
  onPendingTaskCountChanged: (callback) => on<number>('task:pending-count:changed', callback),
  getProjects: () => ipcRenderer.invoke('project:list') as Promise<Project[]>,
  getProject: (id: string) => ipcRenderer.invoke('project:get', id) as Promise<Project | null>,
  createProject: (input: ProjectInput) => ipcRenderer.invoke('project:create', input) as Promise<Project[]>,
  updateProject: (id: string, input: ProjectUpdateInput) =>
    ipcRenderer.invoke('project:update', id, input) as Promise<Project[]>,
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id) as Promise<Project[]>,
  onProjectsChanged: (callback) => on<Project[]>('project:changed', callback),
  onProjectUpserted: (callback) => on<Project>('project:upserted', callback),
  onProjectRemoved: (callback) => on<string>('project:removed', callback),
  getDailyPlans: (localDate: string) =>
    ipcRenderer.invoke('plan:day:list', localDate) as Promise<DailyTaskPlan[]>,
  getDailyReview: (localDate: string) =>
    ipcRenderer.invoke('daily:review', localDate) as Promise<DailyReviewSummary>,
  upsertDailyPlan: (input: DailyTaskPlanInput) =>
    ipcRenderer.invoke('plan:upsert', input) as Promise<DailyTaskPlan[]>,
  removeDailyPlan: (taskId: string, localDate: string) =>
    ipcRenderer.invoke('plan:remove', taskId, localDate) as Promise<DailyTaskPlan[]>,
  getTimeBlocks: () => ipcRenderer.invoke('timeblock:list') as Promise<TimeBlock[]>,
  createTimeBlock: (input: TimeBlockInput) =>
    ipcRenderer.invoke('timeblock:create', input) as Promise<TimeBlock>,
  updateTimeBlock: (id: string, input: Partial<TimeBlockInput>) =>
    ipcRenderer.invoke('timeblock:update', id, input) as Promise<TimeBlock>,
  deleteTimeBlock: (id: string) => ipcRenderer.invoke('timeblock:delete', id) as Promise<boolean>,
  onTimeBlocksChanged: (callback) => on<null>('timeblock:changed', callback),
  onDailyPlansChanged: (callback) => on<{ localDate: string | null }>('plan:changed', callback),
  getProjectSections: (projectId: string) =>
    ipcRenderer.invoke('section:list', projectId) as Promise<ProjectSection[]>,
  createProjectSection: (input: ProjectSectionInput) =>
    ipcRenderer.invoke('section:create', input) as Promise<ProjectSection>,
  updateProjectSection: (id: string, input: { name: string }) =>
    ipcRenderer.invoke('section:update', id, input) as Promise<ProjectSection>,
  moveProjectSection: (id: string, beforeSectionId: string | null) =>
    ipcRenderer.invoke('section:move', id, beforeSectionId) as Promise<ProjectSection[]>,
  deleteProjectSection: (id: string) =>
    ipcRenderer.invoke('section:delete', id) as Promise<boolean>,
  onProjectSectionsChanged: (callback) => on<{ projectId: string | null }>('section:changed', callback),
  setTaskSection: (taskId: string, sectionId: string | null) =>
    ipcRenderer.invoke('task:set-section', taskId, sectionId) as Promise<Task>,
  getProjectWorkstreamSummaries: (projectId: string, since: number) =>
    ipcRenderer.invoke('section:work-summary', projectId, since) as Promise<ProjectWorkstreamSummary[]>,
  getFocusStatus: () => ipcRenderer.invoke('focus:get') as Promise<FocusStatus>,
  startFocus: (taskId: string, timeBlockId?: string | null) =>
    ipcRenderer.invoke('focus:start', taskId, timeBlockId ?? null) as Promise<FocusStatus>,
  switchFocus: (taskId: string, checkpoint?: TaskCheckpointDraft | null) =>
    ipcRenderer.invoke('focus:switch', taskId, checkpoint ?? null) as Promise<FocusStatus>,
  pauseFocus: (checkpoint?: TaskCheckpointDraft | null) =>
    ipcRenderer.invoke('focus:pause', checkpoint ?? null) as Promise<FocusStatus>,
  resumeFocus: () => ipcRenderer.invoke('focus:resume') as Promise<FocusStatus>,
  completeFocus: () => ipcRenderer.invoke('focus:complete') as Promise<FocusStatus>,
  onFocusStatusChanged: (callback) => on<FocusStatus>('focus:session-changed', callback),
  getTaskCheckpoints: (taskId: string) =>
    ipcRenderer.invoke('checkpoint:list', taskId) as Promise<TaskCheckpoint[]>,
  createTaskCheckpoint: (input: TaskCheckpointInput) =>
    ipcRenderer.invoke('checkpoint:create', input) as Promise<TaskCheckpoint>,
  onTaskCheckpointsChanged: (callback) => on<{ taskId: string | null }>('checkpoint:changed', callback),
  getDailyReflection: (localDate: string) =>
    ipcRenderer.invoke('daily:reflection:get', localDate) as Promise<DailyReflection | null>,
  saveDailyReflection: (input: DailyReflectionInput) =>
    ipcRenderer.invoke('daily:reflection:save', input) as Promise<DailyReflection>,
  getActiveTaskId: () => ipcRenderer.invoke('task:active:get') as Promise<string | null>,
  setActiveTask: (id: string | null) => ipcRenderer.invoke('task:active:set', id) as Promise<Task[]>,
  onActiveTaskChanged: (callback) => on<string | null>('task:active-changed', callback),
  getTaskWorkSummary: () => ipcRenderer.invoke('task:work-summary') as Promise<TaskWorkSummary>,
  onTaskWorkChanged: (callback) => on<TaskWorkSummary>('task:work-changed', callback),
  getStandaloneReminders: () =>
    ipcRenderer.invoke('standalone-reminder:list') as Promise<StandaloneReminder[]>,
  createStandaloneReminder: (input: StandaloneReminderInput) =>
    ipcRenderer.invoke('standalone-reminder:create', input) as Promise<StandaloneReminder[]>,
  updateStandaloneReminder: (id: string, input: Partial<StandaloneReminderInput>) =>
    ipcRenderer.invoke('standalone-reminder:update', id, input) as Promise<StandaloneReminder[]>,
  deleteStandaloneReminder: (id: string) =>
    ipcRenderer.invoke('standalone-reminder:delete', id) as Promise<StandaloneReminder[]>,
  onStandaloneRemindersChanged: (callback) =>
    on<StandaloneReminder[]>('standalone-reminder:changed', callback),
  onStandaloneReminderFired: (callback) =>
    on<StandaloneReminder>('standalone-reminder:fired', callback),
  getFailedDeliveries: () =>
    ipcRenderer.invoke('delivery:failed:list') as Promise<FailedDeliveryNotice[]>,
  retryFailedDelivery: (id: string) =>
    ipcRenderer.invoke('delivery:failed:retry', id) as Promise<FailedDeliveryNotice[]>,
  dismissFailedDelivery: (id: string) =>
    ipcRenderer.invoke('delivery:failed:dismiss', id) as Promise<FailedDeliveryNotice[]>,
  onFailedDeliveriesChanged: (callback) =>
    on<FailedDeliveryNotice[]>('delivery:failed-changed', callback),
  reportPetArtworkBounds: (bounds) => ipcRenderer.invoke('window:pet:artwork-bounds', bounds) as Promise<void>,
  reportBubbleHeight: (height) => ipcRenderer.invoke('window:bubble:height', height) as Promise<void>,
  onBubbleLayout: (callback) => on('bubble:layout', callback),
  movePetWindow: (position) =>
    ipcRenderer.invoke('window:pet:move', position) as Promise<PetPosition | null>,
  showPetContextMenu: () => ipcRenderer.invoke('window:pet:context-menu') as Promise<void>,
  togglePetVisibility: () => ipcRenderer.invoke('window:pet:toggle-visibility') as Promise<boolean>,
  recallPet: () => ipcRenderer.invoke('window:pet:recall') as Promise<void>,
  openWorkbench: (section = 'today') =>
    ipcRenderer.invoke('window:workbench:open', section) as Promise<void>,
  closeWorkbench: () => ipcRenderer.invoke('window:workbench:close') as Promise<void>,
  getWorkbenchSection: () =>
    ipcRenderer.invoke('window:workbench:section') as Promise<'today' | 'settings' | 'reminders' | 'review' | 'pet-tasks'>,
  onWorkbenchNavigate: (callback) =>
    on<'today' | 'settings' | 'reminders' | 'review' | 'pet-tasks'>('workbench:navigate', callback),
  getWeeklyReport: () => ipcRenderer.invoke('history:report') as Promise<WeeklyReport>,
  getCareStatus: () => ipcRenderer.invoke('history:care') as Promise<CareStatus>,
  clearReminderHistory: () => ipcRenderer.invoke('history:clear') as Promise<WeeklyReport>,
  exportReminderHistory: (format) =>
    ipcRenderer.invoke('history:export', format) as Promise<boolean>,
  onWeeklyReportChanged: (callback) => on<WeeklyReport>('history:changed', callback),
  onCareStatusChanged: (callback) => on<CareStatus>('care:changed', callback),
  getHotkeyStatus: () => ipcRenderer.invoke('hotkeys:status') as Promise<HotkeyStatus>,
  onHotkeyStatusChanged: (callback) => on<HotkeyStatus>('hotkeys:changed', callback),
  exportBackup: () => ipcRenderer.invoke('data:backup:export') as Promise<DataActionResult>,
  importBackup: () => ipcRenderer.invoke('data:backup:import') as Promise<DataActionResult>,
  resetToDefaults: () => ipcRenderer.invoke('data:reset') as Promise<DataActionResult>,
  openDataDirectory: () => ipcRenderer.invoke('data:open-directory') as Promise<DataActionResult>,
  getDataRecoveryInfo: () =>
    ipcRenderer.invoke('data:recovery-info') as Promise<DataRecoveryInfo>
};

contextBridge.exposeInMainWorld('eyeProtect', api);
