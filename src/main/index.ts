import { app, ipcMain, Menu, nativeImage, powerMonitor, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReminderAction, ReminderKind, Settings } from '../shared/types';
import { AlarmClock, type AlarmInput } from './alarms';
import { startDiagnostics } from './diagnostics';
import { ReminderScheduler } from './reminders';
import { RuntimeStateStore } from './runtimeState';
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
            { label: '暂停 30 分钟', click: (): void => void scheduler.pause(30) },
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
  // Schedules survive restarts: restore the persisted snapshot (validated;
  // corrupt files were quarantined by the store) and persist every transition.
  const scheduler = new ReminderScheduler(settingsStore.get(), {
    restore: runtimeStateStore.load(),
    onPersist: (snapshot) => runtimeStateStore.save(snapshot)
  });
  const alarmClock = new AlarmClock();
  alarmClock.hydrate(settingsStore.get().alarms);
  const windows = new AppWindows(settingsStore, scheduler);

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
      settings.snoozeMinutes !== previous.snoozeMinutes
    ) {
      scheduler.updateSettings(settings, previous);
    }
    if (settings.startWithWindows !== previous.startWithWindows) {
      syncStartupShortcut(settings);
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
  settingsStore.on('todos-changed', (todos) => windows.broadcastTodos(todos));
  alarmClock.on('fired', (alarm) => windows.broadcastAlarmFired(alarm));

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
  handleIpc('reminder:test', (kind) => {
    const normalized = asReminderKind(kind);
    return normalized ? scheduler.triggerTest(normalized) : scheduler.getStatus();
  });
  handleIpc('reminder:pause', (minutes) => scheduler.pause(asNumber(minutes, 60)));
  handleIpc('reminder:resume', () => scheduler.resume());
  handleIpc('reminder:restart', () => scheduler.restartCycle());
  handleIpc('window:settings:open', () => windows.showSettingsWindow());
  handleIpc('window:settings:close', () => windows.closeSettingsWindow());
  handleIpc('window:panel:open', (tab) => windows.openPanel(tab === 'alarms' ? 'alarms' : 'todos'));
  handleIpc('window:panel:close', () => windows.closePanel());
  handleIpc('window:panel:tab', () => windows.getPanelTab());
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
  handleIpc('todo:clear-completed', () => settingsStore.clearCompletedTodos());

  await windows.createPetWindow();
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
