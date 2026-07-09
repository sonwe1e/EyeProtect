export type ReminderKind = 'eye' | 'walk' | 'combined';
export type SingleReminderKind = Exclude<ReminderKind, 'combined'>;
export type ReminderAction = 'complete' | 'snooze' | 'skip';
export type PetSkin = 'stable' | 'eye' | 'fu' | 'sleep';

export const PET_SKINS: PetSkin[] = ['stable', 'eye', 'fu', 'sleep'];

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
  riveAvailable: boolean;
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
  onSettingsChanged: (callback: (settings: Settings) => void) => () => void;
  onReminderChanged: (callback: (status: ReminderStatus) => void) => () => void;
  getAlarms: () => Promise<Alarm[]>;
  setAlarm: (input: Omit<Alarm, 'id' | 'createdAt'>) => Promise<Alarm[]>;
  cancelAlarm: (id: string) => Promise<Alarm[]>;
  onAlarmFired: (callback: (alarm: Alarm) => void) => () => void;
  onAlarmsChanged: (callback: (alarms: Alarm[]) => void) => () => void;
  getTodos: () => Promise<TodoItem[]>;
  addTodo: (text: string) => Promise<TodoItem[]>;
  removeTodo: (id: string) => Promise<TodoItem[]>;
  onTodosChanged: (callback: (todos: TodoItem[]) => void) => () => void;
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
  const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now();
  return { id: candidate.id, text: candidate.text, createdAt };
};

export const sanitizeTodos = (value: unknown): TodoItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => sanitizeTodo(entry)).filter((entry): entry is TodoItem => Boolean(entry));
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
  const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now();
  return {
    id: candidate.id,
    hour: candidate.hour,
    minute: candidate.minute,
    label: candidate.label,
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
