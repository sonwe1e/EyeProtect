import type { Task } from '../../../../shared/types';

export type TimelinePosition = { lane: number; count: number };

/**
 * Visual footprint (minutes) used when a task has no estimate. This is a
 * rendering minimum only — it must never be reported to the user as planned
 * workload (USERPLAN 1.2 PR0: "Planner 不应该向用户展示数据库里不存在的计划事实").
 */
export const PLAN_UNESTIMATED_VISUAL_MINUTES = 24;

/** Layout duration for a task: real estimate, else the visual minimum. */
export const planLayoutMinutes = (task: Task): number =>
  task.estimateMinutes ?? PLAN_UNESTIMATED_VISUAL_MINUTES;

export const buildTimelineLayout = (
  scheduled: Task[],
  day: number
): Map<string, TimelinePosition> => {
  const layout = new Map<string, TimelinePosition>();
  let laneEnds: number[] = [];
  let cluster: Array<{ id: string; lane: number }> = [];
  let clusterEnd = 0;
  const flush = (): void => {
    const count = Math.max(1, laneEnds.length);
    for (const entry of cluster) layout.set(entry.id, { lane: entry.lane, count });
    laneEnds = [];
    cluster = [];
    clusterEnd = 0;
  };
  for (const task of scheduled) {
    const start = task.plannedAt ?? day;
    if (cluster.length && start >= clusterEnd) flush();
    const lane = laneEnds.findIndex((end) => end <= start);
    const selectedLane = lane === -1 ? laneEnds.length : lane;
    const end = start + planLayoutMinutes(task) * 60_000;
    laneEnds[selectedLane] = end;
    cluster.push({ id: task.id, lane: selectedLane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return layout;
};
