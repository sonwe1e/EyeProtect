import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useClock } from '../hooks/useClock';
import { useCommand } from '../hooks/useCommand';
import { usePomodoro } from '../hooks/usePomodoro';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';
import { getActivity } from '../../../shared/breakActivities';
import { PIXEL_ANIMAL_NAMES } from '../../../shared/pixelAnimals';
import type { BreakActivity } from '../../../shared/types';
import { run } from '../lib/commands';
import { PixelAnimal } from '../features/characters/PixelAnimal';
import {
  formatRestDuration,
  getActivityProgress,
  restAnimalAction,
  restAnimalActionForStep,
  restCountdown,
  restKindCopy,
  restPhase
} from '../features/reminders/restViewModel';

/** Ring geometry for the countdown dial (viewBox 0 0 120 120). */
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The rest/reminder surface. The main process owns the schedule and the
 * enforced wait; this window only renders that state.
 *
 * Composition: the companion sits inside the countdown ring, and the ring is
 * the single progress indicator for the break. The number tag straddles the
 * ring's lower edge so the readout stays legible without competing with the
 * artwork. Below the stage, the panel carries the copy, the numbered
 * micro-break steps and the actions.
 *
 * The card is a glass panel (see --glass-panel in theme.css). It floats over
 * the user's desktop, so the base is deliberately almost opaque; text on it is
 * restricted to --fg-primary / --fg-secondary, which the contrast contract
 * checks against the worst-case wallpaper.
 */
export default function AlertView(): JSX.Element {
  const { activeReminder: active } = useReminderStatus();
  const now = useClock(1000);
  const pomodoro = usePomodoro();
  const { settings } = useSettings();
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const [finishCue, setFinishCue] = useState(false);
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      prevPhaseRef.current = null;
      setFinishCue(false);
      return;
    }
    const phase = restPhase(active, now);
    if (phase === 'finished' && prevPhaseRef.current !== 'finished') setFinishCue(true);
    if (phase !== 'finished') setFinishCue(false);
    prevPhaseRef.current = phase;
  }, [active, now]);
  if (!active) return <main className="alert-shell" />;

  const phase = restPhase(active, now);
  const copy = restKindCopy(active.kind);
  const { remainingSeconds, totalSeconds, progress } = restCountdown(active, now, settings);
  const activities = active.activityIds
    .map(getActivity)
    .filter((activity): activity is BreakActivity => activity !== null);
  const started = phase !== 'ready';
  const animal = settings.petAppearance;
  const animalName = PIXEL_ANIMAL_NAMES[animal];
  const mergedWithPomodoro =
    pomodoro.phase === 'focus-finished' || pomodoro.phase === 'break';
  const restStartedAt = typeof active.restStartedAt === 'number' ? active.restStartedAt : now;
  // Only the activity in progress is shown, with the next one named: a break is
  // followed one instruction at a time, and listing every step of every
  // activity pushed the panel into a scroll it does not need.
  const activityStates = activities.map((activity) => ({
    activity,
    step: getActivityProgress(activity, restStartedAt, now)
  }));
  const incompleteIndex = activityStates.findIndex((entry) => !entry.step.complete);
  const currentIndex = incompleteIndex === -1 ? Math.max(0, activityStates.length - 1) : incompleteIndex;
  const current = activityStates[currentIndex];
  const upcoming = activityStates[currentIndex + 1];
  const showSteps = started && Boolean(current);
  const currentStepText = current ? current.activity.steps[current.step.stepIndex] ?? null : null;
  const animalAction = started && !current && phase !== 'finished'
    ? restAnimalAction(active.kind, phase)
    : restAnimalActionForStep(phase, current?.activity ?? null, currentStepText);
  const animalKey = `${animalAction}:${current?.activity?.id ?? 'none'}:${current?.step.stepIndex ?? 0}`;
  const lede = !started
    ? mergedWithPomodoro
      ? '将与本轮番茄休息合并，点击开始休息。'
      : '准备好后，点击开始休息。'
    : phase === 'finished'
      ? '这次休息时间已到'
      : `还有 ${remainingSeconds} 秒，跟着节奏放松`;
  const hint = !started
    ? `本次休息 ${totalSeconds} 秒`
    : phase === 'finished'
      ? '已到时间，可以完成本次休息。'
      : `还剩 ${remainingSeconds} 秒 · 提前完成不会被记录`;

  return <main className={`alert-shell simple-rest kind-${active.kind}${phase === 'resting' ? ' is-resting' : ''}`}>
    <section className={`rest-card${showSteps ? ' has-steps' : ''}`} aria-labelledby="rest-title">
      <div className="rest-ambient" aria-hidden="true">
        <span className="rest-orb is-1" />
        <span className="rest-orb is-2" />
      </div>

      <div className="rest-stage">
        <span className="rest-stage-glow" aria-hidden="true" />
        <svg className={`rest-ring${finishCue ? ' is-flash' : ''}`} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <circle className="rest-ring-track" cx="60" cy="60" r={RING_RADIUS} />
          <circle
            className="rest-ring-value"
            cx="60"
            cy="60"
            r={RING_RADIUS}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
          />
        </svg>
        <div className="rest-stage-art">
          <PixelAnimal
            key={animalKey}
            animal={animal}
            action={animalAction}
            label={`${copy.badge} · ${animalName}`}
          />
        </div>
        <p className="rest-stage-count" role="timer" aria-live="off" aria-label="休息剩余时间">
          <strong>{formatRestDuration(remainingSeconds)}</strong>
          <small>{phase === 'finished' ? '已到时间' : phase === 'resting' ? '剩余' : '计划休息'}</small>
        </p>
      </div>

      <div className="rest-scroll">
        <span className="rest-badge">{copy.badge}</span>
        <h1 id="rest-title" className="rest-title">{copy.title}</h1>
        <p className="rest-lede">{lede}</p>

        {showSteps && current ? <section className="rest-activity">
          <p className="rest-activity-head">
            <strong>{current.activity.title}</strong>
            <span>{current.step.complete ? '建议时长已完成' : `第 ${current.step.stepIndex + 1}/${current.activity.steps.length} 步`}</span>
          </p>
          <ol className="rest-steps">
            {current.activity.steps.map((text, index) => <li
              key={`${current.activity.id}-${index}`}
              className={`rest-step ${index < current.step.stepIndex ? 'is-done' : index === current.step.stepIndex ? 'is-active' : ''}`.trim()}
            >
              <b aria-hidden="true">{index < current.step.stepIndex ? <Check size={12} /> : index + 1}</b>
              <span>{text}</span>
            </li>)}
          </ol>
          <div className="rest-progress" aria-hidden="true">
            <i style={{ width: `${Math.round(current.step.progress * 100)}%` }} />
          </div>
          {upcoming ? <p className="rest-next">接下来：{upcoming.activity.title}</p> : null}
        </section> : null}

        {active.breakTask ? <p className="rest-break-task">顺便处理：{active.breakTask.title}</p> : null}
        {!started ? <p className="rest-note">触发于 {new Date(active.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p> : null}
        {started && active.snoozeCount > 0 ? <p className="rest-note">已稍后 {active.snoozeCount} 次</p> : null}
      </div>

      <div className="rest-actions">
        {!started
          ? <button className="rest-primary" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.beginHealthRest(active.id))}>开始休息</button>
          : <button className={`rest-primary${finishCue ? ' is-unlocked' : ''}`} disabled={remainingSeconds > 0 || action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('complete', active.id))}>完成休息</button>}
        <div className="rest-actions-row">
          <div className="rest-snooze-group">
            <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('snooze', active.id))}>稍后提醒</button>
            <select aria-label="稍后分钟数" value={settings.snoozeMinutes} onChange={(e) => void action.run(() => window.eyeProtect.saveSettings({ snoozeMinutes: Number(e.currentTarget.value) }))}>{[1, 5, 10, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select>
          </div>
          <button className="rest-skip" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('skip', active.id))}>跳过</button>
        </div>
        <p className="rest-hint">{hint}</p>
        {action.error ? <p className="rest-error" role="alert">{action.error.message}</p> : null}
      </div>
    </section>
  </main>;
}
