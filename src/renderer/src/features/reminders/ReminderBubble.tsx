import { X } from 'lucide-react';
import { getActivity } from '../../../../shared/breakActivities';
import type { ActiveReminder, BreakActivity, PreAlertInfo, Settings } from '../../../../shared/types';
import { useClock } from '../../hooks/useClock';
import { useCommand } from '../../hooks/useCommand';
import { run } from '../../lib/commands';
import {
  formatRestDuration,
  getActivityProgress,
  restCountdown,
  restKindCopy,
  restLede,
  restPhase
} from './restViewModel';

/** Ring geometry for the compact bubble dial (viewBox 0 0 76 76). */
const RING_RADIUS = 32;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Gentle-mode reminders live in the bubble next to the pet instead of the
 * full alert window, so this is the compact twin of AlertView: same copy, same
 * ring-as-progress idea, same three actions, sized for a ~300px card.
 *
 * Pre-alerts share the surface but are a different question ("the break is
 * coming, what do you want to do about it?"), so they get their own component
 * and their own actions.
 */
export function GentleReminderBubble({
  active,
  settings
}: {
  active: ActiveReminder;
  settings: Settings;
}): JSX.Element {
  const now = useClock(1000);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const copy = restKindCopy(active.kind);
  const phase = restPhase(active, now);
  const { remainingSeconds, progress } = restCountdown(active, now, settings);
  const started = phase !== 'ready';
  const activities = active.activityIds
    .map(getActivity)
    .filter((activity): activity is BreakActivity => activity !== null);
  const restStartedAt = typeof active.restStartedAt === 'number' ? active.restStartedAt : now;
  // The step to show is the first activity that has not run out of its
  // suggested duration; when every one has, the bubble says so instead.
  const current = activities
    .map((activity) => ({ activity, step: getActivityProgress(activity, restStartedAt, now) }))
    .find((entry) => !entry.step.complete) ?? null;
  const lede = restLede(phase, remainingSeconds);
  const skip = (): void => void action.run(() => window.eyeProtect.reminderAction('skip', active.id));

  return <div className={`bubble-shell bubble-reminder kind-${active.kind}`}>
    <div className="bubble-card">
      <div className="bubble-head">
        <span className="bubble-kind">{copy.badge}</span>
        <button className="bubble-close" aria-label="跳过这次提醒" title="跳过这次提醒" onClick={skip}>
          <X size={13} />
        </button>
      </div>

      <div className="bubble-main">
        <p className="bubble-ring" role="timer" aria-live="off" aria-label="休息剩余时间">
          <svg viewBox="0 0 76 76" aria-hidden="true" focusable="false">
            <circle className="bubble-ring-track" cx="38" cy="38" r={RING_RADIUS} />
            <circle
              className="bubble-ring-value"
              cx="38"
              cy="38"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
            />
          </svg>
          <span>{formatRestDuration(remainingSeconds)}</span>
        </p>
        <div className="bubble-copy">
          <h2>{copy.title}</h2>
          <p>{lede}</p>
        </div>
      </div>

      {started && current ? <p className="bubble-step">
        <strong>{current.activity.steps[current.step.stepIndex]}</strong>
        第 {current.step.stepIndex + 1}/{current.activity.steps.length} 步
      </p> : null}

      <div className="bubble-actions">
        {!started
          ? <button className="primary" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.beginHealthRest(active.id))}>开始休息</button>
          : <button className="primary" disabled={remainingSeconds > 0 || action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('complete', active.id))}>{remainingSeconds > 0 ? `完成休息（${remainingSeconds} 秒）` : '完成休息'}</button>}
        <div className="bubble-actions-row">
          <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('snooze', active.id))}>稍后</button>
          <button disabled={action.isPending} onClick={skip}>跳过</button>
        </div>
      </div>

      {action.error ? <p className="bubble-error" role="alert">{action.error.message}</p> : null}
    </div>
    <span className="bubble-tail" />
  </div>;
}

/** The soft heads-up shown a few seconds before a reminder fires. */
export function PreAlertBubble({ preAlert }: { preAlert: PreAlertInfo }): JSX.Element {
  const now = useClock(1000);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const copy = restKindCopy(preAlert.kind);
  const minutes = Math.max(1, Math.round((preAlert.firesAt - now) / 60_000));
  const act = (next: 'start' | 'snooze' | 'dismiss') => (): void =>
    void action.run(() => window.eyeProtect.preAlertAction(next));

  return <div className={`bubble-shell bubble-prealert kind-${preAlert.kind}`}>
    <div className="bubble-card">
      <div className="bubble-head">
        <span className="bubble-kind">{copy.badge}</span>
      </div>
      <div className="bubble-copy">
        <h2>{copy.title}</h2>
        <p>还有 {minutes} 分钟。现在开始，还是稍后？</p>
      </div>
      <div className="bubble-actions">
        <button className="primary" disabled={action.isPending} onClick={act('start')}>现在开始</button>
        <div className="bubble-actions-row">
          <button disabled={action.isPending} onClick={act('snooze')}>稍后 2 分钟</button>
          <button disabled={action.isPending} onClick={act('dismiss')}>保持计划</button>
        </div>
      </div>
      {action.error ? <p className="bubble-error" role="alert">{action.error.message}</p> : null}
    </div>
    <span className="bubble-tail" />
  </div>;
}
