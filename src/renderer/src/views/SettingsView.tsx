import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BrainCircuit,
  Clock3,
  Compass,
  DatabaseBackup,
  Download,
  Eye,
  Feather,
  Footprints,
  FolderOpen,
  Keyboard,
  MonitorUp,
  MoonStar,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Undo2,
  Upload,
  X
} from 'lucide-react';
import {
  SETTINGS_LIMITS,
  type DataActionResult,
  type DataRecoveryInfo,
  type HotkeyAction,
  type HotkeyStatus,
  type ReminderMode,
  type RuntimeInfo,
  type Settings
} from '../../../shared/types';
import { NumberField } from '../components/NumberField';
import { useClock } from '../hooks/useClock';
import { useCareStatus } from '../hooks/useCareStatus';
import { useReminderStatus } from '../hooks/useReminderStatus';
import { useSettings } from '../hooks/useSettings';
import { useWeeklyReport } from '../hooks/useWeeklyReport';
import { formatClock, minutesLeft } from '../lib/time';

const REMINDER_MODE_COPY: Array<{
  value: ReminderMode;
  title: string;
  desc: string;
  icon: JSX.Element;
}> = [
  {
    value: 'gentle',
    title: '温和',
    desc: '桌宠气泡轻提醒，不暗化桌面，所有操作立即可用。',
    icon: <Feather size={18} />
  },
  {
    value: 'guided',
    title: '引导',
    desc: '弹出提醒卡片和休息建议，随时可以提前完成。',
    icon: <Compass size={18} />
  },
  {
    value: 'focused',
    title: '专注',
    desc: '暗化桌面并稍作等待，确保你真的停下来休息。',
    icon: <ShieldCheck size={18} />
  }
];

const HOTKEY_COPY: Array<{ action: HotkeyAction; label: string; keys: string }> = [
  { action: 'break-now', label: '立即休息', keys: 'Ctrl + Alt + B' },
  { action: 'pause-toggle', label: '暂停 / 恢复', keys: 'Ctrl + Alt + P' },
  { action: 'todo-add', label: '快速添加待办', keys: 'Ctrl + Alt + A' },
  { action: 'todos', label: '打开待办', keys: 'Ctrl + Alt + T' },
  { action: 'pet-toggle', label: '隐藏 / 显示桌宠', keys: 'Ctrl + Alt + H' }
];

const timeValue = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const parseTimeValue = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
};

const minutesUntilNextHour = (now: number): number => {
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now) / 60_000));
};

const minutesUntilMidnight = (now: number): number => {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - now) / 60_000));
};

const minutesUntilClockTime = (value: string, now: number): number => {
  const minuteOfDay = parseTimeValue(value);
  if (minuteOfDay === null) {
    return 1;
  }
  const target = new Date(now);
  target.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  if (target.getTime() <= now) {
    target.setDate(target.getDate() + 1);
  }
  return Math.max(1, Math.ceil((target.getTime() - now) / 60_000));
};

export default function SettingsView({ embedded = false }: { embedded?: boolean }): JSX.Element {
  const { settings, setSettings } = useSettings();
  const status = useReminderStatus();
  const care = useCareStatus();
  const report = useWeeklyReport();
  const now = useClock(30_000);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [quietAppsDraft, setQuietAppsDraft] = useState('');
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus>({
    enabled: false,
    registered: [],
    conflicts: []
  });
  const [recoveryInfo, setRecoveryInfo] = useState<DataRecoveryInfo | null>(null);
  const [dataMessage, setDataMessage] = useState('');
  const [customPauseMinutes, setCustomPauseMinutes] = useState(45);
  const [meetingEndTime, setMeetingEndTime] = useState(() => {
    const date = new Date(Date.now() + 30 * 60_000);
    return timeValue(date.getHours() * 60 + date.getMinutes());
  });

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

  useEffect(() => {
    void window.eyeProtect.getDataRecoveryInfo().then(setRecoveryInfo);
  }, []);

  useEffect(() => {
    let mounted = true;
    void window.eyeProtect.getHotkeyStatus().then((status) => {
      if (mounted) {
        setHotkeyStatus(status);
      }
    });
    const off = window.eyeProtect.onHotkeyStatusChanged(setHotkeyStatus);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  useEffect(() => {
    setQuietAppsDraft(settings.quietAppWhitelist.join(', '));
  }, [settings.quietAppWhitelist]);

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
  const completionPercent = report
    ? Math.round(report.current.completionRate * 100)
    : 0;
  const completedComparison = report
    ? report.completedDelta > 0
      ? `比上周多 ${report.completedDelta} 次`
      : report.completedDelta < 0
        ? `比上周少 ${Math.abs(report.completedDelta)} 次`
        : '与上周持平'
    : '正在统计';
  const adaptiveActive =
    settings.adaptiveEnabled &&
    settings.historyEnabled &&
    report !== null;
  const adaptiveChanged =
    adaptiveActive &&
    (report.recommendedEyeMinutes !== settings.eyeIntervalMinutes ||
      report.recommendedWalkMinutes !== settings.walkIntervalMinutes);

  const runDataAction = useCallback(
    async (action: () => Promise<DataActionResult>) => {
      const result = await action();
      setDataMessage(result.message);
      if (result.success) {
        setRecoveryInfo(await window.eyeProtect.getDataRecoveryInfo());
      }
    },
    []
  );

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <span className="eyebrow">EyeProtect</span>
          <h1>提醒设置</h1>
        </div>
        {!embedded ? (
          <button
            className="icon-button"
            title="关闭设置"
            onClick={() => void window.eyeProtect.closeSettings()}
          >
            <X size={20} />
          </button>
        ) : null}
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

      {status.contextDeferral && status.contextDeferral.until > now ? (
        <div className="context-deferral-banner" role="status">
          <ShieldCheck size={17} />
          <span>
            <strong>本次提醒已推迟到 {formatClock(status.contextDeferral.until)}</strong>
            <small>
              {status.contextDeferral.reason} · 连续第 {status.contextDeferral.consecutiveCount} 次，
              最多自动推迟 3 次
            </small>
          </span>
          <button onClick={() => void window.eyeProtect.triggerNow()}>现在休息</button>
        </div>
      ) : null}

      <section className="settings-section">
        <h2>提醒模式</h2>
        <div className="mode-cards" role="radiogroup" aria-label="提醒模式">
          {REMINDER_MODE_COPY.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={settings.reminderMode === mode.value}
              className={settings.reminderMode === mode.value ? 'mode-card selected' : 'mode-card'}
              onClick={() => void update({ reminderMode: mode.value })}
            >
              {mode.icon}
              <strong>{mode.title}</strong>
              <small>{mode.desc}</small>
            </button>
          ))}
        </div>
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
        <NumberField
          label="提前预告"
          value={settings.preAlertSeconds}
          min={SETTINGS_LIMITS.preAlertSeconds.min}
          max={SETTINGS_LIMITS.preAlertSeconds.max}
          suffix="秒"
          icon={<Timer size={18} />}
          onCommit={(value) => void update({ preAlertSeconds: value })}
        />
      </section>

      <section className="settings-section smart-section">
        <div className="section-heading-row">
          <div>
            <h2>智能节奏与免打扰</h2>
            <small>只在提醒到期时检查一次前台场景，不持续监听窗口。</small>
          </div>
          <BrainCircuit size={20} />
        </div>

        <label className="switch-row">
          <span>
            <strong>自适应提醒间隔</strong>
            <small>
              根据本机近一周行为调整下一周期，始终限制在基准值的 ±20% 内。
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.adaptiveEnabled}
            disabled={!settings.historyEnabled}
            onChange={(event) => void update({ adaptiveEnabled: event.currentTarget.checked })}
          />
        </label>
        <div className={adaptiveActive ? 'adaptive-card active' : 'adaptive-card'}>
          <BrainCircuit size={18} />
          <div>
            <strong>
              {adaptiveActive
                ? `当前节奏：护眼 ${report.recommendedEyeMinutes} 分钟 · 走动 ${report.recommendedWalkMinutes} 分钟 · ${
                    REMINDER_MODE_COPY.find((mode) => mode.value === report.recommendedMode)?.title ??
                    '引导'
                  }模式`
                : '当前使用你的基准间隔'}
            </strong>
            <small>
              {!settings.historyEnabled
                ? '先开启本地行为记录，才能使用自适应。'
                : report?.recommendationReason ?? '正在整理本周样本。'}
            </small>
          </div>
          {settings.adaptiveEnabled ? (
            <button
              title="恢复基准间隔并关闭自适应"
              onClick={() => void update({ adaptiveEnabled: false })}
            >
              <Undo2 size={14} />
              恢复基准
            </button>
          ) : null}
          {adaptiveChanged ? <span className="adaptive-live">已自动调整</span> : null}
        </div>

        <label className="switch-row">
          <span>
            <strong>固定免打扰时段</strong>
            <small>时段内不弹出提醒，到结束时间自动继续。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.quietHoursEnabled}
            onChange={(event) => void update({ quietHoursEnabled: event.currentTarget.checked })}
          />
        </label>
        {settings.quietHoursEnabled ? (
          <div className="quiet-time-row">
            <MoonStar size={17} />
            <label>
              从
              <input
                type="time"
                value={timeValue(settings.quietHoursStartMinutes)}
                onChange={(event) => {
                  const value = parseTimeValue(event.currentTarget.value);
                  if (value !== null) {
                    void update({ quietHoursStartMinutes: value });
                  }
                }}
              />
            </label>
            <span>到</span>
            <label>
              <input
                type="time"
                value={timeValue(settings.quietHoursEndMinutes)}
                onChange={(event) => {
                  const value = parseTimeValue(event.currentTarget.value);
                  if (value !== null) {
                    void update({ quietHoursEndMinutes: value });
                  }
                }}
              />
            </label>
          </div>
        ) : null}

        <label className="switch-row">
          <span>
            <strong>到期时检查前台应用</strong>
            <small>仅匹配下方白名单；会议应用改为系统轻提示，其他命中推迟 5 分钟，连续 3 次后仍会温和提醒。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.foregroundDetectionEnabled}
            onChange={(event) =>
              void update({ foregroundDetectionEnabled: event.currentTarget.checked })
            }
          />
        </label>
        {settings.foregroundDetectionEnabled ? (
          <label className="quiet-app-field">
            <span>
              <MonitorUp size={16} />
              前台应用白名单
            </span>
            <textarea
              value={quietAppsDraft}
              rows={2}
              placeholder="例如：powerpnt, zoom, teams"
              onChange={(event) => setQuietAppsDraft(event.currentTarget.value)}
              onBlur={() =>
                void update({
                  quietAppWhitelist: quietAppsDraft
                    .split(/[\n,，;；]+/)
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                })
              }
            />
            <small>只保存进程名，不保存窗口标题或工作内容。</small>
          </label>
        ) : null}
      </section>

      <section className="settings-section hotkey-section">
        <div className="section-heading-row">
          <div>
            <h2>全局快捷键</h2>
            <small>在其他应用中也可使用；若组合键已被占用，会在下方明确标出。</small>
          </div>
          <Keyboard size={20} />
        </div>
        <label className="switch-row">
          <span>
            <strong>启用全局快捷键</strong>
            <small>关闭后会立即释放 EyeProtect 注册的全部组合键。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.hotkeysEnabled}
            onChange={(event) => void update({ hotkeysEnabled: event.currentTarget.checked })}
          />
        </label>
        <div className="hotkey-list">
          {HOTKEY_COPY.map((item) => {
            const conflict = hotkeyStatus.conflicts.includes(item.action);
            const registered = hotkeyStatus.registered.includes(item.action);
            return (
              <div key={item.action}>
                <span>{item.label}</span>
                <kbd>{item.keys}</kbd>
                <small className={conflict ? 'conflict' : registered ? 'ready' : ''}>
                  {!settings.hotkeysEnabled ? '已关闭' : conflict ? '被其他应用占用' : registered ? '可用' : '等待注册'}
                </small>
              </div>
            );
          })}
        </div>
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
            <small>仅专注模式生效：暗化其他界面，只保留提醒卡片。</small>
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

      <section className="settings-section history-section">
        <div className="section-heading-row">
          <div>
            <h2>本地健康趋势</h2>
            <small>只保存在本机，用于当日照顾度、桌宠反馈和周报。</small>
          </div>
          <BarChart3 size={20} />
        </div>

        <label className="switch-row">
          <span>
            <strong>记录提醒行为</strong>
            <small>记录完成、稍后、跳过和自然离开；不会上传。</small>
          </span>
          <input
            type="checkbox"
            checked={settings.historyEnabled}
            onChange={(event) => void update({ historyEnabled: event.currentTarget.checked })}
          />
        </label>

        {settings.historyEnabled ? (
          <>
            <div className="care-summary">
              <div className="care-score-ring" aria-label={`当日照顾度 ${care.score} 分`}>
                <strong>{care.score}</strong>
                <span>照顾度</span>
              </div>
              <div>
                <strong>{care.message}</strong>
                <span>
                  今日完成 {care.completedToday} · 自然休息 {care.naturalBreaksToday} ·
                  稍后 {care.snoozedToday}
                </span>
              </div>
              {care.accessory !== 'none' ? (
                <span className="care-unlock">
                  <Sparkles size={13} />
                  今日配饰已解锁
                </span>
              ) : null}
            </div>

            <div className="history-stats">
              <div>
                <span>本周完成</span>
                <strong>{report?.current.complete ?? 0}</strong>
                <small>{completedComparison}</small>
              </div>
              <div>
                <span>完成比例</span>
                <strong>{completionPercent}%</strong>
                <small>
                  稍后 {report?.current.snooze ?? 0} · 跳过 {report?.current.skip ?? 0}
                </small>
              </div>
              <div>
                <span>护眼 / 走动</span>
                <strong>
                  {report?.current.eyeComplete ?? 0} / {report?.current.walkComplete ?? 0}
                </strong>
                <small>按完成次数统计</small>
              </div>
              <div>
                <span>容易跳过</span>
                <strong>
                  {report?.current.mostSkippedHour === null ||
                  report?.current.mostSkippedHour === undefined
                    ? '暂无'
                    : `${String(report.current.mostSkippedHour).padStart(2, '0')}:00`}
                </strong>
                <small>本周最常跳过时段</small>
              </div>
              <div>
                <span>最长连续活跃</span>
                <strong>{report?.current.longestActiveMinutes ?? 0} 分钟</strong>
                <small>自然离开或间隔超过 2 小时会重新计段</small>
              </div>
            </div>

            <div className="history-recommendation">
              <span>建议节奏</span>
              <strong>
                护眼 {report?.recommendedEyeMinutes ?? settings.eyeIntervalMinutes} 分钟 ·
                走动 {report?.recommendedWalkMinutes ?? settings.walkIntervalMinutes} 分钟
              </strong>
              <small>
                {settings.adaptiveEnabled
                  ? '已用于下一周期；基准设置不会被改写，可在上方一键恢复。'
                  : report?.recommendationReason ?? '样本只保存在本机。'}
              </small>
            </div>

            <div className="history-controls">
              <label>
                保存
                <select
                  value={settings.historyRetentionDays}
                  onChange={(event) =>
                    void update({
                      historyRetentionDays: event.currentTarget.value === '90' ? 90 : 30
                    })
                  }
                >
                  <option value={30}>最近 30 天</option>
                  <option value={90}>最近 90 天</option>
                </select>
              </label>
              <button onClick={() => void window.eyeProtect.exportReminderHistory('csv')}>
                <Download size={14} />
                CSV
              </button>
              <button onClick={() => void window.eyeProtect.exportReminderHistory('json')}>
                <Download size={14} />
                JSON
              </button>
              <button
                className={confirmClearHistory ? 'danger' : ''}
                onClick={() => {
                  if (!confirmClearHistory) {
                    setConfirmClearHistory(true);
                    return;
                  }
                  setConfirmClearHistory(false);
                  void window.eyeProtect.clearReminderHistory();
                }}
              >
                <Trash2 size={14} />
                {confirmClearHistory ? '确认清除' : '清除'}
              </button>
            </div>
          </>
        ) : (
          <div className="history-disabled">
            <span>统计已关闭。现有本地记录会保留，重新开启后继续使用。</span>
            <button
              className={confirmClearHistory ? 'danger' : ''}
              onClick={() => {
                if (!confirmClearHistory) {
                  setConfirmClearHistory(true);
                  return;
                }
                setConfirmClearHistory(false);
                void window.eyeProtect.clearReminderHistory();
              }}
            >
              <Trash2 size={14} />
              {confirmClearHistory ? '确认清除全部' : '清除现有记录'}
            </button>
          </div>
        )}
      </section>

      <section className="settings-section data-section">
        <div className="section-heading-row">
          <div>
            <h2>备份与迁移</h2>
            <small>一个文件包含设置、任务、独立提醒和本地提醒历史；导入前会再次确认。</small>
          </div>
          <DatabaseBackup size={20} />
        </div>
        <div className="data-actions">
          <button onClick={() => void runDataAction(window.eyeProtect.exportBackup)}>
            <Download size={15} />
            导出完整备份
          </button>
          <button onClick={() => void runDataAction(window.eyeProtect.importBackup)}>
            <Upload size={15} />
            导入备份
          </button>
          <button onClick={() => void runDataAction(window.eyeProtect.openDataDirectory)}>
            <FolderOpen size={15} />
            打开数据目录
          </button>
          <button
            className="danger-soft"
            onClick={() => void runDataAction(window.eyeProtect.resetToDefaults)}
          >
            <RotateCcw size={15} />
            恢复默认
          </button>
        </div>
        {dataMessage ? <div className="data-message" role="status">{dataMessage}</div> : null}
        {recoveryInfo && recoveryInfo.corruptBackups.length > 0 ? (
          <div className="recovery-notice">
            <strong>检测到 {recoveryInfo.corruptBackups.length} 个损坏配置备份</strong>
            <span>原文件已隔离保留，可打开数据目录手动取回或导入其他备份。</span>
            <small>{recoveryInfo.corruptBackups.slice(-3).join(' · ')}</small>
          </div>
        ) : (
          <small className="data-path-note">
            配置损坏时会自动隔离原文件，并在这里显示恢复入口。
          </small>
        )}
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
            <>
              <button onClick={() => void window.eyeProtect.pause(10)}>
                <Pause size={18} />
                暂停 10 分钟
              </button>
              <button onClick={() => void window.eyeProtect.pause(30)}>
                <Pause size={18} />
                会议 30 分钟
              </button>
              <button onClick={() => void window.eyeProtect.pause(minutesUntilNextHour(now))}>
                <Clock3 size={18} />
                到下一整点
              </button>
              <button onClick={() => void window.eyeProtect.pause(minutesUntilMidnight(now))}>
                <MoonStar size={18} />
                今天不再提醒
              </button>
              <label className="custom-pause">
                <input
                  type="number"
                  min={1}
                  max={24 * 60}
                  value={customPauseMinutes}
                  onChange={(event) =>
                    setCustomPauseMinutes(
                      Math.min(24 * 60, Math.max(1, Number(event.currentTarget.value) || 1))
                    )
                  }
                />
                <span>分钟</span>
                <button
                  type="button"
                  onClick={() => void window.eyeProtect.pause(customPauseMinutes)}
                >
                  自定义暂停
                </button>
              </label>
              <label className="meeting-end-pause">
                <input
                  type="time"
                  value={meetingEndTime}
                  onChange={(event) => setMeetingEndTime(event.currentTarget.value)}
                />
                <button
                  type="button"
                  onClick={() =>
                    void window.eyeProtect.pause(minutesUntilClockTime(meetingEndTime, now))
                  }
                >
                  暂停到会议结束
                </button>
              </label>
            </>
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
