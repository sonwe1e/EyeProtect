import { SIMPLE_SETTING_LIMITS } from '../../../../shared/types';
import { useEffect, useState } from 'react';
import type { Settings, LegacyData, CommandResult } from '../../../../shared/types';
import { useSettings } from '../../hooks/useSettings';
import { useProjects } from '../../hooks/useProjects';
import { useTasks } from '../../hooks/useTasks';
import { useCommand } from '../../hooks/useCommand';
import { PixelAnimal } from '../characters/PixelAnimal';
import { soundPlayer } from '../../lib/audio';
import { run } from '../../lib/commands';
import {
  Eye,
  Footprints,
  Bell,
  Volume2,
  Moon,
  Monitor,
  FolderOpen,
  Sparkles,
  Download,
  Upload,
  Palette,
  Play,
  Check,
  Shield
} from 'lucide-react';

const toTimeStr = (minOfDay: number): string => {
  const h = String(Math.floor(minOfDay / 60)).padStart(2, '0');
  const m = String(minOfDay % 60).padStart(2, '0');
  return `${h}:${m}`;
};

const fromTimeStr = (timeStr: string, fallback: number): number => {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return fallback;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return Math.min(1439, Math.max(0, h * 60 + m));
};

type SettingStatus = 'idle' | 'saving' | 'saved' | 'error';

function SettingStatusText({ status }: { status: SettingStatus }): JSX.Element | null {
  if (status === 'saving') return <span className="simple-setting-status">保存中…</span>;
  if (status === 'saved') return <span className="simple-setting-status is-ok">已保存</span>;
  if (status === 'error') return <span className="simple-setting-status is-error">保存失败</span>;
  return null;
}

function SettingSwitch({
  checked,
  onChange,
  disabled,
  label,
  status = 'idle'
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  status?: SettingStatus;
}): JSX.Element {
  return (
    <div className="simple-setting-control">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`simple-setting-switch ${checked ? 'is-checked' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="simple-setting-switch-track" aria-hidden="true">
          <span className="simple-setting-switch-handle" />
        </span>
      </button>
      <SettingStatusText status={status} />
    </div>
  );
}

function SettingNumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  status = 'idle',
  onSave
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  status?: SettingStatus;
  onSave: (next: number) => Promise<boolean> | void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = (): void => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped === value) return;
    void Promise.resolve(onSave(clamped)).then((ok) => {
      if (ok === false) setDraft(String(value));
    });
  };
  return (
    <label>
      {label}
      <span className="simple-setting-control">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
        />
        <SettingStatusText status={status} />
      </span>
    </label>
  );
}

export function SimpleSettings(): JSX.Element {
  const { settings, setSettings } = useSettings();
  const projects = useProjects();
  const tasks = useTasks();
  const [legacy, setLegacy] = useState<LegacyData | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const action = useCommand((callback: () => Promise<unknown>) => run(callback));

  useEffect(() => {
    const loadThemes = () => {
    };
    loadThemes();
    window.addEventListener('focus', loadThemes);
    return () => window.removeEventListener('focus', loadThemes);
  }, []);

  const statusFor = (key: string): SettingStatus => {
    if (savingKey === key) return 'saving';
    if (failedKey === key) return 'error';
    if (savedKey === key) return 'saved';
    return 'idle';
  };

  const runBusy = (key: string, start: () => Promise<CommandResult<unknown>>): void => {
    setBusyKey(key);
    setSaveError(null);
    void start()
      .then((result) => {
        if (!result.ok) {
          setSaveError(result.message || '操作失败');
          setFailedKey(key);
          setSavedKey(null);
        }
      })
      .finally(() => setBusyKey((current) => (current === key ? null : current)));
  };

  const save = (key: string, patch: Partial<Settings>): Promise<boolean> => {
    const previous = settings;
    setSavingKey(key);
    setFailedKey(null);
    setSavedKey(null);
    setSaveError(null);
    // Optimistic UI: switches flip immediately; broadcast will confirm or we roll back.
    setSettings({ ...settings, ...patch });
    return run(() => window.eyeProtect.saveSettings(patch))
      .then((result) => {
        if (!result.ok) {
          setSettings(previous);
          setSaveError(result.message || '设置保存失败');
          setFailedKey(key);
          return false;
        }
        setSavedKey(key);
        return true;
      })
      .finally(() => {
        setSavingKey((current) => (current === key ? null : current));
      });
  };

  const number = (
    key: 'eyeIntervalMinutes' | 'walkIntervalMinutes' | 'eyeRestSeconds' | 'walkRestSeconds' | 'petScale',
    label: string,
    min: number,
    max: number,
    step = 1
  ): JSX.Element => (
    <SettingNumberField
      label={label}
      value={settings[key]}
      min={min}
      max={max}
      step={step}
      disabled={savingKey === key}
      status={statusFor(key)}
      onSave={async (next) => {
        const ok = await save(key, { [key]: next });
        return ok;
      }}
    />
  );

  return (
    <div className="simple-settings">
      <h1>设置</h1>
      <p className="simple-settings-subtitle">定制健康护眼节奏、桌面桌宠伙伴与系统偏好</p>

      <nav className="simple-settings-nav" aria-label="设置分区">
        <a href="#settings-rest">休息提醒</a>
        <a href="#settings-appearance">桌面外观</a>
        <a href="#settings-app">应用</a>
      </nav>

      {/* ── Section 1: 休息提醒 ─────────────────────────────────────────── */}
      {saveError ? <p role="alert" className="simple-settings-error">{saveError}</p> : null}
      {action.error ? <p role="alert" className="simple-settings-error">{action.error.message}</p> : null}
      <section id="settings-rest">
        <h2>
          <Eye size={18} />
          休息提醒
        </h2>
        <p className="simple-section-desc">
          按设置定时提醒休息，开始休息后暂停进行中的专注计时。稍后仅推迟当前周期，默认时长可在此自定义。
        </p>

        {/* 护眼短休息卡片 */}
        <div className="simple-setting-card">
          <div className="simple-setting-card-header">
            <div>
              <div className="simple-setting-card-title">
                <Eye size={16} />
                护眼短休息
              </div>
              <p className="simple-setting-card-desc">
                定时提醒远眺 20 秒，舒缓睫状肌张力，缓解视疲劳与干涩
              </p>
            </div>
            <SettingSwitch
              checked={settings.eyeEnabled}
              onChange={(checked) => save('eyeEnabled', { eyeEnabled: checked })}
              disabled={savingKey === 'eyeEnabled'}
              status={statusFor('eyeEnabled')}
              label="开启护眼短休息"
            />
          </div>
          {settings.eyeEnabled && (
            <div className="simple-setting-card-body">
              <div className="simple-field-grid">
                {number('eyeIntervalMinutes', '提醒间隔（分钟）', 1, 240)}
                {number(
                  'eyeRestSeconds',
                  '休息时长（秒）',
                  SIMPLE_SETTING_LIMITS.eyeRestSeconds.min,
                  SIMPLE_SETTING_LIMITS.eyeRestSeconds.max
                )}
              </div>
            </div>
          )}
        </div>

        {/* 走动长休息卡片 */}
        <div className="simple-setting-card">
          <div className="simple-setting-card-header">
            <div>
              <div className="simple-setting-card-title">
                <Footprints size={16} />
                走动长休息
              </div>
              <p className="simple-setting-card-desc">
                起身走动、伸展肩颈腰背，促进血液循环，预防久坐带来的健康隐患
              </p>
            </div>
            <SettingSwitch
              checked={settings.walkEnabled}
              onChange={(checked) => save('walkEnabled', { walkEnabled: checked })}
              disabled={savingKey === 'walkEnabled'}
              status={statusFor('walkEnabled')}
              label="开启走动长休息"
            />
          </div>
          {settings.walkEnabled && (
            <div className="simple-setting-card-body">
              <div className="simple-field-grid">
                {number('walkIntervalMinutes', '提醒间隔（分钟）', 1, 240)}
                {number(
                  'walkRestSeconds',
                  '休息时长（秒）',
                  SIMPLE_SETTING_LIMITS.walkRestSeconds.min,
                  SIMPLE_SETTING_LIMITS.walkRestSeconds.max
                )}
              </div>
            </div>
          )}
        </div>

        {/* 提醒方式与提示音卡片 */}
        <div className="simple-setting-card">
          <div className="simple-setting-card-header">
            <div>
              <div className="simple-setting-card-title">
                <Bell size={16} />
                提醒方式与铃声
              </div>
              <p className="simple-setting-card-desc">
                选择适合工作场景的提醒形式与柔和音效
              </p>
            </div>
          </div>
          <div className="simple-setting-card-body">
            <div className="simple-field-grid">
              <label>
                提醒方式
                <select
                  value={settings.reminderMode}
                  onChange={(e) => save('reminderMode', { reminderMode: e.currentTarget.value as Settings['reminderMode'] })}
                >
                  <option value="focused">沉浸遮罩（全屏暗色覆盖，适合深度休息）</option>
                  <option value="guided">浮窗卡片（屏幕中央温和卡片，适度提醒）</option>
                  <option value="gentle">轻柔气泡（桌宠旁轻盈气泡，不中断工作）</option>
                </select>
              </label>
              <label>
                默认稍后（分钟）
                <select
                  value={settings.snoozeMinutes}
                  onChange={(e) => save('snoozeMinutes', { snoozeMinutes: Number(e.currentTarget.value) })}
                >
                  {[1, 5, 10, 15].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} 分钟
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="simple-setting-row" style={{ marginTop: '8px' }}>
              <div className="simple-setting-row-info">
                <span className="simple-setting-row-title">
                  <Volume2 size={15} />
                  休息提示音效
                </span>
                <span className="simple-setting-row-desc">
                  在休息开始与结束时播放清脆轻柔铃声，便于闭目养神
                </span>
              </div>
              <SettingSwitch
                checked={settings.soundEnabled}
                onChange={(checked) => save('soundEnabled', { soundEnabled: checked })}
                disabled={savingKey === 'soundEnabled'}
                status={statusFor('soundEnabled')}
                label="开启休息提示音效"
              />
            </div>
            <div className="simple-button-row" style={{ marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => soundPlayer.playRestComplete(settings.soundVolume)}
              >
                <Volume2 size={14} style={{ marginRight: '6px' }} />
                试听结束铃声
              </button>
              <button
                type="button"
                disabled={busyKey === 'testReminderEye'}
                onClick={() => runBusy('testReminderEye', () => run(() => window.eyeProtect.testReminder('eye')))}
              >
                <Play size={14} style={{ marginRight: '6px' }} />
                试一下护眼提醒
              </button>
            </div>
          </div>
        </div>

        {/* 免打扰设置卡片 */}
        <div className="simple-setting-card">
          <div className="simple-setting-card-header">
            <div>
              <div className="simple-setting-card-title">
                <Moon size={16} />
                免打扰设置
              </div>
              <p className="simple-setting-card-desc">
                在全屏应用运行或指定安静时段内自动推迟全屏提醒
              </p>
            </div>
          </div>
          <div className="simple-setting-card-body">
            <div className="simple-setting-row">
              <div className="simple-setting-row-info">
                <span className="simple-setting-row-title">全屏应用自动免打扰</span>
                <span className="simple-setting-row-desc">
                  游戏、幻灯片演示或全屏视频播放时，自动推迟休息弹窗
                </span>
              </div>
              <SettingSwitch
                checked={settings.fullscreenDndEnabled}
                onChange={(checked) => save('fullscreenDndEnabled', { fullscreenDndEnabled: checked })}
                disabled={savingKey === 'fullscreenDndEnabled'}
                status={statusFor('fullscreenDndEnabled')}
                label="开启全屏应用自动免打扰"
              />
            </div>
            <div className="simple-setting-row">
              <div className="simple-setting-row-info">
                <span className="simple-setting-row-title">定时免打扰时段</span>
                <span className="simple-setting-row-desc">
                  每日固定时段内保持静默，不弹出全屏休息提醒
                </span>
              </div>
              <SettingSwitch
                checked={settings.quietHoursEnabled}
                onChange={(checked) => save('quietHoursEnabled', { quietHoursEnabled: checked })}
                disabled={savingKey === 'quietHoursEnabled'}
                status={statusFor('quietHoursEnabled')}
                label="开启定时免打扰时段"
              />
            </div>
            {settings.quietHoursEnabled && (
              <div className="simple-field-grid" style={{ marginTop: '12px' }}>
                <label>
                  开始时间
                  <input
                    key={`quiet-start-${settings.quietHoursStartMinutes}`}
                    type="time"
                    defaultValue={toTimeStr(settings.quietHoursStartMinutes)}
                    onBlur={(e) => {
                      const next = fromTimeStr(e.currentTarget.value, settings.quietHoursStartMinutes);
                      if (next !== settings.quietHoursStartMinutes) save('quietHoursStartMinutes', { quietHoursStartMinutes: next });
                    }}
                  />
                </label>
                <label>
                  结束时间
                  <input
                    key={`quiet-end-${settings.quietHoursEndMinutes}`}
                    type="time"
                    defaultValue={toTimeStr(settings.quietHoursEndMinutes)}
                    onBlur={(e) => {
                      const next = fromTimeStr(e.currentTarget.value, settings.quietHoursEndMinutes);
                      if (next !== settings.quietHoursEndMinutes) save('quietHoursEndMinutes', { quietHoursEndMinutes: next });
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Section 2: 桌面外观 ─────────────────────────────────────────── */}
      <section id="settings-appearance">
        <h2>
          <Palette size={18} />
          桌面外观
        </h2>
        <p className="simple-section-desc">
          桌面伙伴是奋斗猫，可替换自定义动图并调节大小与互动细节。
        </p>

        {/* 当前桌宠 */}
        <div className="simple-setting-card">
          <div className="simple-setting-card-header">
            <div>
              <div className="simple-setting-card-title">
                <Sparkles size={16} />
                桌宠
              </div>
              <p className="simple-setting-card-desc">
                只保留奋斗猫；可在下方用自定义动图替换它的动画
              </p>
            </div>
          </div>
          <div className="simple-setting-card-body">
            <div className="simple-pet-grid">
              <div className="simple-pet-card" aria-pressed="true">
                <div className="simple-pet-badge" aria-hidden="true">
                  <Check size={11} strokeWidth={3} />
                </div>
                <div className="simple-pet-preview">
                  <PixelAnimal animal="cat" action="idle" label="奋斗猫" />
                </div>
                <span className="simple-pet-name">奋斗猫</span>
              </div>
            </div>
          </div>
        </div>

        {/* 调节与个性化卡片 */}
        <div className="simple-setting-card">
          <div className="simple-setting-card-header">
            <div>
              <div className="simple-setting-card-title">
                <Palette size={16} />
                个性化调节
              </div>
              <p className="simple-setting-card-desc">
                调整桌宠大小、应用界面主题与互动细节
              </p>
            </div>
          </div>
          <div className="simple-setting-card-body">
            <div className="simple-field-grid">
              {number('petScale', '桌宠大小缩放', 0.5, 1.8, 0.1)}
              <label>
                界面主题
                <select
                  value={settings.theme}
                  onChange={(e) => save('theme', { theme: e.currentTarget.value as Settings['theme'] })}
                >
                  <option value="system">跟随系统</option>
                  <option value="light">浅色模式</option>
                  <option value="dark">深色模式</option>
                </select>
              </label>
            </div>

            <div className="simple-setting-row" style={{ marginTop: '10px' }}>
              <div className="simple-setting-row-info">
                <span className="simple-setting-row-title">桌宠小动作</span>
                <span className="simple-setting-row-desc">
                  待机时偶尔眨眼、伸懒腰（系统开启“减少动态效果”时始终保持静止）
                </span>
              </div>
              <SettingSwitch
                checked={settings.petMotion}
                onChange={(checked) => save('petMotion', { petMotion: checked })}
                disabled={savingKey === 'petMotion'}
                status={statusFor('petMotion')}
                label="开启桌宠小动作"
              />
            </div>

            <div className="simple-button-row" style={{ marginTop: '14px' }}>
              <button
                type="button"
                disabled={busyKey === 'openPetFolder'}
                onClick={() => runBusy('openPetFolder', () => run(() => window.eyeProtect.openCustomPetFolder()))}
              >
                <FolderOpen size={15} style={{ marginRight: '6px' }} />
                打开自定义动图文件夹
              </button>
            </div>

            <details className="simple-custom-guide-details">
              <summary>自定义桌宠动图说明</summary>
              <div className="simple-custom-guide">
                <p>
                  <strong>自定义桌宠动图指南：</strong>
                </p>
                <p>
                  1. <strong>多动作随机互动：</strong>在文件夹中放入 <code>click1.gif</code>、<code>click2.gif</code> 等，点击桌宠时将随机触发不同动作；待机与小动作同样支持 <code>fidget1.gif</code>、<code>idle1.gif</code>。
                </p>
                <p>
                  2. <strong>只替换奋斗猫：</strong>把动图直接放在 <code>custom-pet</code> 根目录即可；产品不再提供其它可切换角色。
                </p>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* ── Section 3: 应用 ─────────────────────────────────────────────── */}
      <section id="settings-app">
        <h2>
          <Monitor size={18} />
          应用
        </h2>
        <p className="simple-section-desc">
          管理开机自启、数据备份导出与恢复。
        </p>

        {/* 系统运行卡片 */}
        <div className="simple-setting-card">
          <div className="simple-setting-row">
            <div className="simple-setting-row-info">
              <span className="simple-setting-row-title">开机自启</span>
              <span className="simple-setting-row-desc">
                登录 Windows 系统后自动在后台运行 EyeProtect
              </span>
            </div>
            <SettingSwitch
              checked={settings.startWithWindows}
              onChange={(checked) => save('startWithWindows', { startWithWindows: checked })}
              disabled={savingKey === 'startWithWindows'}
              status={statusFor('startWithWindows')}
              label="开启开机自启"
            />
          </div>
        </div>

        {/* 备份与数据管理卡片 */}
        <div className="simple-setting-card">
          <div className="simple-setting-card-header">
            <div>
              <div className="simple-setting-card-title">
                <Shield size={16} />
                数据备份与恢复
              </div>
              <p className="simple-setting-card-desc">
                安全导出或导入全部设置、待办清单与提醒历史记录
              </p>
            </div>
          </div>
          <div className="simple-setting-card-body">
            <div className="simple-button-row">
              <button
                type="button"
                disabled={busyKey === 'exportBackup'}
                onClick={() => runBusy('exportBackup', () => run(() => window.eyeProtect.exportBackup()))}
              >
                <Download size={14} style={{ marginRight: '6px' }} />
                导出完整备份
              </button>
              <button
                type="button"
                disabled={busyKey === 'importBackup'}
                onClick={() => runBusy('importBackup', () => run(() => window.eyeProtect.importBackup()))}
              >
                <Upload size={14} style={{ marginRight: '6px' }} />
                恢复备份
              </button>
            </div>

            <details style={{ marginTop: '16px' }}>
              <summary>旧资料与恢复</summary>
              <p className="simple-section-desc" style={{ marginTop: '8px' }}>
                旧规划、自动规则与专注资料仍保留在备份中，自动规则已停用。
              </p>
              {projects
                .filter((p) => p.status === 'completed' || p.status === 'archived')
                .map((p) => (
                  <div className="simple-history-row" key={p.id}>
                    <span>{p.name}</span>
                    <button
                      disabled={action.isPending}
                      onClick={() =>
                        void action.run(() =>
                          window.eyeProtect.updateProject(p.id, { status: 'active' })
                        )
                      }
                    >
                      恢复为清单
                    </button>
                  </div>
                ))}
              {tasks
                .filter((t) => !t.parentId && t.status === 'archived')
                .map((t) => (
                  <div className="simple-history-row" key={t.id}>
                    <span>{t.title}</span>
                    <button
                      disabled={action.isPending}
                      onClick={() => void action.run(() => window.eyeProtect.restoreLegacyTask(t.id))}
                    >
                      恢复任务
                    </button>
                  </div>
                ))}
              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() =>
                    void action.run(async () => {
                      setLegacy(await window.eyeProtect.getLegacyData());
                    })
                  }
                >
                  查看保留的旧资料
                </button>
              </div>
              {legacy ? (
                <div className="simple-legacy-data" style={{ marginTop: '12px' }}>
                  {legacy.sections.map((section) => (
                    <section key={section.title}>
                      <h3>{section.title}</h3>
                      {section.items.map((item, index) => (
                        <p key={index}>
                          <strong>{item.title}</strong>
                          <br />
                          {item.detail}
                        </p>
                      ))}
                      {!section.items.length ? <p>无保留资料</p> : null}
                    </section>
                  ))}
                </div>
              ) : null}
            </details>
          </div>
        </div>
      </section>
    </div>
  );
}
