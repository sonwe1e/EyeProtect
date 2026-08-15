import { sanitizeReminderEvent } from './reminderHistory';
import { sanitizeSettings } from './settings';
import {
  sanitizeProject,
  sanitizeStandaloneReminder,
  sanitizeTask,
  sanitizeDailyTaskPlans,
  sanitizeTimeBlocks,
  sanitizeProjectSections,
  sanitizeFocusSessions,
  type CharacterCollectionState,
  type DailyTaskPlan,
  type FocusSession,
  type Project,
  type ProjectSection,
  type ReminderEvent,
  type Settings,
  type StandaloneReminder,
  type Task,
  type TimeBlock
} from '../shared/types';
import type { TaskReminderOccurrence } from './taskStore';

const BACKUP_SCHEMA_VERSION = 5;
type PreferenceSettings = Omit<Settings, 'todos' | 'alarms' | 'activeTaskId'>;

export interface BackupDomainData {
  tasks: Task[];
  projects: Project[];
  standaloneReminders: StandaloneReminder[];
  activeTaskId: string | null;
  taskReminderOccurrences: TaskReminderOccurrence[];
  characterCollection: CharacterCollectionState | null;
  /** Schema v4 planning domain (USERPLAN 1.2 PR1). Empty for v1–v4 backups. */
  dailyTaskPlans: DailyTaskPlan[];
  timeBlocks: TimeBlock[];
  projectSections: ProjectSection[];
  focusSessions: FocusSession[];
}

export interface EyeProtectBackup extends BackupDomainData {
  version: 5;
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
  taskReminderOccurrences: [],
  characterCollection: null,
  dailyTaskPlans: [],
  timeBlocks: [],
  projectSections: [],
  focusSessions: []
});

type BackupDomainInput = Partial<BackupDomainData> & {
  taskReminderOccurrences?: TaskReminderOccurrence[];
  characterCollection?: CharacterCollectionState | null;
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
  tasks: domain.tasks ?? [],
  projects: domain.projects ?? [],
  standaloneReminders: domain.standaloneReminders ?? [],
  activeTaskId: domain.activeTaskId ?? null,
  taskReminderOccurrences: domain.taskReminderOccurrences ?? [],
  characterCollection: domain.characterCollection ?? null,
  dailyTaskPlans: domain.dailyTaskPlans ?? [],
  timeBlocks: domain.timeBlocks ?? [],
  projectSections: domain.projectSections ?? [],
  focusSessions: domain.focusSessions ?? []
} satisfies EyeProtectBackup, null, 2)}\n`;

export const parseBackup = (text: string): EyeProtectBackup => {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (
    (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4 && parsed.version !== BACKUP_SCHEMA_VERSION) ||
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
        status: todo.completed ? 'done' as const : 'open' as const,
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
        sectionId: null,
        revision: 1,
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
  const characterCollection = parsed.characterCollection && typeof parsed.characterCollection === 'object'
    ? parsed.characterCollection as CharacterCollectionState
    : null;

  // Schema v4 planning domain. Older backups simply carry empty arrays.
  // Referential integrity is enforced here: a plan/block/session pointing at a
  // task (or a section at a project) that did not survive sanitizing is dropped.
  const projectIds = new Set(projects.map((project) => project.id));
  const dailyTaskPlans = sanitizeDailyTaskPlans(parsed.dailyTaskPlans)
    .filter((plan) => taskIds.has(plan.taskId));
  const timeBlocks = sanitizeTimeBlocks(parsed.timeBlocks)
    .filter((block) => taskIds.has(block.taskId));
  const timeBlockIds = new Set(timeBlocks.map((block) => block.id));
  const projectSections = sanitizeProjectSections(parsed.projectSections)
    .filter((section) => projectIds.has(section.projectId));
  const sectionIds = new Set(projectSections.map((section) => section.id));
  // A task may only keep a section reference that survived the import; the
  // store's FK would reject anything else, so normalize here instead.
  for (const task of tasks) {
    if (task.sectionId && !sectionIds.has(task.sectionId)) {
      task.sectionId = null;
    }
    // Sections outside the task's own project are invalid by definition.
    const section = task.sectionId ? projectSections.find((entry) => entry.id === task.sectionId) : null;
    if (section && section.projectId !== task.projectId) {
      task.sectionId = null;
    }
  }
  const focusSessions = sanitizeFocusSessions(parsed.focusSessions)
    .map((session) => ({
      ...session,
      timeBlockId: session.timeBlockId && timeBlockIds.has(session.timeBlockId) ? session.timeBlockId : null
    }))
    .filter((session) => taskIds.has(session.taskId));

  // Tasks and projects each form their own parent forest. A backup must be a
  // DAG: reject multi-node cycles (A->B->A) that the per-row self-check misses.
  if (hasParentCycle(tasks)) {
    throw new Error('备份文件包含循环的任务关系');
  }
  if (hasParentCycle(projects)) {
    throw new Error('备份文件包含循环的项目关系');
  }

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
    characterCollection,
    dailyTaskPlans,
    timeBlocks,
    projectSections,
    focusSessions,
    activeTaskId: typeof (parsed.activeTaskId ?? legacyActiveTaskId) === 'string' &&
      tasks.some((task) => task.id === (parsed.activeTaskId ?? legacyActiveTaskId))
      ? (parsed.activeTaskId ?? legacyActiveTaskId) as string
      : null
  };
};

/**
 * Detect a cycle in a parent-linked forest (O(V+E)). For each entry that has a
 * parentId, walk up the ancestors; if we ever return to the start node, the
 * graph is not a DAG. A per-start-node visited set bounds traversal and keeps
 * the check linear even when several nodes share ancestors.
 */
const hasParentCycle = <T extends { id: string; parentId: string | null }>(entries: T[]): boolean => {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const start of entries) {
    if (!start.parentId) continue;
    const visited = new Set<string>();
    let cursor: string | null = start.parentId;
    while (cursor && byId.has(cursor)) {
      if (cursor === start.id) {
        return true;
      }
      if (visited.has(cursor)) {
        break;
      }
      visited.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  return false;
};

const nextLegacyAlarmFireAt = (hour: number, minute: number, now: number = Date.now()): number => {
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= now) {
    date.setDate(date.getDate() + 1);
  }
  return date.getTime();
};
