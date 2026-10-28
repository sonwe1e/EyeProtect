import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Volume2, VolumeX } from 'lucide-react';
import { useClock } from '../hooks/useClock';
import { useCommand } from '../hooks/useCommand';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';
import { getActivity } from '../../../shared/breakActivities';
import type { BreakActivity } from '../../../shared/types';
import { CompanionArtwork } from '../features/characters/CompanionArtwork';
import { run } from '../lib/commands';
import { soundPlayer } from '../lib/audio';
import { activityAnimalAction, formatRestDuration, restActivityStates, restCountdown, restKindCopy, restPhase } from '../features/reminders/restViewModel';
import { restCaptionLine, restTitleLine } from '../features/reminders/restCopyPool';

/** One glance, then look away. Suggestions and deadlines are owned by main. */
export default function AlertView(): JSX.Element {
  const { activeReminder: active } = useReminderStatus();
  const now = useClock(1000);
  const { settings } = useSettings();
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));
  const playedStart = useRef<string | null>(null);
  const playedFinish = useRef<string | null>(null);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const phase = active ? restPhase(active, now) : 'ready';

  useEffect(() => {
    const sync = (): void => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    if (!active || phase === 'ready' || playedStart.current === active.id) return;
    playedStart.current = active.id;
    if (settings.soundEnabled) soundPlayer.playRestStart(settings.soundVolume);
  }, [active?.id, phase, settings.soundEnabled, settings.soundVolume]);
  useEffect(() => {
    if (!active || phase !== 'finished' || playedFinish.current === active.id) return;
    playedFinish.current = active.id;
    if (settings.soundEnabled) soundPlayer.playRestComplete(settings.soundVolume);
  }, [active?.id, phase, settings.soundEnabled, settings.soundVolume]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Escape' || event.repeat || action.isPending) return;
      event.preventDefault();
      void action.run(() => window.eyeProtect.reminderAction('snooze', active.id));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, action]);

  if (!active) return <main className="alert-shell" />;
  const activities = active.activityIds.map(getActivity).filter((item): item is BreakActivity => item !== null);
  const states = restActivityStates(activities, active.restStartedAt ?? now, active.unlockAt, now);
  const current = states.find((item) => !item.step.complete) ?? states.at(-1);
  const copy = restKindCopy(active.kind);
  const { remainingSeconds, progress } = restCountdown(active, now, settings);
  // Keep the initial instruction stable; someone looking away cannot read steps.
  const suggestion = activities[0];
  const finished = phase === 'finished';
  // Main title stays glanceable and stable for the whole rest: pools serve
  // finished (every kind, egg-gated) and combined ready/resting; eye/walk keep
  // the activity instruction. An empty pick falls back to the fixed copy.
  const title = finished
    ? restTitleLine(active.id, active.kind, 'finished') || '这一小段休息，刚刚好'
    : active.kind === 'combined'
      ? restTitleLine(active.id, 'combined', phase) || copy.title
      : suggestion?.title ?? copy.title;
  const instruction = finished ? '可以继续了，也可以再多休息一会儿。'
    : active.kind === 'combined' ? '把视线移开屏幕，起身走一小圈。'
      : suggestion?.steps[0] ?? copy.detail;
  const caption = phase === 'finished'
    ? '一起慢慢来'
    : restCaptionLine(active.id, active.kind, phase) || '我在这里陪你';
  const artworkAction = finished ? 'celebrate' : current ? activityAnimalAction(current.activity, current.step.stepIndex) : 'sleep';

  return <main className={`alert-shell simple-rest kind-${active.kind}`} style={{ '--rest-reading-scale': settings.restReadingScale } as CSSProperties}>
    <section className={`rest-card rest-away-card${finished ? ' is-finished' : ''}`} aria-labelledby="rest-title">
      <header className="rest-topbar">
        <span className="rest-badge">{copy.badge}</span>
        <button type="button" className="rest-sound-toggle" aria-label={settings.soundEnabled ? '静音提示音' : '开启提示音'}
          title={settings.soundEnabled ? '提示音已开启' : '提示音已关闭'} disabled={action.isPending}
          onClick={() => void action.run(() => window.eyeProtect.saveSettings({ soundEnabled: !settings.soundEnabled }))}>
          {settings.soundEnabled ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </button>
      </header>
      <div className="rest-away-body">
        <div className="rest-reading-panel">
          <p className="rest-eyebrow">{finished ? '谢谢你照顾自己' : '现在就可以离开屏幕'}</p>
          <h1 className="rest-title" id="rest-title">{title}</h1>
          <p className="rest-instruction">{instruction}</p>
          <p className="rest-offscreen-note">{finished ? '稍后自动收起，无需打卡。' : phase === 'ready' ? '正在开始休息，无需点击。'
            : settings.soundEnabled ? '不用看倒计时，提示音会告诉你何时结束。' : '到时自动收起，不用一直看着屏幕。'}</p>
        </div>
        <div className="rest-companion-stage" aria-hidden="true">
          {/* 遮罩小道具（vision R2-6）：窗景+月亮（ready/resting）、毛巾（finished）。
              全装饰位：slot aria-hidden、pointer-events none；petMotion off 时
              React 不挂 rest-prop-animated 类（静态图形保留，与美术帧同开关）。 */}
          <div className="rest-prop-slot">
            {finished ? (
              <div className={`rest-prop rest-prop-towel${settings.petMotion && pageVisible ? ' rest-prop-animated' : ''}`.trim()} />
            ) : (
              <div className={`rest-prop rest-prop-window${settings.petMotion && pageVisible ? ' rest-prop-animated' : ''}`.trim()}>
                <span className="rest-prop-moon" />
              </div>
            )}
          </div>
          <div className="rest-stage-art"><CompanionArtwork companion={settings.petCompanion} outfit={settings.petOutfit} action={artworkAction} animationKey={active.id} motion={settings.petMotion} /></div>
          <span className="rest-companion-caption">{caption}</span>
        </div>
      </div>
      <footer className="rest-away-footer">
        <div className="rest-duration" aria-label={finished ? '休息时间已到' : `本次休息还剩 ${remainingSeconds} 秒`}>
          {finished ? <Check size={22} aria-hidden="true" /> : null}
          <strong>{finished ? '休息完成' : formatRestDuration(remainingSeconds)}</strong>
          <span>{finished ? '准备好再继续' : '已经自动开始'}</span>
        </div>
        <div className="rest-actions-row">
          {finished ? <button type="button" className="rest-primary" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('complete', active.id))}>返回工作</button>
            : <><button type="button" className="rest-snooze" aria-keyshortcuts="Escape" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('snooze', active.id))}>稍后 {settings.snoozeMinutes} 分钟</button>
              <button type="button" className="rest-skip" disabled={action.isPending} onClick={() => void action.run(() => window.eyeProtect.reminderAction('skip', active.id))}>跳过这次</button></>}
        </div>
      </footer>
      <div className="rest-progress" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>
      {action.error ? <p className="rest-error" role="alert">{action.error.message}</p> : null}
    </section>
  </main>;
}
