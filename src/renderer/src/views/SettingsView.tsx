import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock3,
  Eye,
  Footprints,
  Pause,
  Play,
  RotateCcw,
  X
} from 'lucide-react';
import {
  SETTINGS_LIMITS,
  type RuntimeInfo,
  type Settings
} from '../../../shared/types';
import { NumberField } from '../components/NumberField';
import { useClock } from '../hooks/useClock';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';
import { formatClock, minutesLeft } from '../lib/time';

export default function SettingsView(): JSX.Element {
  const { settings, setSettings } = useSettings();
  const status = useReminderStatus();
  const now = useClock(30_000);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getRuntimeInfo().then((next) => {
      if (mounted) {
        setRuntime(next);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      setSaving(true);
      try {
        const next = await window.eyeProtect.saveSettings(patch);
        setSettings(next);
        setSavedAt(Date.now());
      } finally {
        setSaving(false);
      }
    },
    [setSettings]
  );

  const nextItems = useMemo(
    () => [
      {
        label: '下次护眼',
        value: formatClock(status.nextEyeAt),
        sub: minutesLeft(status.nextEyeAt, now),
        icon: <Eye size={20} />
      },
      {
        label: '下次走动',
        value: formatClock(status.nextWalkAt),
        sub: minutesLeft(status.nextWalkAt, now),
        icon: <Footprints size={20} />
      }
    ],
    [now, status.nextEyeAt, status.nextWalkAt]
  );

  const paused = status.pausedUntil !== null && status.pausedUntil > now;

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <span className="eyebrow">EyeProtect</span>
          <h1>提醒设置</h1>
        </div>
        <button
          className="icon-button"
          title="关闭设置"
          onClick={() => void window.eyeProtect.closeSettings()}
        >
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
            <small>触发护眼或走动提醒时暗化其他界面，只保留提醒卡片。</small>
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
            <small>便携版会在当前 exe 位置创建启动快捷方式。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.startWithWindows}
            onChange={(event) => void update({ startWithWindows: event.currentTarget.checked })}
          />
        </label>
      </section>

      <section className="settings-section compact">
        <h2>提醒控制</h2>
        <div className="test-actions">
          <button onClick={() => void window.eyeProtect.testReminder('eye')}>
            <Eye size={18} />
            护眼提醒
          </button>
          <button onClick={() => void window.eyeProtect.testReminder('walk')}>
            <Footprints size={18} />
            走动提醒
          </button>
          {paused ? (
            <>
              <button onClick={() => void window.eyeProtect.resume()}>
                <Play size={18} />
                恢复提醒
              </button>
              <button onClick={() => void window.eyeProtect.restartCycle()}>
                <RotateCcw size={18} />
                重新开始计时
              </button>
            </>
          ) : (
            <button onClick={() => void window.eyeProtect.pause(60)}>
              <Pause size={18} />
              暂停 1 小时
            </button>
          )}
        </div>
      </section>

      <footer className="settings-footer">
        <span>{saving ? '保存中...' : savedAt ? `已保存 ${formatClock(savedAt)}` : '设置会自动保存'}</span>
        <span>{runtime ? `v${runtime.appVersion} · 数据保存在本机` : '正在读取运行信息...'}</span>
      </footer>
    </main>
  );
}
