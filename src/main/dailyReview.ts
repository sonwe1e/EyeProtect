import { addLocalDays } from '../shared/calendar';
import type {
  DailyReviewSummary,
  DailyReviewTaskSummary,
  DailyTaskPlan,
  FocusSession,
  ReminderPeriodStats
} from '../shared/types';
import { summarizeEvents } from './reminderHistory';
import type { ReminderHistoryStore } from './reminderHistory';
import type { TaskStore } from './taskStore';

const parseLocalDateKey = (localDate: string): number => {
  const [yearText, monthText, dayText] = localDate.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error('无效的日期');
  }
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error('无效的日期');
  }
  return date.getTime();
};

const getDateRange = (localDate: string): [number, number] => {
  const start = parseLocalDateKey(localDate);
  return [start, addLocalDays(start, 1)];
};

const getDailyTaskWork = (store: TaskStore, taskId: string, from: number): number =>
  store.getTaskWorkMsSince(taskId, from);

const getTotalTaskWork = (store: TaskStore, taskId: string): number => store.getTaskWorkMs(taskId);

const sum = (values: number[]): number => values.reduce((result, value) => result + value, 0);

const summarizeReviewSessions = (
  sessions: FocusSession[],
  from: number,
  to: number
): {
  focusSessionCount: number;
  focusCompletedSessions: number;
  focusPausedSessions: number;
  focusInterruptedSessions: number;
  focusWorkMs: number;
} => {
  const todaySessions = sessions.filter((session) => session.startedAt >= from && session.startedAt < to);
  return {
    focusSessionCount: todaySessions.length,
    focusCompletedSessions: todaySessions.filter((session) => session.outcome === 'completed').length,
    focusPausedSessions: todaySessions.filter((session) => session.outcome === 'paused').length,
    focusInterruptedSessions: todaySessions.filter((session) => session.outcome === 'interrupted').length,
    focusWorkMs: sum(todaySessions.map((session) => session.activeMs))
  };
};

const planSort = (left: DailyTaskPlan, right: DailyTaskPlan): number => {
  const leftRank = left.dailyRank ?? 99;
  const rightRank = right.dailyRank ?? 99;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  return left.createdAt - right.createdAt;
};

/**
 * Aggregate one day’s review snapshot (capture → plan → focus/work → review).
 * All time boundaries are local-day aware; event aggregation and focus/work
 * metrics share the same boundary for “today”.
 */
export const buildDailyReview = (
  store: TaskStore,
  historyStore: ReminderHistoryStore,
  localDate: string
): DailyReviewSummary => {
  const [from, to] = getDateRange(localDate);
  const allTasks = store.getTasks();
  const taskById = new Map(allTasks.map((task) => [task.id, task]));
  const plans = store.getDailyPlans(localDate);

  const todayPlans = plans.filter((plan) => plan.localDate === localDate);
  const todaysThree = todayPlans.filter((plan) => plan.dailyRank !== null);
  const tasks: DailyReviewTaskSummary[] = todayPlans
    .slice()
    .sort(planSort)
    .map((plan) => {
      const task = taskById.get(plan.taskId);
      if (!task) {
        return null;
      }
      return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        plannedMinutes: plan.plannedMinutes ?? null,
        todayWorkMs: getDailyTaskWork(store, task.id, from),
        totalWorkMs: getTotalTaskWork(store, task.id)
      };
    })
    .filter((entry): entry is DailyReviewTaskSummary => entry !== null)

  const focusedSessions = store.getFocusSessions();
  const focusSummary = summarizeReviewSessions(focusedSessions, from, to);
  const reminderStats: ReminderPeriodStats = summarizeEvents(historyStore.getEvents(), from, to);
  const actualTaskMs = allTasks.map((task) => getDailyTaskWork(store, task.id, from));

  return {
    localDate,
    plannedMinutes: sum(todayPlans.map((plan) => plan.plannedMinutes ?? 0)),
    actualWorkMs: sum(actualTaskMs),
    completedPlannedTaskCount: tasks.filter((entry) => taskById.get(entry.taskId)?.status === 'done').length,
    plannedTaskCount: tasks.length,
    completedTodaysThreeCount: todaysThree.filter(
      (plan) => taskById.get(plan.taskId)?.status === 'done'
    ).length,
    todaysThreeCount: todaysThree.length,
    reminderStats,
    focusSessionCount: focusSummary.focusSessionCount,
    focusCompletedSessions: focusSummary.focusCompletedSessions,
    focusPausedSessions: focusSummary.focusPausedSessions,
    focusInterruptedSessions: focusSummary.focusInterruptedSessions,
    focusWorkMs: focusSummary.focusWorkMs,
    tasks
  };
};

export const parseDailyReviewDateKey = parseLocalDateKey;
