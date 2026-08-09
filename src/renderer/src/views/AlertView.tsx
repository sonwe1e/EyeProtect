import { Check, Clock3, X } from 'lucide-react';
import type { BreakActivity } from '../../../shared/types';
import { getActivity } from '../../../shared/breakActivities';
import { ActivityGuide } from '../features/reminders/ActivityGuide';
import { ReminderArtwork, reminderCopy } from '../features/reminders/ReminderArtwork';
import { useClock } from '../hooks/useClock';
import { useActiveTaskId } from '../hooks/useActiveTask';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useTasks } from '../hooks/useTasks';

export default function AlertView(): JSX.Element {
  const status = useReminderStatus();
  const tasks = useTasks();
  const activeTaskId = useActiveTaskId();
  const now = useClock(1_000);
  const active = status.activeReminder;

  if (!active) {
    return <main className="alert-shell" />;
  }

  const copy = reminderCopy[active.kind];
  const waiting = now < active.unlockAt;
  const waitSeconds = Math.max(0, Math.ceil((active.unlockAt - now) / 1000));
  const snoozeLocked = now < active.snoozeAllowedAt;
  const activities = active.activityIds
    .map((id) => getActivity(id))
    .filter((entry): entry is BreakActivity => Boolean(entry));
  const suggestedUntil =
    active.startedAt +
    Math.max(0, ...activities.map((activity) => activity.durationSeconds * 1_000));
  const suggestedSeconds = Math.max(0, Math.ceil((suggestedUntil - now) / 1_000));
  const liveBreakTask = active.breakTask
    ? tasks.find((task) => task.id === active.breakTask?.id)
    : null;
  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null;

  const handleDoubleClick = (): void => {
    if (!waiting) {
      void window.eyeProtect.reminderAction('complete', active.id);
    }
  };

  return (
    <main className="alert-shell">
      <ReminderArtwork active={active} canComplete={!waiting} onDoubleClick={handleDoubleClick} />
      <section className="alert-panel">
        <div className="alert-heading">
          <span className={`kind-badge ${active.kind}`}>
            {active.kind === 'eye' ? '护眼' : active.kind === 'walk' ? '走动' : '休息'}
          </span>
          <h1>{copy.title}</h1>
          <p>{copy.detail}</p>
        </div>
        {activities.length > 0 ? (
          <div className="alert-activities">
            {activities.map((activity) => (
              <ActivityGuide
                key={activity.id}
                activity={activity}
                startedAt={active.startedAt}
                now={now}
              />
            ))}
          </div>
        ) : null}
        {active.mode === 'guided' ? (
          <div className="alert-guided-hint">
            <span>
              {suggestedSeconds > 0
                ? `建议再休息 ${suggestedSeconds} 秒`
                : '建议时长已完成'}
            </span>
            <small>不强制等待，可随时完成</small>
          </div>
        ) : null}
        {active.breakTask && liveBreakTask && liveBreakTask.status !== 'done' ? (
          <div className="break-todo-card">
            <div>
              <span>这次走动可以顺便</span>
              <strong>{active.breakTask.title}</strong>
            </div>
            <button
              type="button"
              onClick={() => void window.eyeProtect.setTaskStatus(active.breakTask?.id ?? '', 'done')}
            >
              <Check size={14} />
              做好了
            </button>
          </div>
        ) : null}
        {activeTask ? <p className="break-return-task">休息后继续：<strong>{activeTask.title}</strong></p> : null}
        {waiting ? (
          <div className="alert-wait-hint">
            <span className="alert-wait-time">
              {waitSeconds} 秒后{snoozeLocked ? '可「完成」或「稍后」' : '可「完成」'}
            </span>
            <span className="alert-wait-note">「跳过」随时可用</span>
          </div>
        ) : null}
        <div className="alert-actions">
          <button
            className="primary"
            disabled={waiting}
            onClick={() => void window.eyeProtect.reminderAction('complete', active.id)}
          >
            <Check size={18} />
            完成
          </button>
          <button
            disabled={snoozeLocked}
            onClick={() => void window.eyeProtect.reminderAction('snooze', active.id)}
          >
            <Clock3 size={18} />
            稍后
          </button>
          <button onClick={() => void window.eyeProtect.reminderAction('skip', active.id)}>
            <X size={18} />
            跳过
          </button>
        </div>
      </section>
    </main>
  );
}
