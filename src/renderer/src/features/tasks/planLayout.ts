import type { Task, TimeBlock } from '../../../../shared/types';

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

export interface LayoutInterval {
  id: string;
  startAt: number;
  endAt: number;
}

/**
 * Greedy lane assignment for any set of intervals (USERPLAN 1.2 PR4: the
 * planner renders TimeBlocks, so layout must work on real start/end pairs,
 * not on task fields). Overlapping intervals share a cluster and split its
 * width; a cluster ends when the next interval starts after every lane.
 */
export const assignIntervalLanes = (intervals: LayoutInterval[]): Map<string, TimelinePosition> => {
  const sorted = [...intervals].sort((left, right) => left.startAt - right.startAt || left.endAt - right.endAt);
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
  for (const interval of sorted) {
    if (cluster.length && interval.startAt >= clusterEnd) flush();
    const lane = laneEnds.findIndex((end) => end <= interval.startAt);
    const selectedLane = lane === -1 ? laneEnds.length : lane;
    laneEnds[selectedLane] = interval.endAt;
    cluster.push({ id: interval.id, lane: selectedLane });
    clusterEnd = Math.max(clusterEnd, interval.endAt);
  }
  flush();
  return layout;
};

/** Block-based layout used by the TimeBlock planner. */
export const buildBlockLayout = (blocks: TimeBlock[]): Map<string, TimelinePosition> =>
  assignIntervalLanes(blocks.map((block) => ({ id: block.id, startAt: block.startAt, endAt: block.endAt })));

/**
 * Legacy task-based layout kept for compatibility: intervals derived from
 * plannedAt + estimate (visual minimum when unestimated). New planner
 * surfaces must use buildBlockLayout instead (ADR-001).
 */
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
