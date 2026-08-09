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
  ProjectInput,
  ProjectUpdateInput,
  ReminderAction,
  ReminderKind,
  Settings,
  StandaloneReminderInput,
  Task,
  TaskInput,
  TaskStatus,
  TaskUpdateInput
} from '../shared/types';
import type { Project } from '../shared/types';
import { DEFAULT_SETTINGS, sanitizeStandaloneReminderSchedule } from '../shared/types';
import { createBackup, parseBackup } from './backup';
import { startDiagnostics } from './diagnostics';
import { ReminderScheduler } from './reminders';
import { ReminderSurfaceManager } from './reminderSurface';
import { buildCareStatus, ReminderHistoryStore } from './reminderHistory';
import { RuntimeStateStore } from './runtimeState';
import { ReminderTrace, type ReminderTraceSink } from './scheduling/reminderTrace';
import { SchedulerKernel } from './scheduling/kernel';
import { evaluateReminderContext } from './sceneAwareness';
import { isTrustedRendererUrl } from './security';
import { SettingsStore, syncStartupShortcut } from './settings';
import { AppWindows, getRuntimeInfo } from './windows';
import { TaskStore } from './taskStore';
import { TaskService } from './taskService';
import { TaskScheduler } from './taskScheduler';
import { StandaloneReminderService } from './standaloneReminders';

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
  settingsStore: SettingsStore,
  getTasks: () => Task[]
): void => {
  tray = new Tray(loadTrayIcon());

  const buildMenu = (): Menu => {
    const status = scheduler.getStatus();
    const paused = status.pausedUntil !== null && status.pausedUntil > Date.now();
    const pendingTodos = getTasks().filter((task) => task.status !== 'done' && task.status !== 'archived').length;

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
      { label: '打开工作台', click: (): void => windows.showWorkbenchWindow() },
      { label: '打开快速面板', click: (): void => void windows.openPanel('todos') },
      { label: '打开设置', click: (): void => windows.showWorkbenchWindow('settings') },
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

  // v1.3 tray left-click opens the Today workbench (USERPLAN §三): the
  // primary surface is now task management, not the settings window.
  tray.on('click', () => {
    windows.showWorkbenchWindow();
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

const asStandaloneReminderInput = (value: unknown): StandaloneReminderInput | null => {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<StandaloneReminderInput>;
  const schedule = sanitizeStandaloneReminderSchedule(candidate.schedule);
  return schedule ? {
    label: typeof candidate.label === 'string' ? candidate.label : undefined,
    schedule,
    enabled: candidate.enabled !== false
  } : null;
};

const asStandaloneReminderUpdate = (value: unknown): Partial<StandaloneReminderInput> => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const candidate = value as Partial<StandaloneReminderInput>;
  const schedule = candidate.schedule === undefined ? undefined : sanitizeStandaloneReminderSchedule(candidate.schedule);
  return {
    label: typeof candidate.label === 'string' ? candidate.label : undefined,
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : undefined,
    schedule: schedule ?? undefined
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
  // One shared deadline queue for every timed event (breaks, alarms, tasks).
  // A rolling reminder-trace backs the kernel so a missed reminder can be
  // diagnosed from data instead of guesswork (USERPLAN §四.B).
  const reminderTrace: ReminderTraceSink = new ReminderTrace(settingsStore.getDataDir());
  const kernel = new SchedulerKernel({
    trace: (message, data) =>
      reminderTrace.append({ t: Date.now(), src: 'kernel', event: message, data })
  });
  // Schedules survive restarts: restore the persisted snapshot (validated;
  // corrupt files were quarantined by the store) and persist every transition.
  const scheduler = new ReminderScheduler(settingsStore.get(), {
    kernel,
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
    beforeReminder: () => evaluateReminderContext(settingsStore.get()),
    trace: (event, data) =>
      reminderTrace.append({ t: Date.now(), src: 'scheduler', event, data })
  });
  // v1.1 Task Core (USERPLAN §二): SQLite keeps task/project/reminder state
  // independent from settings.json. Task deadlines share the kernel so they
  // participate in the same suspend/resume reconciliation as breaks.
  const taskStore = new TaskStore(settingsStore.getDataDir());
  const taskService = new TaskService(taskStore);
  const taskScheduler = new TaskScheduler(kernel, () => taskService.getTasks(), Date.now, {
    persist: (events) => taskStore.replaceScheduledEvents('task', events),
    acknowledge: (task) => {
      taskService.updateTask(task.id, { reminderAt: null });
    }
  });
  // Migration happens before any scheduler is armed so imported task and alarm
  // deadlines are visible during the first startup reconciliation.
  taskService.migrateFromTodos(settingsStore.get().todos, Date.now(), settingsStore.get().alarms);
  settingsStore.clearLegacyTaskData();
  scheduler.updateTasks(taskService.getTasks());
  const standaloneReminders = new StandaloneReminderService(taskStore, kernel);
  taskScheduler.arm();
  standaloneReminders.arm();
  const windows = new AppWindows(settingsStore, scheduler);
  // Fallback chain for reminder visibility (USERPLAN §四.B): if the primary
  // AlertWindow renderer crashes, the emergency surface takes over so a reminder
  // is never silently dropped while the main process is alive.
  const reminderSurface = new ReminderSurfaceManager(
    (active) => windows.showReminderOnPrimary(active),
    (action, reminderId) => scheduler.handleAction(action, reminderId),
    () => windows.showWorkbenchWindow('today'),
    (event, data) => reminderTrace.append({ t: Date.now(), src: 'surface', event, data })
  );
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
  // The kernel drops its timer on suspend (it would misfire on wake) and
  // reconciles every registered service on resume/unlock — so alarms, which
  // previously ran an independent timer outside this loop, now wake alongside
  // the break scheduler (fixes the "alarm ignores suspend/resume" gap).
  powerMonitor.on('suspend', () => {
    kernel.suspend();
    scheduler.suspend();
    taskScheduler.suspend();
    standaloneReminders.suspend();
  });
  powerMonitor.on('resume', () => {
    scheduler.handleSystemResume(powerMonitor.getSystemIdleTime());
    kernel.resume(powerMonitor.getSystemIdleTime() * 1000);
    taskScheduler.resume();
    standaloneReminders.resume();
  });
  powerMonitor.on('unlock-screen', () => {
    scheduler.handleScreenUnlock();
    kernel.reconcile();
    taskScheduler.arm();
    standaloneReminders.arm();
  });

  app.on('second-instance', () => {
    windows.showWorkbenchWindow('today');
  });

  // If any renderer (including the alert window) crashes while a reminder is on
  // screen, fall back to the emergency surface instead of leaving the user with
  // an invisible, un-dismissable reminder. 'render-process-gone' covers crashes
  // and OOM kills; 'child-process-gone' covers GPU-process losses that also
  // blank a window.
  const onRendererGone = () => {
    const active = scheduler.getStatus().activeReminder;
    if (active) {
      reminderSurface.handleRendererGone(active);
    }
  };
  app.on('render-process-gone', onRendererGone);
  app.on('child-process-gone', onRendererGone);

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

  let presentedReminderId: string | null = null;
  scheduler.onChanged((status) => {
    windows.broadcastReminderStatus(status);
    const active = status.activeReminder;
    if (!active) {
      presentedReminderId = null;
      reminderSurface.destroy();
      return;
    }
    if (presentedReminderId !== active.id) {
      presentedReminderId = active.id;
      void reminderSurface.present(active);
    }
  });

  standaloneReminders.on('changed', (reminders) => windows.broadcastStandaloneReminders(reminders));
  standaloneReminders.on('fired', (reminder) => {
    windows.broadcastStandaloneReminderFired(reminder);
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: reminder.label || 'EyeProtect 提醒',
        body: '时间到了。点击打开工作台查看。'
      });
      notification.on('click', () => windows.showWorkbenchWindow('reminders'));
      notification.show();
    }
  });
  historyStore.onChanged(broadcastHistory);

  // v1.1 Task Core events → renderer. The workbench subscribes to these push
  // channels via the preload bridge; other windows ignore them.
  taskService.on('tasks-changed', (tasks: Task[]) => {
    scheduler.updateTasks(tasks);
    windows.broadcastTasks(tasks);
    taskScheduler.arm();
  });
  taskService.on('projects-changed', (projects: Project[]) => {
    windows.broadcastProjects(projects);
  });
  taskService.on('active-task-changed', (id: string | null) => {
    windows.broadcastActiveTask(id);
  });

  scheduler.on('action', ({ action, isTest }: { action: ReminderAction; isTest: boolean }) => {
    if (action !== 'complete' || isTest) {
      return;
    }
    const activeTaskId = taskService.getActiveTaskId();
    const activeTask = activeTaskId ? taskService.getTask(activeTaskId) : null;
    if (!activeTask || !Notification.isSupported()) {
      return;
    }
    const notification = new Notification({
      title: '休息完成 · 继续当前任务',
      body: activeTask.title,
      silent: true
    });
    notification.on('click', () => windows.showWorkbenchWindow('today'));
    notification.show();
  });

  // v1.1 Rhythm integration (USERPLAN §四): an away-context task suggestion is
  // folded into the next walk reminder, and task reminders surface as native
  // notifications (never stealing focus from an in-flight break). The active
  // The active task lives in SQLite so a break's "what I was doing" round-trip
  // survives renderer reloads and application restarts.
  taskScheduler.on('task-reminder', (due: Task[]) => {
    scheduler.queueTaskReminders(due, windows, () =>
      taskService.getTasks().filter((task) => task.context === 'away' || task.context === 'any')
    );
  });

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
  handleIpc('window:settings:open', () => windows.showWorkbenchWindow('settings'));
  handleIpc('window:settings:close', () => windows.closeWorkbenchWindow());
  handleIpc('window:panel:open', (tab) => windows.openPanel(tab === 'alarms' ? 'alarms' : 'todos'));
  handleIpc('window:panel:quick-add', () => windows.openQuickTodo());
  handleIpc('window:panel:close', () => windows.closePanel());
  handleIpc('window:panel:tab', () => windows.getPanelTab());
  handleIpc('window:panel:consume-quick-add', () => windows.consumeQuickAddRequest());
  handleIpc('standalone-reminder:list', () => standaloneReminders.list());
  handleIpc('standalone-reminder:create', (input) => {
    const normalized = asStandaloneReminderInput(input);
    return normalized ? standaloneReminders.create(normalized) : standaloneReminders.list();
  });
  handleIpc('standalone-reminder:update', (id, input) => {
    return standaloneReminders.update(asString(id), asStandaloneReminderUpdate(input));
  });
  handleIpc('standalone-reminder:delete', (id) => standaloneReminders.remove(asString(id)));
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
      createBackup(settingsStore.get(), historyStore.getEvents(), app.getVersion(), Date.now(), {
        tasks: taskService.getTasks(),
        projects: taskService.getProjects(),
        standaloneReminders: standaloneReminders.list(),
        activeTaskId: taskService.getActiveTaskId()
      }),
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
        message: '导入会替换当前设置、任务、独立提醒和提醒历史。',
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
      taskStore.replaceProjects(backup.projects);
      taskStore.replaceAll(backup.tasks);
      taskStore.replaceStandaloneReminders(backup.standaloneReminders);
      taskStore.setActiveTaskId(backup.activeTaskId);
      scheduler.updateTasks(taskStore.getTasks());
      windows.broadcastTasks(taskStore.getTasks());
      windows.broadcastProjects(taskStore.getProjects());
      windows.broadcastActiveTask(taskStore.getActiveTaskId());
      taskScheduler.arm();
      standaloneReminders.arm();
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
      message: '这会清空当前任务和独立提醒，并恢复全部设置默认值。',
      detail: '本地提醒历史不会清除。建议先导出完整备份。',
      buttons: ['取消', '恢复默认'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) {
      return { success: false, message: '已取消恢复' };
    }
    settingsStore.save(DEFAULT_SETTINGS);
    taskStore.replaceAll([]);
    taskStore.replaceProjects([]);
    taskStore.replaceStandaloneReminders([]);
    taskStore.setActiveTaskId(null);
    scheduler.updateTasks([]);
    taskScheduler.arm();
    standaloneReminders.arm();
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

  // ── v1.1 Task Core IPC (USERPLAN §二) ───────────────────────────────────────
  // All handlers are sender-verified (handleIpc) and coerce their arguments.
  // Every mutation flows through TaskService, which re-emits domain events that
  // the wiring above broadcasts to the workbench and re-arms the task scheduler.
  const asTaskInput = (value: unknown): TaskInput => {
    const candidate = (value && typeof value === 'object' ? value : {}) as Partial<TaskInput>;
    return {
      title: asString(candidate.title),
      notes: typeof candidate.notes === 'string' || candidate.notes === null ? candidate.notes : undefined,
      priority:
        candidate.priority === 'important' || candidate.priority === 'urgent' || candidate.priority === 'normal'
          ? candidate.priority
          : undefined,
      projectId: typeof candidate.projectId === 'string' || candidate.projectId === null ? candidate.projectId : undefined,
      parentId: typeof candidate.parentId === 'string' || candidate.parentId === null ? candidate.parentId : undefined,
      tags: Array.isArray(candidate.tags) ? candidate.tags.map((tag) => asString(tag)) : undefined,
      plannedAt:
        candidate.plannedAt === null || (typeof candidate.plannedAt === 'number' && Number.isFinite(candidate.plannedAt))
          ? candidate.plannedAt
          : undefined,
      dueAt:
        candidate.dueAt === null || (typeof candidate.dueAt === 'number' && Number.isFinite(candidate.dueAt)) ? candidate.dueAt : undefined,
      reminderAt:
        candidate.reminderAt === null || (typeof candidate.reminderAt === 'number' && Number.isFinite(candidate.reminderAt))
          ? candidate.reminderAt
          : undefined,
      recurrence:
        candidate.recurrence === null || (candidate.recurrence && typeof candidate.recurrence === 'object')
          ? (candidate.recurrence as TaskInput['recurrence'])
          : undefined,
      context:
        candidate.context === 'desk' || candidate.context === 'away' || candidate.context === 'any'
          ? candidate.context
          : undefined,
      estimateMinutes:
        candidate.estimateMinutes === null || (typeof candidate.estimateMinutes === 'number' && Number.isFinite(candidate.estimateMinutes))
          ? candidate.estimateMinutes
          : undefined
    };
  };

  const asTaskUpdateInput = (value: unknown): TaskUpdateInput => {
    if (!value || typeof value !== 'object') {
      return {};
    }
    const candidate = value as Partial<TaskUpdateInput>;
    const input = asTaskInput(value) as TaskUpdateInput;
    if (
      candidate.status === 'inbox' || candidate.status === 'active' ||
      candidate.status === 'done' || candidate.status === 'archived'
    ) {
      input.status = candidate.status;
    }
    if (typeof candidate.sortOrder === 'number' && Number.isInteger(candidate.sortOrder) && candidate.sortOrder >= 0) {
      input.sortOrder = candidate.sortOrder;
    }
    return input;
  };

  const asProjectInput = (value: unknown): ProjectInput => {
    const candidate = (value && typeof value === 'object' ? value : {}) as Partial<ProjectInput>;
    return {
      name: asString(candidate.name),
      color: typeof candidate.color === 'string' ? candidate.color : undefined,
      parentId: typeof candidate.parentId === 'string' ? candidate.parentId : undefined
    };
  };

  handleIpc('task:list', () => taskService.getTasks());
  handleIpc('task:get', (id) => taskService.getTask(asString(id)));
  handleIpc('task:create', (input) => taskService.createTask(asTaskInput(input)));
  handleIpc('task:update', (id, input) =>
    taskService.updateTask(asString(id), asTaskUpdateInput(input))
  );
  handleIpc('task:set-status', (id, status) =>
    taskService.setTaskStatus(
      asString(id),
      status === 'inbox' || status === 'active' || status === 'done' || status === 'archived'
        ? (status as TaskStatus)
        : 'inbox'
    )
  );
  handleIpc('task:delete', (id) => {
    return taskService.deleteTask(asString(id));
  });
  handleIpc('task:active:get', () => taskService.getActiveTaskId());
  handleIpc('task:active:set', (id) => taskService.setActiveTask(typeof id === 'string' ? id : null));
  handleIpc('project:list', () => taskService.getProjects());
  handleIpc('project:get', (id) => taskService.getProject(asString(id)));
  handleIpc('project:create', (input) => taskService.createProject(asProjectInput(input)));
  handleIpc('project:update', (id, input) =>
    taskService.updateProject(asString(id), asProjectInput(input) as ProjectUpdateInput)
  );
  handleIpc('project:delete', (id) => taskService.deleteProject(asString(id)));
  handleIpc('window:workbench:open', (section) =>
    windows.showWorkbenchWindow(section === 'settings' || section === 'reminders' ? section : 'today')
  );
  handleIpc('window:workbench:close', () => windows.closeWorkbenchWindow());
  handleIpc('window:workbench:section', () => windows.getWorkbenchSection());

  await windows.createPetWindow();
  applyGlobalHotkeys(settingsStore.get().hotkeysEnabled);
  createTray(windows, scheduler, settingsStore, () => taskService.getTasks());
  kernel.start();
  scheduler.start();
  syncStartupShortcut(settingsStore.get());
  startDiagnostics();

  // Persist on the way out so a restart resumes the running countdowns
  // instead of silently resetting (or bypassing) them.
  app.on('before-quit', () => {
    runtimeStateStore.markExiting();
    runtimeStateStore.save(scheduler.serialize());
    taskScheduler.dispose();
    standaloneReminders.dispose();
    kernel.stop();
    scheduler.stop();
    taskStore.close();
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
