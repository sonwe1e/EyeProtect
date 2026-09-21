import { useEffect, useRef, useState } from 'react';
import { Award, Check, Sparkles, Target, Volume2, VolumeX, Wind } from 'lucide-react';
import { useClock } from '../hooks/useClock';
import { useCommand } from '../hooks/useCommand';
import { usePomodoro } from '../hooks/usePomodoro';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';
import { getActivity } from '../../../shared/breakActivities';
import { PIXEL_ANIMAL_NAMES } from '../../../shared/pixelAnimals';
import type { BreakActivity, CustomPetAssets } from '../../../shared/types';
import { run } from '../lib/commands';
import { soundPlayer } from '../lib/audio';
import { PixelAnimal } from '../features/characters/PixelAnimal';
import {
  formatRestDuration,
  getActivityProgress,
  restAnimalAction,
  restCountdown,
  restKindCopy,
  restLede,
  restPhase
} from '../features/reminders/restViewModel';

const RING_RADIUS = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const COMPANION_QUOTES = [
  '让眼睛眺望窗外 20 米的远方，寻找一抹绿色吧~',
  '深呼吸一口气，把肩颈和眼周的疲惫全部呼出去。',
  '闭上双眼养养神，猫猫正在身旁陪你一起打盹呢~',
  '起身走动倒杯水，让血液活动活动全身筋骨。',
  '眨眨眼睛润润眼，视线暂时离开屏幕片刻。'
];

type RelaxMode = 'follow' | 'breathe' | 'pet';
const RELAX_MODES: RelaxMode[] = ['follow', 'breathe', 'pet'];

export default function AlertView(): JSX.Element {
  const { activeReminder: active } = useReminderStatus();
  const now = useClock(1000);
  const pomodoro = usePomodoro();
  const { settings } = useSettings();
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));

  // Default to random interactive mode on mount
  const [relaxMode, setRelaxMode] = useState<RelaxMode>(() => {
    return RELAX_MODES[Math.floor(Math.random() * RELAX_MODES.length)];
  });
  const activeReminderIdRef = useRef<string | null>(null);

  // Randomize interactive mode whenever a new reminder fires
  useEffect(() => {
    if (active?.id && active.id !== activeReminderIdRef.current) {
      activeReminderIdRef.current = active.id;
      const random = RELAX_MODES[Math.floor(Math.random() * RELAX_MODES.length)];
      setRelaxMode(random);
    }
  }, [active?.id]);

  const [customAssets, setCustomAssets] = useState<CustomPetAssets | null>(null);
  const [quote] = useState(() => COMPANION_QUOTES[Math.floor(Math.random() * COMPANION_QUOTES.length)]);

  useEffect(() => {
    void window.eyeProtect.getCustomPetAssets(settings.customPetTheme).then(setCustomAssets);
  }, [settings.customPetTheme, settings.petAppearance]);

  const phase = active ? restPhase(active, now) : 'ready';
  const started = phase !== 'ready';
  const { remainingSeconds, totalSeconds, progress } = active
    ? restCountdown(active, now, settings)
    : { remainingSeconds: 0, totalSeconds: 0, progress: 0 };
  const playedStartRef = useRef<string | null>(null);
  const playedCompleteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    if (settings.soundEnabled && playedStartRef.current !== active.id) {
      playedStartRef.current = active.id;
      soundPlayer.playRestStart(settings.soundVolume);
    }
  }, [active?.id, settings.soundEnabled, settings.soundVolume]);

  useEffect(() => {
    if (!active) return;
    if (started && phase === 'finished' && playedCompleteRef.current !== active.id) {
      playedCompleteRef.current = active.id;
      if (settings.soundEnabled) {
        soundPlayer.playRestComplete(settings.soundVolume);
      }
    }
  }, [active?.id, started, phase, settings.soundEnabled, settings.soundVolume]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (action.isPending) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!started) {
          void action.run(() => window.eyeProtect.beginHealthRest(active.id));
        } else if (remainingSeconds <= 0) {
          void action.run(() => window.eyeProtect.reminderAction('complete', active.id));
        }
      } else if (e.code === 'Escape') {
        e.preventDefault();
        void action.run(() => window.eyeProtect.reminderAction('snooze', active.id));
      } else if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        void action.run(() => window.eyeProtect.reminderAction('skip', active.id));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [action, active, started, remainingSeconds]);

  if (!active) return <main className="alert-shell" />;

  const copy = restKindCopy(active.kind);
  const activities = active.activityIds
    .map(getActivity)
    .filter((activity): activity is BreakActivity => activity !== null);
  const animal = settings.petAppearance;
  const animalName = PIXEL_ANIMAL_NAMES[animal];
  const mergedWithPomodoro =
    pomodoro.phase === 'focus-finished' || pomodoro.phase === 'break';
  const restStartedAt = typeof active.restStartedAt === 'number' ? active.restStartedAt : now;

  const activityStates = activities.map((activity) => ({
    activity,
    step: getActivityProgress(activity, restStartedAt, now)
  }));
  const incompleteIndex = activityStates.findIndex((entry) => !entry.step.complete);
  const currentIndex = incompleteIndex === -1 ? Math.max(0, activityStates.length - 1) : incompleteIndex;
  const current = activityStates[currentIndex];
  const upcoming = activityStates[currentIndex + 1];
  const showSteps = started && Boolean(current);
  const lede = restLede(phase, remainingSeconds, { mergedWithPomodoro });
  const hint = !started
    ? `本次休息 ${totalSeconds} 秒`
    : phase === 'finished'
      ? '已到时间，可以完成本次休息。'
      : `还剩 ${remainingSeconds} 秒 · 提前完成不会被记录`;

  // 12-second breath cycle: Inhale 4s, Hold 4s, Exhale 4s
  const breathCycleSeconds = 12;
  const breathTime = Math.floor(now / 1000) % breathCycleSeconds;
  let breathState = {
    action: '吸气',
    count: 4 - (breathTime % 4),
    prompt: '深深吸气 · 挺直腰背',
    scale: 1.15
  };
  if (breathTime < 4) {
    breathState = {
      action: '吸气',
      count: 4 - breathTime,
      prompt: '深深吸气 · 挺直腰背',
      scale: 0.94 + (breathTime / 4) * 0.22
    };
  } else if (breathTime < 8) {
    breathState = {
      action: '屏息',
      count: 8 - breathTime,
      prompt: '微闭双眼 · 屏息放松',
      scale: 1.16
    };
  } else {
    const exhaleProgress = (breathTime - 8) / 4;
    breathState = {
      action: '呼气',
      count: 12 - breathTime,
      prompt: '徐徐呼气 · 放下双肩',
      scale: 1.16 - exhaleProgress * 0.22
    };
  }

  const restCustomSrc =
    customAssets?.hasCustomPet &&
    (customAssets.sleeps[0] ??
      customAssets.fidgets[0] ??
      customAssets.idles[0] ??
      customAssets.clicks[0] ??
      null);

  return (
    <main className={`alert-shell simple-rest kind-${active.kind}`}>
      <section className={`rest-card${showSteps ? ' has-steps' : ''}`} aria-labelledby="rest-title">
        {/* Ambient background glows */}
        <div className="rest-ambient" aria-hidden="true">
          <span className="rest-orb is-1" />
          <span className="rest-orb is-2" />
        </div>

        {/* Top bar with Badge, Mode Selector, and Sound Toggle */}
        <header className="rest-topbar">
          <div className="rest-topbar-left">
            <span className="rest-badge">{copy.badge}</span>
            {mergedWithPomodoro ? (
              <span className="rest-pomo-tag">番茄钟休息同步</span>
            ) : null}
            {active.snoozeCount > 0 ? (
              <span className="rest-snooze-count-badge">已稍后 {active.snoozeCount} 次</span>
            ) : null}
          </div>

          <div className="rest-mode-bar" role="tablist" aria-label="放松互动模式切换">
            <button
              type="button"
              role="tab"
              aria-selected={relaxMode === 'follow'}
              className={`rest-mode-btn ${relaxMode === 'follow' ? 'is-active' : ''}`}
              onClick={() => setRelaxMode('follow')}
              title="视线光球：眼神轻柔跟随小光球平滑运转，放松眼周睫状肌"
            >
              <Target size={14} aria-hidden="true" />
              <span>视线光球</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={relaxMode === 'breathe'}
              className={`rest-mode-btn ${relaxMode === 'breathe' ? 'is-active' : ''}`}
              onClick={() => setRelaxMode('breathe')}
              title="正念呼吸：跟随舒缓光环节奏深吸慢呼，缓解身心疲劳"
            >
              <Wind size={14} aria-hidden="true" />
              <span>正念深呼吸</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={relaxMode === 'pet'}
              className={`rest-mode-btn ${relaxMode === 'pet' ? 'is-active' : ''}`}
              onClick={() => setRelaxMode('pet')}
              title="萌宠小憩：桌面萌宠静谧陪伴，享受片刻闭目养神"
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>萌宠小憩</span>
            </button>
          </div>

          <div className="rest-topbar-right">
            <button
              className="rest-sound-toggle"
              aria-label={settings.soundEnabled ? '静音提示音' : '开启提示音'}
              title={settings.soundEnabled ? '提示音已开启（点击静音）' : '提示音已静音（点击开启）'}
              onClick={() => void window.eyeProtect.saveSettings({ soundEnabled: !settings.soundEnabled })}
            >
              {settings.soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
        </header>

        {/* Spacious 2-Column Main Theater Body */}
        <div className="rest-body-layout">
          {/* Left Column: Visual & Interactive Relax Stage */}
          <div className="rest-stage-column">
            <div className="rest-stage">
              <span className="rest-stage-glow" aria-hidden="true" />

              {/* Progress & Countdown Ring */}
              <svg className="rest-ring" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
                <circle className="rest-ring-track" cx="100" cy="100" r={RING_RADIUS} />
                <circle
                  className="rest-ring-value"
                  cx="100"
                  cy="100"
                  r={RING_RADIUS}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
                />
              </svg>

              {/* Mode 1: Follow Orb Interactive Orbit */}
              {relaxMode === 'follow' && started && phase === 'resting' ? (
                <div className="rest-follow-track" aria-hidden="true">
                  <svg className="rest-follow-svg-guide" viewBox="-150 -75 300 150">
                    <path
                      d="M 0 0 C 45 -48, 120 -48, 120 0 C 120 48, 45 48, 0 0 C -45 -48, -120 -48, -120 0 C -120 48, -45 48, 0 0 Z"
                      fill="none"
                    />
                  </svg>
                  <div className="rest-follow-orb" title="眼神跟随金色星芒转动">
                    <Sparkles size={16} />
                  </div>
                </div>
              ) : null}

              {/* Mode 2: Deep Breath Pulsing Halos */}
              {relaxMode === 'breathe' && started && phase === 'resting' ? (
                <>
                  <div
                    className="rest-breathe-outer-halo"
                    aria-hidden="true"
                    style={{ transform: `scale(${breathState.scale * 1.12})` }}
                  />
                  <div
                    className="rest-breathe-halo"
                    aria-hidden="true"
                    style={{ transform: `scale(${breathState.scale})` }}
                  />
                </>
              ) : null}

              {/* Mode 3: Pet Sleep Floating Bubbles */}
              {relaxMode === 'pet' ? (
                <div className="rest-pet-sleep-decor" aria-hidden="true">
                  <span className="rest-zzz is-1">Z</span>
                  <span className="rest-zzz is-2">z</span>
                  <span className="rest-zzz is-3">z</span>
                </div>
              ) : null}

              {/* Center Companion Artwork */}
              <div className="rest-stage-art">
                {restCustomSrc ? (
                  <img
                    src={restCustomSrc}
                    alt="桌宠休息中"
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      imageRendering: 'pixelated',
                      pointerEvents: 'none'
                    }}
                  />
                ) : (
                  <PixelAnimal
                    animal={animal}
                    action={restAnimalAction(active.kind, phase)}
                    label={`${copy.badge} · ${animalName}`}
                  />
                )}
              </div>

              {/* Stage timer readout pill */}
              <p className="rest-stage-count" role="timer" aria-live="off" aria-label="休息剩余时间">
                {relaxMode === 'breathe' && started && phase === 'resting' ? (
                  <>
                    <strong>{breathState.action} {breathState.count}s</strong>
                    <small>余 {formatRestDuration(remainingSeconds)}</small>
                  </>
                ) : (
                  <>
                    <strong>{formatRestDuration(remainingSeconds)}</strong>
                    <small>{phase === 'finished' ? '已到时间' : phase === 'resting' ? '剩余时长' : '计划休息'}</small>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Right Column: Info, Guidance, Steps & Actions */}
          <div className="rest-info-column">
            <div className="rest-info-header">
              <h1 id="rest-title" className="rest-title">{copy.title}</h1>
              <p className="rest-lede">{lede}</p>
            </div>

            {/* Interactive Guidance Card */}
            <div className="rest-guide-card">
              <div className="rest-guide-icon">
                {relaxMode === 'follow' ? (
                  <Target size={18} aria-hidden="true" />
                ) : relaxMode === 'breathe' ? (
                  <Wind size={18} aria-hidden="true" />
                ) : (
                  <Sparkles size={18} aria-hidden="true" />
                )}
              </div>
              <div className="rest-guide-content">
                <div className="rest-guide-title">
                  {relaxMode === 'follow'
                    ? '眼球协调跟随操'
                    : relaxMode === 'breathe'
                      ? `${breathState.action} · ${breathState.prompt}`
                      : '萌宠温馨陪伴'}
                </div>
                <div className="rest-guide-desc">
                  {relaxMode === 'follow'
                    ? '请端坐并保持头部静止，仅用眼神跟随金色星芒做平缓轨迹移动，舒缓眼外肌与睫状肌。'
                    : relaxMode === 'breathe'
                      ? '随光环的节律调匀气息，深吸 4 秒、屏息 4 秒、慢呼 4 秒，卸下一身疲惫。'
                      : quote}
                </div>
              </div>
            </div>

            {/* Finished Celebration Stamp */}
            {phase === 'finished' ? (
              <div className="rest-celebration-stamp">
                <Award size={16} aria-hidden="true" />
                <span>本次健康休息已达成！双眼与身心已恢复活力</span>
              </div>
            ) : null}

            {/* Step list if micro-break activities exist */}
            {showSteps && current ? (
              <section className="rest-activity">
                <p className="rest-activity-head">
                  <strong>{current.activity.title}</strong>
                  <span>{current.step.complete ? '建议时长已完成' : `第 ${current.step.stepIndex + 1}/${current.activity.steps.length} 步`}</span>
                </p>
                <ol className="rest-steps">
                  {current.activity.steps.map((text, index) => (
                    <li
                      key={`${current.activity.id}-${index}`}
                      className={`rest-step ${index < current.step.stepIndex ? 'is-done' : index === current.step.stepIndex ? 'is-active' : ''}`.trim()}
                    >
                      <b aria-hidden="true">{index < current.step.stepIndex ? <Check size={12} /> : index + 1}</b>
                      <span>{text}</span>
                    </li>
                  ))}
                </ol>
                <div className="rest-progress" aria-hidden="true">
                  <i style={{ width: `${Math.round(current.step.progress * 100)}%` }} />
                </div>
                {upcoming ? <p className="rest-next">接下来：{upcoming.activity.title}</p> : null}
              </section>
            ) : null}

            {/* Break task if attached */}
            {active.breakTask ? (
              <p className="rest-break-task">顺便处理：{active.breakTask.title}</p>
            ) : null}

            {/* Action buttons & keyboard shortcuts */}
            <div className="rest-actions">
              {!started ? (
                <button
                  className="rest-primary"
                  data-shortcut="Space"
                  aria-keyshortcuts="Space"
                  disabled={action.isPending}
                  onClick={() => void action.run(() => window.eyeProtect.beginHealthRest(active.id))}
                >
                  开始休息
                </button>
              ) : phase === 'finished' ? (
                <button
                  className="rest-primary is-celebrate"
                  data-shortcut="Space"
                  aria-keyshortcuts="Space"
                  disabled={action.isPending}
                  onClick={() => void action.run(() => window.eyeProtect.reminderAction('complete', active.id))}
                >
                  <Award size={16} style={{ marginRight: '6px', verticalAlign: '-2px' }} />
                  完成休息打卡
                </button>
              ) : (
                <button className="rest-primary" disabled={true}>
                  完成休息（还剩 {remainingSeconds} 秒）
                </button>
              )}

              <div className="rest-actions-row">
                <div className="rest-snooze-group">
                  <button
                    data-shortcut="Esc"
                    aria-keyshortcuts="Escape"
                    disabled={action.isPending}
                    title={`这次稍后 ${settings.snoozeMinutes} 分钟`}
                    onClick={() => void action.run(() => window.eyeProtect.reminderAction('snooze', active.id))}
                  >
                    稍后 {settings.snoozeMinutes} 分钟
                  </button>
                </div>
                <button
                  className="rest-skip"
                  data-shortcut="S"
                  aria-keyshortcuts="S"
                  disabled={action.isPending}
                  onClick={() => void action.run(() => window.eyeProtect.reminderAction('skip', active.id))}
                >
                  跳过
                </button>
              </div>

              <p className="rest-hint">{hint} · [空格] 开始/完成 · [Esc] 稍后 · [S] 跳过</p>
              {action.error ? <p className="rest-error" role="alert">{action.error.message}</p> : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
