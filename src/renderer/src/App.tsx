import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Eye, Footprints, Pause, Play, Plus, RotateCcw, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  PET_SKINS,
  SETTINGS_LIMITS,
  type ActiveReminder,
  type Alarm,
  type AlarmRepeat,
  type PetSkin,
  type ReminderKind,
  type ReminderStatus,
  type RuntimeInfo,
  type Settings
} from '../../shared/types';

const DEFAULT_STATUS: ReminderStatus = {
  nextEyeAt: Date.now() + DEFAULT_SETTINGS.eyeIntervalMinutes * 60_000,
  nextWalkAt: Date.now() + DEFAULT_SETTINGS.walkIntervalMinutes * 60_000,
  pausedUntil: null,
  activeReminder: null
};

const ARTWORK_INTERVAL_MS = 2_200;
const eyeArtwork = Array.from({ length: 6 }, (_, index) => `./assets/reminders/eye-${index + 1}.png`);
const walkArtwork = Array.from({ length: 6 }, (_, index) => `./assets/reminders/walk-${index + 1}.png`);

const petArtwork: Record<PetSkin, string> = {
  stable: './assets/pet/pet-stable.png',
  eye: './assets/pet/pet-eye.png',
  fu: './assets/pet/pet-fu.png',
  sleep: './assets/pet/pet-sleep.png'
};

const petSkinLabel: Record<PetSkin, string> = {
  stable: '默认',
  eye: '揉眼',
  fu: '摸肚',
  sleep: '睡觉'
};

const reminderCopy: Record<ReminderKind, { title: string; detail: string; action: string }> = {
  eye: {
    title: '眼睛休息时间',
    detail: '看向远处，眨眨眼，离开屏幕一小会儿。',
    action: '放松眼睛'
  },
  walk: {
    title: '该起来走走',
    detail: '站起来活动肩颈和腿，喝口水也算完成。',
    action: '走动一下'
  },
  combined: {
    title: '休息眼睛，也走一走',
    detail: '这次把护眼和活动合并提醒，一次处理掉。',
    action: '休息一下'
  }
};

const formatClock = (timestamp: number): string => {
  if (!timestamp) {
    return '--:--';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
};

const minutesLeft = (timestamp: number): string => {
  const diff = Math.max(0, timestamp - Date.now());
  return `${Math.ceil(diff / 60_000)} 分钟`;
};

const route = window.location.hash.replace('#', '') || 'pet';

export function App(): JSX.Element {
  return route === 'settings' ? <SettingsView /> : <PetView />;
}

function useAppState() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<ReminderStatus>(DEFAULT_STATUS);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  useEffect(() => {
    let mounted = true;

    void Promise.all([
      window.eyeProtect.getSettings(),
      window.eyeProtect.getReminderStatus(),
      window.eyeProtect.getRuntimeInfo(),
      window.eyeProtect.getAlarms()
    ]).then(([nextSettings, nextStatus, nextRuntime, nextAlarms]) => {
      if (!mounted) {
        return;
      }
      setSettings(nextSettings);
      setStatus(nextStatus);
      setRuntime(nextRuntime);
      setAlarms(nextAlarms);
    });

    const offSettings = window.eyeProtect.onSettingsChanged(setSettings);
    const offReminder = window.eyeProtect.onReminderChanged(setStatus);
    const offAlarms = window.eyeProtect.onAlarmsChanged(setAlarms);
    return () => {
      mounted = false;
      offSettings();
      offReminder();
      offAlarms();
    };
  }, []);

  return { settings, setSettings, status, setStatus, runtime, alarms };
}

function PetView(): JSX.Element {
  const { settings, status, alarms } = useAppState();
  const active = status.activeReminder;
  const copy = active ? reminderCopy[active.kind] : null;
  const alertClass = active ? 'is-alert' : '';
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [firingAlarms, setFiringAlarms] = useState<Alarm[]>([]);

  const handleReminderDoubleClick = useCallback(() => {
    if (active) {
      void window.eyeProtect.reminderAction('complete', active.id);
    }
  }, [active]);
  const handleSkinSelect = useCallback((skin: PetSkin) => {
    void window.eyeProtect.saveSettings({ petSkin: skin });
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const offFired = window.eyeProtect.onAlarmFired((alarm) => {
      setFiringAlarms((current) =>
        current.some((entry) => entry.id === alarm.id) ? current : [...current, alarm]
      );
    });
    return offFired;
  }, []);

  const dismissFiring = useCallback(() => {
    setFiringAlarms([]);
  }, []);

  const isFiring = firingAlarms.length > 0 && !active;
  const shellClass = `pet-shell ${alertClass} ${isFiring ? 'alarms-active' : ''}`;

  return (
    <main className={shellClass} onContextMenu={handleContextMenu}>
      <button className="pet-gear" title="打开设置" onClick={() => void window.eyeProtect.openSettings()}>
        <SettingsIcon size={18} />
      </button>

      {active ? (
        <ReminderArtwork active={active} onDoubleClick={handleReminderDoubleClick} />
      ) : (
        <div className="character-stage">
          <PetCharacter skin={settings.petSkin} onSelect={handleSkinSelect} />
        </div>
      )}

      {isFiring ? (
        <button
          type="button"
          className="alarm-dismiss"
          title="关闭闹钟提醒"
          onClick={dismissFiring}
        >
          <X size={18} />
        </button>
      ) : null}

      {active ? (
        <section className="alert-panel">
          <div className="alert-heading">
            <span className={`kind-badge ${active.kind}`}>{active.kind === 'eye' ? '护眼' : active.kind === 'walk' ? '走动' : '休息'}</span>
            <h1>{copy?.title}</h1>
            <p>{copy?.detail}</p>
          </div>
          <div className="alert-actions">
            <button
              className="primary"
              onClick={() => void window.eyeProtect.reminderAction('complete', active.id)}
            >
              <Check size={18} />
              完成
            </button>
            <button onClick={() => void window.eyeProtect.reminderAction('snooze', active.id)}>
              <Clock3 size={18} />
              稍后
            </button>
            <button onClick={() => void window.eyeProtect.reminderAction('skip', active.id)}>
              <X size={18} />
              跳过
            </button>
          </div>
        </section>
      ) : null}

      {menuOpen ? (
        <AlarmMenu
          alarms={alarms}
          position={menuPos}
          onClose={closeMenu}
          onCancel={(id) => void window.eyeProtect.cancelAlarm(id)}
        />
      ) : null}
    </main>
  );
}

function artworkFor(kind: ReminderKind): string[] {
  if (kind === 'eye') {
    return eyeArtwork;
  }
  if (kind === 'walk') {
    return walkArtwork;
  }
  return [...eyeArtwork, ...walkArtwork];
}

function ReminderArtwork({
  active,
  onDoubleClick
}: {
  active: ActiveReminder;
  onDoubleClick: () => void;
}): JSX.Element {
  const images = useMemo(() => artworkFor(active.kind), [active.kind]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (images.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % images.length);
    }, ARTWORK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [images]);

  const src = images[index] ?? images[0];

  return (
    <div className="reminder-artwork" title="双击完成提醒" onDoubleClick={onDoubleClick}>
      <img src={src} alt={active.kind === 'walk' ? '走动提醒插画' : '护眼提醒插画'} draggable={false} />
    </div>
  );
}

function PetCharacter({ skin, onSelect }: { skin: PetSkin; onSelect: (skin: PetSkin) => void }): JSX.Element {
  return (
    <div className="pet-character" aria-label="EyeProtect 桌宠" title="按住拖动位置">
      <img src={petArtwork[skin]} alt="EyeProtect 桌宠" draggable={false} />
      <SkinPicker current={skin} onSelect={onSelect} />
    </div>
  );
}

function SkinPicker({ current, onSelect }: { current: PetSkin; onSelect: (skin: PetSkin) => void }): JSX.Element {
  return (
    <div className="skin-picker" role="group" aria-label="选择桌宠皮肤">
      {PET_SKINS.map((skin) => (
        <button
          key={skin}
          type="button"
          className="skin-thumb"
          aria-pressed={current === skin}
          title={petSkinLabel[skin]}
          onClick={() => onSelect(skin)}
        >
          <img src={petArtwork[skin]} alt={petSkinLabel[skin]} draggable={false} />
        </button>
      ))}
    </div>
  );
}

function formatAlarmClock(hour: number, minute: number): string {
  const hh = `${hour}`.padStart(2, '0');
  const mm = `${minute}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

function clampAlarm(hour: number, minute: number): { hour: number; minute: number } {
  const h = Math.min(23, Math.max(0, Math.round(hour)));
  const m = Math.min(59, Math.max(0, Math.round(minute)));
  return { hour: h, minute: m };
}

function AlarmMenu({
  alarms,
  position,
  onClose,
  onCancel
}: {
  alarms: Alarm[];
  position: { x: number; y: number };
  onClose: () => void;
  onCancel: (id: string) => void;
}): JSX.Element {
  const [editorOpen, setEditorOpen] = useState(false);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [minute, setMinute] = useState(() => new Date().getMinutes());
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState<AlarmRepeat>('once');

  const submit = useCallback(() => {
    const clamped = clampAlarm(hour, minute);
    void window.eyeProtect.setAlarm({
      hour: clamped.hour,
      minute: clamped.minute,
      label: label.trim() || undefined,
      repeat,
      enabled: true
    });
    setEditorOpen(false);
    setLabel('');
    setRepeat('once');
  }, [hour, minute, label, repeat]);

  return (
    <div className="alarm-menu-backdrop" onClick={onClose}>
      <div
        className="alarm-menu"
        role="dialog"
        aria-label="闹钟"
        style={{ left: position.x, top: position.y }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="alarm-menu-section">
          <span className="alarm-menu-title">已创建的闹钟</span>
          {alarms.length === 0 ? (
            <p className="alarm-menu-empty">还没有闹钟</p>
          ) : (
            <ul className="alarm-list">
              {alarms.map((alarm) => (
                <li key={alarm.id} className="alarm-list-item">
                  <Clock3 size={14} />
                  <span className="alarm-time">{formatAlarmClock(alarm.hour, alarm.minute)}</span>
                  {alarm.label ? <span className="alarm-label">{alarm.label}</span> : null}
                  <span className={`alarm-repeat ${alarm.repeat}`}>
                    {alarm.repeat === 'daily' ? '每天' : '单次'}
                  </span>
                  <button
                    type="button"
                    className="alarm-remove"
                    title="删除闹钟"
                    onClick={() => onCancel(alarm.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="alarm-menu-section">
          {editorOpen ? (
            <div className="alarm-editor">
              <span className="alarm-menu-title">新建闹钟</span>
              <div className="alarm-time-inputs">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(event) => setHour(Number(event.currentTarget.value))}
                  aria-label="小时"
                />
                <span className="alarm-time-sep">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(event) => setMinute(Number(event.currentTarget.value))}
                  aria-label="分钟"
                />
              </div>
              <input
                className="alarm-label-input"
                type="text"
                placeholder="标签（可选）"
                value={label}
                maxLength={20}
                onChange={(event) => setLabel(event.currentTarget.value)}
              />
              <div className="alarm-repeat-toggle">
                <button
                  type="button"
                  className={repeat === 'once' ? 'is-active' : ''}
                  onClick={() => setRepeat('once')}
                >
                  单次
                </button>
                <button
                  type="button"
                  className={repeat === 'daily' ? 'is-active' : ''}
                  onClick={() => setRepeat('daily')}
                >
                  每天
                </button>
              </div>
              <div className="alarm-editor-actions">
                <button type="button" className="primary" onClick={submit}>
                  确定
                </button>
                <button type="button" onClick={() => setEditorOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="alarm-add" onClick={() => setEditorOpen(true)}>
              <Plus size={14} />
              新建闹钟
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsView(): JSX.Element {
  const { settings, setSettings, status, runtime } = useAppState();
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      setSaving(true);
      const next = await window.eyeProtect.saveSettings(patch);
      setSettings(next);
      setSaving(false);
      setSavedAt(Date.now());
    },
    [setSettings]
  );

  const nextItems = useMemo(
    () => [
      { label: '下次护眼', value: formatClock(status.nextEyeAt), sub: minutesLeft(status.nextEyeAt), icon: <Eye size={20} /> },
      {
        label: '下次走动',
        value: formatClock(status.nextWalkAt),
        sub: minutesLeft(status.nextWalkAt),
        icon: <Footprints size={20} />
      }
    ],
    [status.nextEyeAt, status.nextWalkAt]
  );

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <span className="eyebrow">EyeProtect</span>
          <h1>提醒设置</h1>
        </div>
        <button className="icon-button" title="关闭设置" onClick={() => void window.eyeProtect.closeSettings()}>
          <X size={20} />
        </button>
      </header>

      <section className="status-strip">
        {nextItems.map((item) => (
          <div className="status-item" key={item.label}>
            {item.icon}
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.sub}</small>
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h2>提醒间隔</h2>
        <NumberField
          label="护眼提醒"
          value={settings.eyeIntervalMinutes}
          min={SETTINGS_LIMITS.eyeIntervalMinutes.min}
          max={SETTINGS_LIMITS.eyeIntervalMinutes.max}
          suffix="分钟"
          icon={<Eye size={18} />}
          onCommit={(value) => void update({ eyeIntervalMinutes: value })}
        />
        <NumberField
          label="走动提醒"
          value={settings.walkIntervalMinutes}
          min={SETTINGS_LIMITS.walkIntervalMinutes.min}
          max={SETTINGS_LIMITS.walkIntervalMinutes.max}
          suffix="分钟"
          icon={<Footprints size={18} />}
          onCommit={(value) => void update({ walkIntervalMinutes: value })}
        />
        <NumberField
          label="稍后提醒"
          value={settings.snoozeMinutes}
          min={SETTINGS_LIMITS.snoozeMinutes.min}
          max={SETTINGS_LIMITS.snoozeMinutes.max}
          suffix="分钟"
          icon={<Clock3 size={18} />}
          onCommit={(value) => void update({ snoozeMinutes: value })}
        />
      </section>

      <section className="settings-section">
        <h2>桌宠</h2>
        <NumberField
          label="桌宠缩放"
          value={Math.round(settings.petScale * 100)}
          min={Math.round(SETTINGS_LIMITS.petScale.min * 100)}
          max={Math.round(SETTINGS_LIMITS.petScale.max * 100)}
          suffix="%"
          icon={<RotateCcw size={18} />}
          onCommit={(value) => void update({ petScale: value / 100 })}
        />
        <label className="switch-row">
          <span>
            <strong>提醒时置黑桌面</strong>
            <small>触发护眼/走动提醒时把其他界面全部置黑，只留提醒卡片</small>
          </span>
          <input
            type="checkbox"
            checked={settings.dimDesktop}
            onChange={(event) => void update({ dimDesktop: event.currentTarget.checked })}
          />
        </label>
        <label className="switch-row">
          <span>
            <strong>开机自启</strong>
            <small>便携版会在当前 exe 位置创建启动快捷方式</small>
          </span>
          <input
            type="checkbox"
            checked={settings.startWithWindows}
            onChange={(event) => void update({ startWithWindows: event.currentTarget.checked })}
          />
        </label>
      </section>

      <section className="settings-section compact">
        <h2>手动测试</h2>
        <div className="test-actions">
          <button onClick={() => void window.eyeProtect.testReminder('eye')}>
            <Eye size={18} />
            护眼提醒
          </button>
          <button onClick={() => void window.eyeProtect.testReminder('walk')}>
            <Footprints size={18} />
            走动提醒
          </button>
          <button onClick={() => void window.eyeProtect.pause(60)}>
            <Pause size={18} />
            暂停 1 小时
          </button>
          <button onClick={() => void window.eyeProtect.pause(1)}>
            <Play size={18} />
            暂停 1 分钟
          </button>
        </div>
      </section>

      <footer className="settings-footer">
        <span>{saving ? '保存中...' : savedAt ? `已保存 ${formatClock(savedAt)}` : '设置会自动保存'}</span>
        <span>{runtime?.riveAvailable ? 'Rive 角色已加载' : '使用内置占位角色'}</span>
      </footer>
    </main>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  icon,
  onCommit
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  icon: JSX.Element;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(draft);
    const next = Math.round(Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : value)));
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <label className="number-row">
      <span className="number-label">
        {icon}
        <strong>{label}</strong>
      </span>
      <span className="number-control">
        <input
          value={draft}
          inputMode="numeric"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <small>{suffix}</small>
      </span>
    </label>
  );
}
