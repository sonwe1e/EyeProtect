import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppHealth,
  CustomPetAssets,
  DataActionResult,
  DataRecoveryInfo,
  EyeProtectApi,
  FailedDeliveryNotice,
  HotkeyStatus,
  LegacyData,
  PetPosition,
  PomodoroState,
  PreAlertAction,
  Project,
  ProjectInput,
  ProjectUpdateInput,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  RuntimeInfo,
  Settings,
  Task,
  TaskInput,
  TaskMoveInput,
  TaskStatus,
  TaskUpdateInput,
  UndoState
} from '../shared/types';

const on = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

/**
 * Keep in lockstep with `EyeProtectApi` and the `handleIpc(...)` list in
 * `src/main/index.ts`. Do not re-add planning/focus/section write bridges
 * until main registers matching handlers again (docs/architecture.md).
 */
const api: EyeProtectApi = {
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings) as Promise<Settings>,
  onSettingsChanged: (callback) => on<Settings>('settings:changed', callback),
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:get') as Promise<RuntimeInfo>,
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
  onReminderChanged: (callback) => on<ReminderStatus>('reminder:changed', callback),
  beginHealthRest: (id) => ipcRenderer.invoke('reminder:begin-rest', id) as Promise<ReminderStatus>,

  preparePomodoro: (taskId, replace) =>
    ipcRenderer.invoke('pomodoro:prepare', taskId, replace) as Promise<PomodoroState>,
  getPomodoro: () => ipcRenderer.invoke('pomodoro:get') as Promise<PomodoroState>,
  startPomodoro: (taskId, minutes, replace) =>
    ipcRenderer.invoke('pomodoro:start', taskId, minutes, replace) as Promise<PomodoroState>,
  pomodoroAction: (action) => ipcRenderer.invoke('pomodoro:action', action) as Promise<PomodoroState>,
  onPomodoroChanged: (callback) => on<PomodoroState>('pomodoro:changed', callback),

  getTasks: () => ipcRenderer.invoke('task:list') as Promise<Task[]>,
  getTask: (id: string) => ipcRenderer.invoke('task:get', id) as Promise<Task | null>,
  createTask: (input: TaskInput) => ipcRenderer.invoke('task:create', input) as Promise<Task[]>,
  updateTask: (id: string, input: TaskUpdateInput) =>
    ipcRenderer.invoke('task:update', id, input) as Promise<Task[]>,
  moveTask: (input: TaskMoveInput) => ipcRenderer.invoke('task:move', input) as Promise<Task[]>,
  setTaskStatus: (id: string, status: TaskStatus) =>
    ipcRenderer.invoke('task:set-status', id, status) as Promise<Task[]>,
  deleteTask: (id: string) => ipcRenderer.invoke('task:delete', id) as Promise<Task[]>,
  completeTaskTree: (id, revisions) =>
    ipcRenderer.invoke('task:complete-tree', id, revisions) as Promise<Task[]>,
  moveStep: (id, direction) => ipcRenderer.invoke('task:move-step', id, direction) as Promise<Task[]>,
  createStep: (rootId, title) => ipcRenderer.invoke('task:create-step', rootId, title) as Promise<Task[]>,
  getUndoState: () => ipcRenderer.invoke('task:undo:get') as Promise<UndoState | null>,
  undoTaskOperation: (operationId) => ipcRenderer.invoke('task:undo', operationId) as Promise<Task[]>,
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

  getActiveTaskId: () => ipcRenderer.invoke('task:active:get') as Promise<string | null>,
  setActiveTask: (id: string | null) => ipcRenderer.invoke('task:active:set', id) as Promise<Task[]>,
  onActiveTaskChanged: (callback) => on<string | null>('task:active-changed', callback),

  getFailedDeliveries: () => ipcRenderer.invoke('delivery:failed:list') as Promise<FailedDeliveryNotice[]>,
  retryFailedDelivery: (id) =>
    ipcRenderer.invoke('delivery:failed:retry', id) as Promise<FailedDeliveryNotice[]>,
  dismissFailedDelivery: (id) =>
    ipcRenderer.invoke('delivery:failed:dismiss', id) as Promise<FailedDeliveryNotice[]>,
  onFailedDeliveriesChanged: (callback) =>
    on<FailedDeliveryNotice[]>('delivery:failed-changed', callback),

  reportPetArtworkBounds: (bounds) =>
    ipcRenderer.invoke('window:pet:artwork-bounds', bounds) as Promise<void>,
  reportBubbleHeight: (height) => ipcRenderer.invoke('window:bubble:height', height) as Promise<void>,
  onBubbleLayout: (callback) =>
    on<{ placement: 'above' | 'below'; tailX: number }>('bubble:layout', callback),
  movePetWindow: (position) =>
    ipcRenderer.invoke('window:pet:move', position) as Promise<PetPosition | null>,
  showPetContextMenu: () => ipcRenderer.invoke('window:pet:context-menu') as Promise<void>,
  togglePetVisibility: () => ipcRenderer.invoke('window:pet:toggle-visibility') as Promise<boolean>,
  recallPet: () => ipcRenderer.invoke('window:pet:recall') as Promise<void>,
  openWorkbench: (section = 'today') =>
    ipcRenderer.invoke('window:workbench:open', section) as Promise<void>,
  closeWorkbench: () => ipcRenderer.invoke('window:workbench:close') as Promise<void>,
  getWorkbenchSection: () =>
    ipcRenderer.invoke('window:workbench:section') as Promise<'today' | 'review' | 'settings'>,
  onWorkbenchNavigate: (callback) =>
    on<'today' | 'review' | 'settings'>('workbench:navigate', callback),

  openCustomPetFolder: (subfolder?: string) =>
    ipcRenderer.invoke('pet:custom:open-folder', subfolder) as Promise<{ success: boolean; message: string }>,
  getCustomPetAssets: (themeId?: string | null) =>
    ipcRenderer.invoke('pet:custom:get-assets', themeId) as Promise<CustomPetAssets>,

  exportBackup: () => ipcRenderer.invoke('data:backup:export') as Promise<DataActionResult>,
  importBackup: () => ipcRenderer.invoke('data:backup:import') as Promise<DataActionResult>,
  resetToDefaults: () => ipcRenderer.invoke('data:reset') as Promise<DataActionResult>,
  openDataDirectory: () => ipcRenderer.invoke('data:open-directory') as Promise<DataActionResult>,
  getDataRecoveryInfo: () => ipcRenderer.invoke('data:recovery-info') as Promise<DataRecoveryInfo>,
  getLegacyData: () => ipcRenderer.invoke('data:legacy') as Promise<LegacyData>,
  restoreLegacyTask: (id) => ipcRenderer.invoke('task:restore-legacy', id) as Promise<Task[]>,

  getHotkeyStatus: () => ipcRenderer.invoke('hotkeys:status') as Promise<HotkeyStatus>,
  onHotkeyStatusChanged: (callback) => on<HotkeyStatus>('hotkeys:changed', callback)
};

contextBridge.exposeInMainWorld('eyeProtect', api);
