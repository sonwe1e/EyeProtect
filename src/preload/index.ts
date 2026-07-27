import { contextBridge, ipcRenderer } from 'electron';
import type {
  Alarm,
  AlarmRepeat,
  CareStatus,
  DataActionResult,
  DataRecoveryInfo,
  EyeProtectApi,
  HotkeyStatus,
  PanelTab,
  PreAlertAction,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  RuntimeInfo,
  Settings,
  TodoItem,
  TodoPriority,
  WeeklyReport
} from '../shared/types';

interface AlarmInput {
  hour: number;
  minute: number;
  label?: string;
  repeat: AlarmRepeat;
  enabled: boolean;
}

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
  getAlarms: () => ipcRenderer.invoke('alarm:list') as Promise<Alarm[]>,
  setAlarm: (input: AlarmInput) => ipcRenderer.invoke('alarm:set', input) as Promise<Alarm[]>,
  cancelAlarm: (id: string) => ipcRenderer.invoke('alarm:cancel', id) as Promise<Alarm[]>,
  onAlarmFired: (callback) => on<Alarm>('alarm:fired', callback),
  onAlarmsChanged: (callback) => on<Alarm[]>('alarm:changed', callback),
  getTodos: () => ipcRenderer.invoke('todo:list') as Promise<TodoItem[]>,
  addTodo: (text: string) => ipcRenderer.invoke('todo:add', text) as Promise<TodoItem[]>,
  toggleTodo: (id: string) => ipcRenderer.invoke('todo:toggle', id) as Promise<TodoItem[]>,
  updateTodo: (id: string, text: string) =>
    ipcRenderer.invoke('todo:update', id, text) as Promise<TodoItem[]>,
  removeTodo: (id: string) => ipcRenderer.invoke('todo:remove', id) as Promise<TodoItem[]>,
  setTodoPriority: (id: string, priority: TodoPriority) =>
    ipcRenderer.invoke('todo:priority', id, priority) as Promise<TodoItem[]>,
  setTodoBreakReminder: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('todo:break-reminder', id, enabled) as Promise<TodoItem[]>,
  clearCompletedTodos: () => ipcRenderer.invoke('todo:clear-completed') as Promise<TodoItem[]>,
  onTodosChanged: (callback) => on<TodoItem[]>('todo:changed', callback),
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
