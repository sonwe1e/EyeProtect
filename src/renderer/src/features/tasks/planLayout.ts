import type { Task } from '../../../../shared/types';

export type TimelinePosition = { lane: number; count: number };

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
    const end = start + (task.estimateMinutes ?? 30) * 60_000;
    laneEnds[selectedLane] = end;
    cluster.push({ id: task.id, lane: selectedLane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return layout;
};
