import { contextBridge, ipcRenderer } from 'electron';
import type {
  CareStatus,
  DataActionResult,
  DataRecoveryInfo,
  EyeProtectApi,
  HotkeyStatus,
  PanelTab,
  PreAlertAction,
  Project,
  ProjectInput,
  ProjectUpdateInput,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  RuntimeInfo,
  Settings,
  StandaloneReminder,
  StandaloneReminderInput,
  Task,
  TaskInput,
  TaskStatus,
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
  openSettings: () => ipcRenderer.invoke('window:settings:open') as Promise<void>,
  closeSettings: () => ipcRenderer.invoke('window:settings:close') as Promise<void>,
  openPanel: (tab: PanelTab) => ipcRenderer.invoke('window:panel:open', tab) as Promise<void>,
  openQuickTodo: () => ipcRenderer.invoke('window:panel:quick-add') as Promise<void>,
  closePanel: () => ipcRenderer.invoke('window:panel:close') as Promise<void>,
  getPanelTab: () => ipcRenderer.invoke('window:panel:tab') as Promise<PanelTab>,
  consumeQuickAddTodo: () =>
    ipcRenderer.invoke('window:panel:consume-quick-add') as Promise<boolean>,
  onPanelTab: (callback) => on<PanelTab>('panel:tab', callback),
  onPanelBlur: (callback) => on<void>('panel:blur', callback),
  onQuickAddTodo: (callback) => on<void>('panel:quick-add', callback),
  onSettingsChanged: (callback) => on<Settings>('settings:changed', callback),
  onReminderChanged: (callback) => on<ReminderStatus>('reminder:changed', callback),
  getTasks: () => ipcRenderer.invoke('task:list') as Promise<Task[]>,
  getTask: (id: string) => ipcRenderer.invoke('task:get', id) as Promise<Task | null>,
  createTask: (input: TaskInput) => ipcRenderer.invoke('task:create', input) as Promise<Task[]>,
  updateTask: (id: string, input: TaskUpdateInput) =>
    ipcRenderer.invoke('task:update', id, input) as Promise<Task[]>,
  setTaskStatus: (id: string, status: TaskStatus) =>
    ipcRenderer.invoke('task:set-status', id, status) as Promise<Task[]>,
  deleteTask: (id: string) => ipcRenderer.invoke('task:delete', id) as Promise<Task[]>,
  onTasksChanged: (callback) => on<Task[]>('task:changed', callback),
  getProjects: () => ipcRenderer.invoke('project:list') as Promise<Project[]>,
  getProject: (id: string) => ipcRenderer.invoke('project:get', id) as Promise<Project | null>,
  createProject: (input: ProjectInput) => ipcRenderer.invoke('project:create', input) as Promise<Project[]>,
  updateProject: (id: string, input: ProjectUpdateInput) =>
    ipcRenderer.invoke('project:update', id, input) as Promise<Project[]>,
  deleteProject: (id: string) => ipcRenderer.invoke('project:delete', id) as Promise<Project[]>,
  onProjectsChanged: (callback) => on<Project[]>('project:changed', callback),
  getActiveTaskId: () => ipcRenderer.invoke('task:active:get') as Promise<string | null>,
  setActiveTask: (id: string | null) => ipcRenderer.invoke('task:active:set', id) as Promise<Task[]>,
  onActiveTaskChanged: (callback) => on<string | null>('task:active-changed', callback),
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
  openWorkbench: (section = 'today') =>
    ipcRenderer.invoke('window:workbench:open', section) as Promise<void>,
  closeWorkbench: () => ipcRenderer.invoke('window:workbench:close') as Promise<void>,
  getWorkbenchSection: () =>
    ipcRenderer.invoke('window:workbench:section') as Promise<'today' | 'settings' | 'reminders'>,
  onWorkbenchNavigate: (callback) =>
    on<'today' | 'settings' | 'reminders'>('workbench:navigate', callback),
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
