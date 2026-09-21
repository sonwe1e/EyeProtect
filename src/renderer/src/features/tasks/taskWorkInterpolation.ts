import type { TaskWorkSummary } from '../../../../shared/types';

export interface TimedTaskWorkSummary {
  summary: TaskWorkSummary;
  receivedAt: number;
}

/** Advance a running work snapshot between IPC updates (pure, testable). */
export const interpolateTaskWork = (
  { summary, receivedAt }: TimedTaskWorkSummary,
  now: number
): TaskWorkSummary => {
  if (!summary.tracking || !summary.taskId) return summary;
  const elapsed = Math.max(0, now - receivedAt);
  return {
    ...summary,
    taskActiveMs: summary.taskActiveMs + elapsed,
    currentSessionMs: summary.currentSessionMs + elapsed,
    continuousActiveMs: summary.continuousActiveMs + elapsed
  };
};
