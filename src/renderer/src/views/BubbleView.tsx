import { useCallback } from 'react';
import { Check, Clock3, Eye, Footprints, ListChecks, Timer, X } from 'lucide-react';
import { sortTasksForView } from '../../../shared/types';
import { getActivity } from '../../../shared/breakActivities';
import type { BreakActivity } from '../../../shared/types';
import { ActivityGuide } from '../features/reminders/ActivityGuide';
import { useClock } from '../hooks/useClock';
import { useActiveTaskId } from '../hooks/useActiveTask';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useTasks } from '../hooks/useTasks';

export default function BubbleView(): JSX.Element {
  const tasks = useTasks();
  const activeTaskId = useActiveTaskId();
  const status = useReminderStatus();
  const now = useClock(1_000);
  const openTodos = useCallback(() => {
    void window.eyeProtect.openPanel('todos');
  }, []);
  const handleBubbleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openTodos();
      }
    },
    [openTodos]
  );

  const active = status.activeReminder;
  // The bubble doubles as the surface for gentle reminders and soft
  // pre-alerts; those take precedence over the todo preview.
  if (active && active.mode === 'gentle') {
    const kindLabel = active.kind === 'eye' ? '护眼' : active.kind === 'walk' ? '走动' : '休息';
    const activities = active.activityIds
      .map((id) => getActivity(id))
      .filter((entry): entry is BreakActivity => Boolean(entry));
    const breakTask = active.breakTask
      ? tasks.find((task) => task.id === active.breakTask?.id)
      : null;
    const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null;
    const waiting = now < active.unlockAt;
    return (
      <div className="bubble-shell bubble-reminder">
        <div className="bubble-card">
          <div className="bubble-title">
            {active.kind === 'walk' ? <Footprints size={13} /> : <Eye size={13} />}
            <span>{kindLabel}提醒</span>
          </div>
          <p>不打断当前工作，跟着做一个小动作吧。</p>
          <div className="bubble-activities">
            {activities.map((activity) => (
              <ActivityGuide
                key={activity.id}
                activity={activity}
                startedAt={active.startedAt}
                now={now}
                compact
              />
            ))}
          </div>
          {active.breakTask && breakTask && breakTask.status !== 'done' ? (
            <button
              type="button"
              className="bubble-break-todo"
              onClick={() => void window.eyeProtect.setTaskStatus(active.breakTask?.id ?? '', 'done')}
            >
              <Footprints size={13} />
              <span>顺路：{active.breakTask.title}</span>
              <Check size={13} />
            </button>
          ) : null}
          {activeTask ? <p className="break-return-task compact">休息后继续：<strong>{activeTask.title}</strong></p> : null}
          <div className="bubble-actions">
            <button
              className="primary"
              disabled={waiting}
              onClick={() => void window.eyeProtect.reminderAction('complete', active.id)}
            >
              <Check size={12} />
              完成
            </button>
            <button onClick={() => void window.eyeProtect.reminderAction('snooze', active.id)}>
              <Clock3 size={12} />
              稍后
            </button>
            <button onClick={() => void window.eyeProtect.reminderAction('skip', active.id)}>
              <X size={12} />
              跳过
            </button>
          </div>
        </div>
        <span className="bubble-tail" />
      </div>
    );
  }

  if (status.preAlert) {
    const seconds = Math.max(0, Math.ceil((status.preAlert.firesAt - now) / 1000));
    const kindLabel = status.preAlert.kind === 'eye' ? '护眼' : '走动';
    return (
      <div className="bubble-shell bubble-prealert">
        <div className="bubble-card">
          <div className="bubble-title">
            <Timer size={13} />
            <span>
              {seconds} 秒后{kindLabel}提醒
            </span>
          </div>
          <p>要现在开始休息吗？</p>
          <div className="bubble-actions">
            <button className="primary" onClick={() => void window.eyeProtect.preAlertAction('start')}>
              现在休息
            </button>
            <button
              title="完成手头这一小段，延后 2 分钟"
              onClick={() => void window.eyeProtect.preAlertAction('snooze')}
            >
              +2 分钟
            </button>
            <button onClick={() => void window.eyeProtect.preAlertAction('dismiss')}>按原计划</button>
          </div>
        </div>
        <span className="bubble-tail" />
      </div>
    );
  }

  const pending = tasks.filter((task) => task.status !== 'done' && task.status !== 'archived');
  const preview = sortTasksForView(pending, now).slice(0, 3);

  if (tasks.length === 0) {
    return <></>;
  }
  if (pending.length === 0) {
    return (
      <div
        className="bubble-shell"
        role="button"
        tabIndex={0}
        title="查看全部待办"
        onClick={openTodos}
        onKeyDown={handleBubbleKeyDown}
      >
        <div className="bubble-card bubble-all-done">
          <div className="bubble-title">
            <Check size={13} />
            <span>待办都完成啦</span>
          </div>
          <p className="bubble-done-note">休息一下，晚点再添加新的。</p>
        </div>
        <span className="bubble-tail" />
      </div>
    );
  }

  const overflow = pending.length - preview.length;
  return (
    <div
      className="bubble-shell"
      role="button"
      tabIndex={0}
      title="查看全部待办"
      onClick={openTodos}
      onKeyDown={handleBubbleKeyDown}
    >
      <div className="bubble-card">
        <div className="bubble-title">
          <ListChecks size={13} />
          <span>待办</span>
          <span className="bubble-count" title={`共 ${tasks.length} 件，已完成 ${tasks.length - pending.length} 件`}>
            {pending.length}
          </span>
        </div>
        <ul className="bubble-list">
          {preview.map((task) => (
            <li key={task.id} className="bubble-item">
              <span className="bubble-dot" data-priority={task.priority} />
              <span className="bubble-text">{task.title}</span>
            </li>
          ))}
        </ul>
        {overflow > 0 ? <span className="bubble-more">还有 {overflow} 项…</span> : null}
      </div>
      <span className="bubble-tail" />
    </div>
  );
}
