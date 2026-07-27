import type { BreakActivity } from '../../../../shared/types';

export const getActivityProgress = (
  activity: BreakActivity,
  startedAt: number,
  now: number
): {
  stepIndex: number;
  complete: boolean;
  progress: number;
} => {
  const durationMs = Math.max(1, activity.durationSeconds * 1_000);
  const elapsed = Math.max(0, now - startedAt);
  const progress = Math.min(1, elapsed / durationMs);
  const stepIndex = Math.min(
    activity.steps.length - 1,
    Math.floor(progress * activity.steps.length)
  );
  return {
    stepIndex: Math.max(0, stepIndex),
    complete: progress >= 1,
    progress
  };
};

export function ActivityGuide({
  activity,
  startedAt,
  now,
  compact = false
}: {
  activity: BreakActivity;
  startedAt: number;
  now: number;
  compact?: boolean;
}): JSX.Element {
  const { stepIndex, complete, progress } = getActivityProgress(activity, startedAt, now);
  const step = activity.steps[stepIndex] ?? activity.title;

  return (
    <div className={`activity-guide ${compact ? 'is-compact' : ''}`.trim()}>
      <div className="activity-guide-heading">
        <strong>{activity.title}</strong>
        <span>
          {complete ? '已完成建议时长' : `第 ${stepIndex + 1}/${activity.steps.length} 步`}
        </span>
      </div>
      <progress max={1} value={progress} aria-label={`${activity.title}进度`} />
      <p>{complete ? '可以完成本次休息，也可以再放松一会儿。' : step}</p>
    </div>
  );
}
