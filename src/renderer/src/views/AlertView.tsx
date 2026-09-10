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
import { ActivityGuide } from '../features/reminders/ActivityGuide';
import {
  formatRestDuration,
  restAnimalAction,
  restCountdown,
  restKindCopy,
  restPhase
} from '../features/reminders/restViewModel';

/** Ring geometry for the countdown dial (viewBox 0 0 120 120). */
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The rest/reminder surface. The main process owns the schedule and the
 * enforced wait; this window only renders that state as an "art stage +
 * reading panel" card (docs/superpowers/specs/2026-08-31-quiet-editorial-ui-design.md
 * §Pet/Alert/Bubble): the stage carries the pixel companion and the kind, the
 * panel carries the copy, the micro-break steps, the countdown and the actions.
 */
export default function AlertView(): JSX.Element {
  const { activeReminder: active } = useReminderStatus();
  const now = useClock(1000);
  const pomodoro = usePomodoro();
  const { settings } = useSettings();
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
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
  const ringValue = phase === 'resting' ? remainingSeconds : phase === 'finished' ? 0 : totalSeconds;
  const ringLabel = formatRestDuration(ringValue);
  const ringCaption = phase === 'resting' ? '剩余' : phase === 'finished' ? '已到时间' : '计划休息';
  const lede = !started
    ? mergedWithPomodoro
      ? '将与本轮番茄休息合并，点击开始休息。'
      : '准备好后，点击开始休息。'
    : phase === 'finished'
      ? '这次休息时间已到'
      : `还有 ${remainingSeconds} 秒，跟着节奏放松`;

  return <main className={`alert-shell simple-rest kind-${active.kind}`}>
    <section className="rest-card" aria-labelledby="rest-title">
      <div className="rest-stage">
        <span className="rest-kind-badge">{copy.badge}</span>
        <div className="rest-stage-art">
          <PixelAnimal
            animal={animal}
            action={restAnimalAction(active.kind, phase)}
            label={`${copy.badge} · ${animalName}`}
          />
        </div>
        <p className="rest-stage-caption">{copy.caption}</p>
      </div>

      <div className="rest-panel">
        <header className="rest-heading">
          <p className="rest-eyebrow">
            触发于 {new Date(active.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            {active.snoozeCount > 0 ? ` · 已稍后 ${active.snoozeCount} 次` : ''}
          </p>
          <h1 id="rest-title">{copy.title}</h1>
          <p className="rest-lede">{lede}</p>
        </header>

        <div className="rest-timer">
          <div className="rest-ring" role="timer" aria-live="off" aria-label="休息剩余时间">
            <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
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
            <div className="rest-ring-text">
              <strong>{ringLabel}</strong>
              <span>{ringCaption}</span>
            </div>
          </div>
          <div className="rest-timer-copy">
            <strong>{copy.detail}</strong>
            <span>{started ? '休息期间已暂停专注，结束后手动继续。' : `本次休息 ${totalSeconds} 秒。`}</span>
          </div>
        </div>

        {activities.length > 0 ? <ul className="rest-activities" aria-label="休息建议">
          {activities.map((activity) => <li key={activity.id}>
            <ActivityGuide
              activity={activity}
              startedAt={typeof active.restStartedAt === 'number' ? active.restStartedAt : now}
              now={now}
            />
          </li>)}
        </ul> : null}

        {active.breakTask ? <p className="rest-break-task">顺便处理：{active.breakTask.title}</p> : null}

        <div className="rest-actions">
          {!started
            ? <button className="primary" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.beginHealthRest(active.id))}>开始休息</button>
            : <button className="primary" disabled={remainingSeconds > 0 || action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('complete', active.id))}>完成休息</button>}
          <div className="rest-snooze-group">
            <button disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('snooze', active.id))}>稍后提醒</button>
            <select aria-label="稍后分钟数" value={settings.snoozeMinutes} onChange={(e) => void action.run(() => window.eyeProtect.saveSettings({ snoozeMinutes: Number(e.currentTarget.value) }))}>{[1, 5, 10, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select>
          </div>
          <button className="ghost" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('skip', active.id))}>跳过</button>
        </div>

        {action.error ? <p className="rest-error" role="alert">{action.error.message}</p> : null}
      </div>
    </section>
  </main>;
}
