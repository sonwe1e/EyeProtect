import { contextBridge, ipcRenderer } from 'electron';
import type {
  Alarm,
  AlarmRepeat,
  EyeProtectApi,
  PanelTab,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  RuntimeInfo,
  Settings,
  TodoItem,
  TodoPriority
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
  testReminder: (kind: ReminderKind) => ipcRenderer.invoke('reminder:test', kind) as Promise<ReminderStatus>,
  pause: (minutes: number) => ipcRenderer.invoke('reminder:pause', minutes) as Promise<ReminderStatus>,
  openSettings: () => ipcRenderer.invoke('window:settings:open') as Promise<void>,
  closeSettings: () => ipcRenderer.invoke('window:settings:close') as Promise<void>,
  openPanel: (tab: PanelTab) => ipcRenderer.invoke('window:panel:open', tab) as Promise<void>,
  closePanel: () => ipcRenderer.invoke('window:panel:close') as Promise<void>,
  getPanelTab: () => ipcRenderer.invoke('window:panel:tab') as Promise<PanelTab>,
  onPanelTab: (callback) => on<PanelTab>('panel:tab', callback),
  onPanelBlur: (callback) => on<void>('panel:blur', callback),
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
  onTodosChanged: (callback) => on<TodoItem[]>('todo:changed', callback)
};

contextBridge.exposeInMainWorld('eyeProtect', api);
