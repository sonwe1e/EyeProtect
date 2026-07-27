import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
  Tray
} from 'electron';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  HotkeyAction,
  HotkeyStatus,
  PreAlertAction,
  ReminderAction,
  ReminderKind,
  Settings
} from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { AlarmClock, type AlarmInput } from './alarms';
import { createBackup, parseBackup } from './backup';
import { startDiagnostics } from './diagnostics';
import { ReminderScheduler } from './reminders';
import { buildCareStatus, ReminderHistoryStore } from './reminderHistory';
import { RuntimeStateStore } from './runtimeState';
import { evaluateReminderContext } from './sceneAwareness';
import { isTrustedRendererUrl } from './security';
import { SettingsStore, syncStartupShortcut } from './settings';
import { AppWindows, getRuntimeInfo } from './windows';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const rendererIndexPath = join(moduleDir, '../renderer/index.html');
const fallbackTrayPng =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACCUlEQVR4nO3YzU3DQBCG4bTBiQJogAsNcEgLdMSVDtJBCqABTtADDcDVSEiJ7NXszrfj+VvYleaCFMfvs3bicDjMNddccwnXzeNxyTD/MjoEg3rDu/MpdFwQMoa7QWQP5yBc4o+v55AxR+Dio8IRiN0Ao8SbIHCXfnQsiiC+Fbj45f1pM9HhKIIKQBmfDWE3QO/u9wAsX2/QhCJoAqDB2iDhAFrhUghTAAoBDv88YbMTwhyg63JHozsxUgGYhAMQ7gAUgnk4A8HFmwK4xwMI5gDXb4Oo+AYC8utQBYCLv71/MBkOwRXAKlKMYw3QdTLfH79T+zs36PFaowKAhnIRl4UgSF7HnacIQBJd3cFVSOsY0tchGF0A0nB0R7Rfhx5rAkTdAp4AKreA9odgT4Tme5Xx82twPggN+Ci8WVkehREElVk/A5QAYLwZgDlCGb8G6Ig3BTBDUNp5FwASQQpRPvo2dh2NdwGoIlwgWh9kxK5v4ivH7Tk3F4AmQuuSrt3vjX+L956XG0AVgrq0aziK4WEALYhyp5H4vecRBkCCFPc6Fa/9vmkArhDFEh/n5XkzwwCoIBbxLQQxQGYEFKDsmQDIGgEBARDFjwJAIajsPgWQGaE2VAMMMDrC7viREdTiawBZIVrnKgbgEDJAcOe3Kx5FyDoq8SNCqIePhGAanxXDNXquueb6U+sHFKlz5uxphmoAAAAASUVORK5CYII=';

let tray: Tray | null = null;
let isQuitting = false;

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
}

const getTrayIconPath = (): string =>
  process.env.ELECTRON_RENDERER_URL
    ? join(process.cwd(), 'public/assets/tray-icon.png')
    : join(moduleDir, '../renderer/assets/tray-icon.png');

const loadTrayIcon = () => {
  const assetPath = getTrayIconPath();
  const icon = existsSync(assetPath)
    ? nativeImage.createFromPath(assetPath)
    : nativeImage.createFromBuffer(Buffer.from(fallbackTrayPng, 'base64'));
  const trayIcon = icon.isEmpty()
    ? nativeImage.createFromBuffer(Buffer.from(fallbackTrayPng, 'base64'))
    : icon;
  return trayIcon.resize({ width: 16, height: 16 });
};

const formatClock = (timestamp: number): string =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(timestamp)
  );

const minutesUntilMidnight = (): number => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60_000));
};

const minutesUntilNextHour = (): number => {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  return Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 60_000));
};

const HOTKEYS: Record<HotkeyAction, string> = {
  'break-now': 'CommandOrControl+Alt+B',
  'pause-toggle': 'CommandOrControl+Alt+P',
  'todo-add': 'CommandOrControl+Alt+A',
  todos: 'CommandOrControl+Alt+T',
  'pet-toggle': 'CommandOrControl+Alt+H'
};

/**
 * The tray is the main control surface: the menu is rebuilt every time it is
 * opened, so it always reflects live status (paused? next reminders? pending
 * todos?) without any background polling.
 */
const createTray = (
  windows: AppWindows,
  scheduler: ReminderScheduler,
  settingsStore: SettingsStore
): void => {
  tray = new Tray(loadTrayIcon());

  const buildMenu = (): Menu => {
    const status = scheduler.getStatus();
    const paused = status.pausedUntil !== null && status.pausedUntil > Date.now();
    const pendingTodos = settingsStore.get().todos.filter((todo) => !todo.completed).length;

    return Menu.buildFromTemplate([
      {
        label: paused
          ? `EyeProtect · 已暂停至 ${formatClock(status.pausedUntil as number)}`
          : 'EyeProtect · 运行中',
        enabled: false
      },
      ...(paused
        ? []
        : [
            { label: `下次护眼：${formatClock(status.nextEyeAt)}`, enabled: false },
            { label: `下次走动：${formatClock(status.nextWalkAt)}`, enabled: false }
          ]),
      { type: 'separator' },
      ...(paused
        ? [
            { label: '恢复提醒', click: (): void => void scheduler.resume() },
            { label: '重新开始计时', click: (): void => void scheduler.restartCycle() }
          ]
        : [
            { label: '立即休息', click: (): void => void scheduler.triggerNow() },
            { label: '快速暂停 10 分钟', click: (): void => void scheduler.pause(10) },
            { label: '会议 30 分钟', click: (): void => void scheduler.pause(30) },
            { label: '暂停到下一整点', click: (): void => void scheduler.pause(minutesUntilNextHour()) },
            { label: '暂停 1 小时', click: (): void => void scheduler.pause(60) },
            { label: '今日停用', click: (): void => void scheduler.pause(minutesUntilMidnight()) }
          ]),
      { type: 'separator' },
      { label: `待办：${pendingTodos} 项未完成`, enabled: false },
      { label: '打开待办', click: (): void => void windows.openPanel('todos') },
      { label: '打开设置', click: (): void => void windows.showSettingsWindow() },
      { type: 'separator' },
      { label: '测试护眼提醒', click: (): void => void scheduler.triggerTest('eye') },
      { label: '测试走动提醒', click: (): void => void scheduler.triggerTest('walk') },
      { type: 'separator' },
      {
        label: '退出',
        click: (): void => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
  };

  // Rebuild just before the menu opens so entries show current state.
  tray.on('right-click', () => {
    tray?.setContextMenu(buildMenu());
  });
  tray.setContextMenu(buildMenu());

  // Tooltip: update only when the rendered text actually changes (deadlines
  // only move on transitions, so this is event-driven, not per-second).
  let lastTooltip = '';
  const updateTooltip = (): void => {
    const status = scheduler.getStatus();
    const text =
      status.pausedUntil && status.pausedUntil > Date.now()
        ? `EyeProtect · 已暂停至 ${formatClock(status.pausedUntil)}`
        : `EyeProtect · 护眼 ${formatClock(status.nextEyeAt)} · 走动 ${formatClock(status.nextWalkAt)}`;
    if (text !== lastTooltip) {
      lastTooltip = text;
      tray?.setToolTip(text);
    }
  };
  scheduler.onChanged(updateTooltip);
  updateTooltip();

  tray.on('click', () => {
    void windows.showSettingsWindow();
  });
};

const asPartialSettings = (value: unknown): Partial<Settings> => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Partial<Settings>;
};

/**
 * IPC only from our own windows: the dev server origin in development, the
 * app's file:// index.html when packaged. A compromised or spoofed frame
 * gets nothing.
 */
const isTrustedSender = (event: Electron.IpcMainInvokeEvent): boolean => {
  const url = event.senderFrame?.url;
  return Boolean(
    url &&
      isTrustedRendererUrl(url, process.env.ELECTRON_RENDERER_URL, rendererIndexPath)
  );
};

const handleIpc = (channel: string, handler: (...args: unknown[]) => unknown): void => {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      console.warn(`[ipc] rejected '${channel}' from untrusted sender`);
      return null;
    }
    return handler(...args);
  });
};

const asReminderAction = (value: unknown): ReminderAction | null =>
  value === 'complete' || value === 'snooze' || value === 'skip' ? value : null;

const asPreAlertAction = (value: unknown): PreAlertAction | null =>
  value === 'start' || value === 'snooze' || value === 'dismiss' ? value : null;

const asReminderKind = (value: unknown): ReminderKind | null =>
  value === 'eye' || value === 'walk' || value === 'combined' ? value : null;

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asAlarmInput = (value: unknown): AlarmInput => {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<AlarmInput>;
  return {
    hour: Math.min(23, Math.max(0, Math.round(asNumber(candidate.hour, 0)))),
    minute: Math.min(59, Math.max(0, Math.round(asNumber(candidate.minute, 0)))),
    label: typeof candidate.label === 'string' ? candidate.label : undefined,
    repeat: candidate.repeat === 'daily' ? 'daily' : 'once',
    // Malformed input yields an inert alarm rather than an armed one.
    enabled: candidate.enabled === true
  };
};

app.setAppUserModelId('local.eyeprotect.pet');

// Renderer hardening: no outbound navigation away from the app page (initial
// load and same-origin dev-server HMR still pass), and no popups at all.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (navEvent, url) => {
    if (!isTrustedRendererUrl(url, process.env.ELECTRON_RENDERER_URL, rendererIndexPath)) {
      navEvent.preventDefault();
    }
  });
});

app.whenReady().then(async () => {
  const settingsStore = new SettingsStore();
  const runtimeStateStore = new RuntimeStateStore(settingsStore.getDataDir());
  const historyStore = new ReminderHistoryStore(settingsStore.getDataDir());
  // Schedules survive restarts: restore the persisted snapshot (validated;
  // corrupt files were quarantined by the store) and persist every transition.
  const scheduler = new ReminderScheduler(settingsStore.get(), {
    restore: runtimeStateStore.load(),
    onPersist: (snapshot) => runtimeStateStore.save(snapshot),
    onEvent: (event) => historyStore.record(event, settingsStore.get()),
    getEffectiveIntervals: (settings) => {
      if (!settings.historyEnabled || !settings.adaptiveEnabled) {
        return {
          eyeMinutes: settings.eyeIntervalMinutes,
          walkMinutes: settings.walkIntervalMinutes
        };
      }
      const report = historyStore.getWeeklyReport(settings);
      return {
        eyeMinutes: report.recommendedEyeMinutes,
        walkMinutes: report.recommendedWalkMinutes
      };
    },
    getEffectiveMode: (settings) => {
      if (!settings.historyEnabled || !settings.adaptiveEnabled) {
        return settings.reminderMode;
      }
      return historyStore.getWeeklyReport(settings).recommendedMode;
    },
    onContextNotification: (decision) => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'EyeProtect · 休息提醒',
          body: `${decision.reason ?? '当前会议场景暂不弹窗'}，5 分钟后再次确认。`,
          silent: true
        }).show();
      }
    },
    beforeReminder: () => evaluateReminderContext(settingsStore.get())
  });
  const alarmClock = new AlarmClock();
  alarmClock.hydrate(settingsStore.get().alarms);
  const windows = new AppWindows(settingsStore, scheduler);
  let hotkeyStatus: HotkeyStatus = {
    enabled: settingsStore.get().hotkeysEnabled,
    registered: [],
    conflicts: []
  };
  const applyGlobalHotkeys = (enabled: boolean): HotkeyStatus => {
    globalShortcut.unregisterAll();
    const registered: HotkeyAction[] = [];
    const conflicts: HotkeyAction[] = [];
    if (enabled) {
      const actions: Record<HotkeyAction, () => void> = {
        'break-now': () => {
          scheduler.triggerNow();
        },
        'pause-toggle': () => {
          const status = scheduler.getStatus();
          if (status.pausedUntil && status.pausedUntil > Date.now()) {
            scheduler.resume();
          } else {
            scheduler.pause(30);
          }
        },
        'todo-add': () => {
          void windows.openQuickTodo();
        },
        todos: () => {
          void windows.openPanel('todos');
        },
        'pet-toggle': () => {
          windows.togglePetVisibility();
        }
      };
      for (const action of Object.keys(HOTKEYS) as HotkeyAction[]) {
        try {
          if (globalShortcut.register(HOTKEYS[action], actions[action])) {
            registered.push(action);
          } else {
            conflicts.push(action);
          }
        } catch {
          conflicts.push(action);
        }
      }
    }
    hotkeyStatus = { enabled, registered, conflicts };
    windows.broadcastHotkeyStatus(hotkeyStatus);
    return hotkeyStatus;
  };
  const getWeeklyReport = () =>
    historyStore.getWeeklyReport(settingsStore.get());
  const getCareStatus = () =>
    settingsStore.get().historyEnabled
      ? historyStore.getCareStatus()
      : buildCareStatus([]);
  const broadcastHistory = (): void => {
    windows.broadcastHistory(getWeeklyReport(), getCareStatus());
  };

  // OS lifecycle: sleep/wake/unlock are reconciled by the scheduler with an
  // idle-aware grace period instead of dumping a backlog of overdue popups.
  powerMonitor.on('suspend', () => {
    scheduler.suspend();
  });
  powerMonitor.on('resume', () => {
    scheduler.handleSystemResume(powerMonitor.getSystemIdleTime());
  });
  powerMonitor.on('unlock-screen', () => {
    scheduler.handleScreenUnlock();
  });

  app.on('second-instance', () => {
    void windows.showSettingsWindow();
  });

  // Domain-scoped reactions: a preference save only touches the subsystems
  // whose inputs actually changed. Todo/alarm mutations never reach this
  // handler at all (they emit their own events), so checking off a todo no
  // longer re-syncs the startup shortcut, resizes the pet or re-schedules.
  settingsStore.onChanged(({ settings, previous }) => {
    if (
      settings.eyeIntervalMinutes !== previous.eyeIntervalMinutes ||
      settings.walkIntervalMinutes !== previous.walkIntervalMinutes ||
      settings.snoozeMinutes !== previous.snoozeMinutes ||
      settings.reminderMode !== previous.reminderMode ||
      settings.preAlertSeconds !== previous.preAlertSeconds ||
      settings.adaptiveEnabled !== previous.adaptiveEnabled ||
      settings.historyEnabled !== previous.historyEnabled ||
      settings.quietHoursEnabled !== previous.quietHoursEnabled ||
      settings.quietHoursStartMinutes !== previous.quietHoursStartMinutes ||
      settings.quietHoursEndMinutes !== previous.quietHoursEndMinutes ||
      settings.foregroundDetectionEnabled !== previous.foregroundDetectionEnabled ||
      settings.quietAppWhitelist.join('\n') !== previous.quietAppWhitelist.join('\n')
    ) {
      // Mode/pre-alert changes do not reschedule deadlines, but the
      // scheduler must see them (enforcement at fire time) and re-arm
      // (pre-alert lead times are timer candidates).
      scheduler.updateSettings(settings, previous);
    }
    if (settings.startWithWindows !== previous.startWithWindows) {
      syncStartupShortcut(settings);
    }
    if (settings.hotkeysEnabled !== previous.hotkeysEnabled) {
      applyGlobalHotkeys(settings.hotkeysEnabled);
    }
    if (settings.historyRetentionDays !== previous.historyRetentionDays) {
      historyStore.applyRetention(settings.historyRetentionDays);
    }
    if (
      settings.historyEnabled !== previous.historyEnabled ||
      settings.historyRetentionDays !== previous.historyRetentionDays ||
      settings.eyeIntervalMinutes !== previous.eyeIntervalMinutes ||
      settings.walkIntervalMinutes !== previous.walkIntervalMinutes
    ) {
      broadcastHistory();
    }
    if (
      settings.petScale !== previous.petScale ||
      settings.petSkin !== previous.petSkin ||
      settings.dimDesktop !== previous.dimDesktop
    ) {
      windows.applyPetSettings(settings);
    }
    windows.broadcastSettings(settings);
  });

  scheduler.onChanged((status) => {
    windows.broadcastReminderStatus(status);
  });

  alarmClock.on('changed', (alarms) => windows.broadcastAlarms(alarms));
  alarmClock.on('changed', (alarms) => settingsStore.persistAlarms(alarms));
  settingsStore.on('todos-changed', (todos) => {
    scheduler.updateTodos(todos);
    windows.broadcastTodos(todos);
  });
  alarmClock.on('fired', (alarm) => windows.broadcastAlarmFired(alarm));
  historyStore.onChanged(broadcastHistory);

  // Every handler is sender-verified (handleIpc) and coerces its arguments:
  // renderers are trusted code, but IPC payloads are still an external input.
  handleIpc('settings:get', () => settingsStore.get());
  handleIpc('settings:save', (payload) => settingsStore.save(asPartialSettings(payload)));
  handleIpc('runtime:get', () => getRuntimeInfo(settingsStore));
  handleIpc('reminder:status', () => scheduler.getStatus());
  handleIpc('reminder:action', (action, reminderId) => {
    const normalized = asReminderAction(action);
    return normalized ? scheduler.handleAction(normalized, asString(reminderId)) : scheduler.getStatus();
  });
  handleIpc('reminder:pre-alert', (action) => {
    const normalized = asPreAlertAction(action);
    return normalized ? scheduler.handlePreAlertAction(normalized) : scheduler.getStatus();
  });
  handleIpc('reminder:test', (kind) => {
    const normalized = asReminderKind(kind);
    return normalized ? scheduler.triggerTest(normalized) : scheduler.getStatus();
  });
  handleIpc('reminder:now', () => scheduler.triggerNow());
  handleIpc('reminder:pause', (minutes) => scheduler.pause(asNumber(minutes, 60)));
  handleIpc('reminder:resume', () => scheduler.resume());
  handleIpc('reminder:restart', () => scheduler.restartCycle());
  handleIpc('window:settings:open', () => windows.showSettingsWindow());
  handleIpc('window:settings:close', () => windows.closeSettingsWindow());
  handleIpc('window:panel:open', (tab) => windows.openPanel(tab === 'alarms' ? 'alarms' : 'todos'));
  handleIpc('window:panel:quick-add', () => windows.openQuickTodo());
  handleIpc('window:panel:close', () => windows.closePanel());
  handleIpc('window:panel:tab', () => windows.getPanelTab());
  handleIpc('window:panel:consume-quick-add', () => windows.consumeQuickAddRequest());
  handleIpc('alarm:list', () => alarmClock.getAlarms());
  handleIpc('alarm:set', (input) => alarmClock.setAlarm(asAlarmInput(input)));
  handleIpc('alarm:cancel', (id) => alarmClock.cancelAlarm(asString(id)));
  handleIpc('todo:list', () => settingsStore.get().todos);
  handleIpc('todo:add', (text) => settingsStore.addTodo(asString(text)));
  handleIpc('todo:toggle', (id) => settingsStore.toggleTodo(asString(id)));
  handleIpc('todo:update', (id, text) => settingsStore.updateTodo(asString(id), asString(text)));
  handleIpc('todo:remove', (id) => settingsStore.removeTodo(asString(id)));
  handleIpc('todo:priority', (id, priority) =>
    settingsStore.setTodoPriority(
      asString(id),
      priority === 'important' || priority === 'urgent' || priority === 'normal' ? priority : 'normal'
    )
  );
  handleIpc('todo:break-reminder', (id, enabled) =>
    settingsStore.setTodoBreakReminder(asString(id), enabled === true)
  );
  handleIpc('todo:clear-completed', () => settingsStore.clearCompletedTodos());
  handleIpc('history:report', () => getWeeklyReport());
  handleIpc('history:care', () => getCareStatus());
  handleIpc('history:clear', () => {
    historyStore.clear();
    return getWeeklyReport();
  });
  handleIpc('history:export', async (format) => {
    const normalized = format === 'csv' ? 'csv' : 'json';
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: '导出 EyeProtect 本地提醒记录',
      defaultPath: `EyeProtect-history-${date}.${normalized}`,
      filters: [
        normalized === 'csv'
          ? { name: 'CSV 表格', extensions: ['csv'] }
          : { name: 'JSON 数据', extensions: ['json'] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return false;
    }
    writeFileSync(result.filePath, historyStore.export(normalized), 'utf8');
    return true;
  });
  handleIpc('hotkeys:status', () => hotkeyStatus);
  handleIpc('data:backup:export', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: '导出 EyeProtect 完整备份',
      defaultPath: `EyeProtect-backup-${date}.json`,
      filters: [{ name: 'EyeProtect 备份', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, message: '已取消导出' };
    }
    writeFileSync(
      result.filePath,
      createBackup(settingsStore.get(), historyStore.getEvents(), app.getVersion()),
      'utf8'
    );
    return { success: true, message: '备份已导出' };
  });
  handleIpc('data:backup:import', async () => {
    const selected = await dialog.showOpenDialog({
      title: '导入 EyeProtect 备份',
      properties: ['openFile'],
      filters: [{ name: 'EyeProtect 备份', extensions: ['json'] }]
    });
    if (selected.canceled || selected.filePaths.length !== 1) {
      return { success: false, message: '已取消导入' };
    }
    try {
      const text = readFileSync(selected.filePaths[0], 'utf8');
      if (Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) {
        throw new Error('备份文件超过 5 MB 安全限制');
      }
      const backup = parseBackup(text);
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: '确认导入备份',
        message: '导入会替换当前设置、待办、闹钟和提醒历史。',
        detail: `备份创建于 ${new Date(backup.createdAt).toLocaleString('zh-CN')}。建议先导出当前数据。`,
        buttons: ['取消', '确认导入'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (confirmation.response !== 1) {
        return { success: false, message: '已取消导入' };
      }
      const next = settingsStore.save(backup.settings);
      historyStore.replaceEvents(backup.reminderHistory, next);
      scheduler.updateTodos(next.todos);
      alarmClock.hydrate(next.alarms);
      windows.broadcastTodos(next.todos);
      windows.broadcastAlarms(next.alarms);
      return { success: true, message: '备份已导入，设置已经生效' };
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法读取备份文件';
      await dialog.showMessageBox({
        type: 'error',
        title: '导入失败',
        message,
        buttons: ['知道了']
      });
      return { success: false, message };
    }
  });
  handleIpc('data:reset', async () => {
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '恢复默认设置',
      message: '这会清空当前待办和闹钟，并恢复全部设置默认值。',
      detail: '本地提醒历史不会清除。建议先导出完整备份。',
      buttons: ['取消', '恢复默认'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) {
      return { success: false, message: '已取消恢复' };
    }
    const next = settingsStore.save(DEFAULT_SETTINGS);
    scheduler.updateTodos(next.todos);
    alarmClock.hydrate(next.alarms);
    windows.broadcastTodos(next.todos);
    windows.broadcastAlarms(next.alarms);
    return { success: true, message: '已恢复默认设置' };
  });
  handleIpc('data:open-directory', async () => {
    const dataDir = settingsStore.getDataDir();
    mkdirSync(dataDir, { recursive: true });
    const error = await shell.openPath(dataDir);
    return error
      ? { success: false, message: error }
      : { success: true, message: '已打开数据目录' };
  });
  handleIpc('data:recovery-info', () => {
    const dataDir = settingsStore.getDataDir();
    const corruptBackups = existsSync(dataDir)
      ? readdirSync(dataDir)
          .filter((name) => name.includes('.corrupt-'))
          .sort()
      : [];
    return { dataDir, corruptBackups };
  });

  await windows.createPetWindow();
  applyGlobalHotkeys(settingsStore.get().hotkeysEnabled);
  createTray(windows, scheduler, settingsStore);
  scheduler.start();
  syncStartupShortcut(settingsStore.get());
  startDiagnostics();

  // Persist on the way out so a restart resumes the running countdowns
  // instead of silently resetting (or bypassing) them.
  app.on('before-quit', () => {
    runtimeStateStore.markExiting();
    runtimeStateStore.save(scheduler.serialize());
    scheduler.stop();
    alarmClock.dispose();
    globalShortcut.unregisterAll();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  }
});
