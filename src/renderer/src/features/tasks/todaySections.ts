import type { DailyTaskPlan, Task } from '../../../../shared/types';

export interface TodaySections {
  todaysThree: Task[];
  scheduled: Task[];
  flexible: Task[];
}

/**
 * Express the Today information architecture from persisted planning facts.
 * TimeBlock ownership is the only source for Scheduled; legacy `plannedAt`
 * must not silently promote a task into that section. Flexible contains only
 * Daily Plan commitments without a TimeBlock and excludes Today's 3.
 */
export function deriveTodaySections(
  tasks: Task[],
  todayPlans: DailyTaskPlan[],
  scheduledTaskIds: ReadonlySet<string>
): TodaySections {
  const activeTasks = tasks.filter((task) => task.status === 'open');
  const taskById = new Map(activeTasks.map((task) => [task.id, task]));
  const todaysThree = todayPlans
    .filter((plan) => plan.dailyRank !== null)
    .sort((left, right) => (left.dailyRank ?? 0) - (right.dailyRank ?? 0))
    .map((plan) => taskById.get(plan.taskId))
    .filter((task): task is Task => Boolean(task));
  const ranked = new Set(todaysThree.map((task) => task.id));
  // Sections are deliberately mutually exclusive. A ranked task with a block
  // stays in Today's focus list and exposes its time through row metadata.
  const scheduled = activeTasks.filter((task) => scheduledTaskIds.has(task.id) && !ranked.has(task.id));
  const seen = new Set<string>();
  const flexible = todayPlans
    .map((plan) => taskById.get(plan.taskId))
    .filter((task): task is Task => Boolean(task))
    .filter((task) => {
      if (ranked.has(task.id) || scheduledTaskIds.has(task.id) || seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
  return { todaysThree, scheduled, flexible };
}
