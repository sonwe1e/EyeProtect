import { sanitizeReminderEvent } from './reminderHistory';
import { sanitizeSettings } from './settings';
import {
  sanitizeProject,
  sanitizeStandaloneReminder,
  sanitizeTask,
  type Project,
  type ReminderEvent,
  type Settings,
  type StandaloneReminder,
  type Task
} from '../shared/types';
import type { TaskReminderOccurrence } from './taskStore';

const BACKUP_SCHEMA_VERSION = 3;
type PreferenceSettings = Omit<Settings, 'todos' | 'alarms' | 'activeTaskId'>;

export interface BackupDomainData {
  tasks: Task[];
  projects: Project[];
  standaloneReminders: StandaloneReminder[];
  activeTaskId: string | null;
  taskReminderOccurrences: TaskReminderOccurrence[];
}

export interface EyeProtectBackup extends BackupDomainData {
  version: 3;
  createdAt: number;
  appVersion: string;
  settings: PreferenceSettings;
  reminderHistory: ReminderEvent[];
}

const emptyDomain = (): BackupDomainData => ({
  tasks: [],
  projects: [],
  standaloneReminders: [],
  activeTaskId: null,
  taskReminderOccurrences: []
});

type BackupDomainInput = Omit<BackupDomainData, 'taskReminderOccurrences'> & {
  taskReminderOccurrences?: TaskReminderOccurrence[];
};

const preferenceSettings = (settings: Settings): PreferenceSettings => {
  const { todos: _todos, alarms: _alarms, activeTaskId: _activeTaskId, ...preferences } = settings;
  return preferences;
};

export const createBackup = (
  settings: Settings,
  reminderHistory: readonly ReminderEvent[],
  appVersion: string,
  now: number = Date.now(),
  domain: BackupDomainInput = emptyDomain()
): string => `${JSON.stringify({
  version: BACKUP_SCHEMA_VERSION,
  createdAt: now,
  appVersion,
  settings: preferenceSettings(settings),
  reminderHistory: [...reminderHistory],
  ...domain,
  taskReminderOccurrences: domain.taskReminderOccurrences ?? []
} satisfies EyeProtectBackup, null, 2)}\n`;

export const parseBackup = (text: string): EyeProtectBackup => {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (
    (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== BACKUP_SCHEMA_VERSION) ||
    !Number.isFinite(parsed.createdAt) ||
    typeof parsed.appVersion !== 'string' ||
    !parsed.settings || typeof parsed.settings !== 'object' ||
    !Array.isArray(parsed.reminderHistory)
  ) {
    throw new Error('不是受支持的 EyeProtect 备份文件');
  }
  const reminderHistory = parsed.reminderHistory.map((event) => sanitizeReminderEvent(event));
  if (reminderHistory.some((event) => event === null)) {
    throw new Error('备份中的提醒历史存在无效记录');
  }
  const sanitizedSettings = sanitizeSettings(parsed.settings);
  const importedTasks = Array.isArray(parsed.tasks)
    ? parsed.tasks.map((entry) => sanitizeTask(entry)).filter((entry): entry is Task => Boolean(entry))
    : [];
  const projects = Array.isArray(parsed.projects)
    ? parsed.projects.map((entry) => sanitizeProject(entry)).filter((entry): entry is Project => Boolean(entry))
    : [];
  const importedReminders = Array.isArray(parsed.standaloneReminders)
    ? parsed.standaloneReminders.map((entry) => sanitizeStandaloneReminder(entry)).filter((entry): entry is StandaloneReminder => Boolean(entry))
    : [];
  const tasks = importedTasks.length > 0
    ? importedTasks
    : sanitizedSettings.todos.map((todo, sortOrder) => ({
        id: todo.id,
        title: todo.text,
        notes: null,
        status: todo.completed ? 'done' as const : 'inbox' as const,
        priority: todo.priority,
        projectId: null,
        parentId: null,
        tags: [],
        plannedAt: null,
        dueAt: null,
        reminderAt: null,
        recurrence: null,
        context: todo.remindOnBreak || todo.context === 'away' ? 'away' as const : 'desk' as const,
        remindOnBreak: todo.remindOnBreak === true,
        estimateMinutes: null,
        sortOrder,
        createdAt: todo.createdAt,
        updatedAt: todo.createdAt,
        completedAt: todo.completed ? todo.completedAt ?? todo.createdAt : null
      }));
  const standaloneReminders = importedReminders.length > 0
    ? importedReminders
    : sanitizedSettings.alarms.map((alarm) => ({
        id: alarm.id,
        label: alarm.label ?? '',
        schedule: alarm.repeat === 'daily'
          ? { type: 'daily' as const, hour: alarm.hour, minute: alarm.minute }
          : { type: 'once' as const, fireAt: nextLegacyAlarmFireAt(alarm.hour, alarm.minute) },
        enabled: alarm.enabled,
        createdAt: alarm.createdAt,
        updatedAt: alarm.createdAt
      }));
  const legacyActiveTaskId = sanitizedSettings.activeTaskId;
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskReminderOccurrences = Array.isArray(parsed.taskReminderOccurrences)
    ? parsed.taskReminderOccurrences.flatMap((value) => {
        if (!value || typeof value !== 'object') {
          return [];
        }
        const candidate = value as Partial<TaskReminderOccurrence>;
        if (
          typeof candidate.taskId !== 'string' ||
          !taskIds.has(candidate.taskId) ||
          typeof candidate.fireAt !== 'number' ||
          !Number.isFinite(candidate.fireAt) ||
          (candidate.consumedAt !== null &&
            (typeof candidate.consumedAt !== 'number' || !Number.isFinite(candidate.consumedAt)))
        ) {
          return [];
        }
        return [{
          taskId: candidate.taskId,
          fireAt: candidate.fireAt,
          consumedAt: candidate.consumedAt ?? null
        }];
      })
    : [];
  return {
    version: BACKUP_SCHEMA_VERSION,
    createdAt: parsed.createdAt as number,
    appVersion: parsed.appVersion,
    settings: preferenceSettings(sanitizedSettings),
    reminderHistory: reminderHistory as ReminderEvent[],
    tasks,
    projects,
    standaloneReminders,
    taskReminderOccurrences,
    activeTaskId: typeof (parsed.activeTaskId ?? legacyActiveTaskId) === 'string' &&
      tasks.some((task) => task.id === (parsed.activeTaskId ?? legacyActiveTaskId))
      ? (parsed.activeTaskId ?? legacyActiveTaskId) as string
      : null
  };
};

const nextLegacyAlarmFireAt = (hour: number, minute: number, now: number = Date.now()): number => {
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= now) {
    date.setDate(date.getDate() + 1);
  }
  return date.getTime();
};
