import type { DailyTaskPlan, Task } from '../../../../shared/types';
import { deriveTodaySections, type TodaySections } from './todaySections';

export interface TodayExecutionModel extends TodaySections {
  /** Unique ordered union used by navigation counts and Focus candidates. */
  tasks: Task[];
  taskIds: ReadonlySet<string>;
  count: number;
}

/**
 * One authoritative definition of work committed to Today.
 *
 * DailyTaskPlan and today's TimeBlocks are the domain facts. Legacy dueAt and
 * plannedAt may still be shown as metadata, but cannot make the Today body,
 * its navigation count, and Focus candidates disagree with each other.
 */
export function deriveTodayExecutionModel(
  tasks: Task[],
  todayPlans: DailyTaskPlan[],
  scheduledTaskIds: ReadonlySet<string>
): TodayExecutionModel {
  const sections = deriveTodaySections(tasks, todayPlans, scheduledTaskIds);
  const ordered = [...sections.todaysThree, ...sections.scheduled, ...sections.flexible];
  const taskIds = new Set<string>();
  const unique = ordered.filter((task) => {
    if (taskIds.has(task.id)) return false;
    taskIds.add(task.id);
    return true;
  });
  return { ...sections, tasks: unique, taskIds, count: unique.length };
}
