/**
 * Daily Planning domain helpers (USERPLAN 1.2 §十/§十一, PR3).
 *
 * Pure functions shared by main and renderer so capacity math, overdue
 * triage and workload honesty can never drift between surfaces. All day
 * operations go through the civil-time calendar module — never raw ms math.
 */
import type { DailyTaskPlan, Task } from './types';
import { localDateAtMinutes, minutesOfLocalDay } from './calendar';

/** Today's 3 — the maximum number of daily commitments (Akiflow split, §五). */
export const MAX_DAILY_GOALS = 3;

/** Default wall-clock time for a triaged task that has no planned time yet. */
export const TRIAGE_DEFAULT_MINUTES = 9 * 60;

export interface DailyCapacitySummary {
  /** Sum of REAL estimates only — unestimated work never fakes minutes. */
  plannedMinutes: number;
  unestimatedCount: number;
  capacityMinutes: number;
  overCommitted: boolean;
  /** Rough eye-break windows inside the capacity (planning aid, §十 step 3). */
  estimatedBreakWindows: number;
}

/**
 * The effective minutes one plan contributes to the day's workload:
 * explicit `plannedMinutes` first, then the task's estimate, else nothing —
 * an unestimated commitment is COUNTED, never invented as 30 minutes.
 */
export const planWorkloadMinutes = (
  plan: DailyTaskPlan,
  task: Task | undefined
): number | null => {
  if (plan.plannedMinutes !== null) return plan.plannedMinutes;
  if (task && task.estimateMinutes !== null) return task.estimateMinutes;
  return null;
};

export const summarizeDailyCapacity = (
  plans: DailyTaskPlan[],
  taskById: Map<string, Task>,
  capacityMinutes: number,
  eyeIntervalMinutes: number
): DailyCapacitySummary => {
  let plannedMinutes = 0;
  let unestimatedCount = 0;
  for (const plan of plans) {
    const minutes = planWorkloadMinutes(plan, taskById.get(plan.taskId));
    if (minutes === null) {
      unestimatedCount += 1;
    } else {
      plannedMinutes += minutes;
    }
  }
  return {
    plannedMinutes,
    unestimatedCount,
    capacityMinutes,
    overCommitted: plannedMinutes > capacityMinutes,
    estimatedBreakWindows:
      eyeIntervalMinutes > 0 ? Math.max(0, Math.floor(capacityMinutes / eyeIntervalMinutes)) : 0
  };
};

/**
 * Overdue triage (§十 step 1): move a task's planned time onto another local
 * day while PRESERVING its wall-clock time, or send it back to the backlog
 * (`targetDayStart === null`) by clearing the plan time.
 */
export const rescheduleTaskToDay = (task: Task, targetDayStart: number | null): number | null => {
  if (targetDayStart === null) {
    return null;
  }
  if (task.plannedAt !== null) {
    return localDateAtMinutes(targetDayStart, minutesOfLocalDay(task.plannedAt));
  }
  return localDateAtMinutes(targetDayStart, TRIAGE_DEFAULT_MINUTES);
};
