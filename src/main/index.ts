import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  nativeTheme,
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
  AppHealth,
  CustomPetThemeInfo,
  HotkeyAction,
  HotkeyStatus,
  PreAlertAction,
  ReminderAction,
  ReminderKind,
  Settings,
  Task,
  TaskMoveInput,
  TaskStatus
} from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { createBackup, parseBackup } from './backup';
import { startDiagnostics } from './diagnostics';
import { logger, setLoggerSink } from './logger';
import { ReminderScheduler } from './reminders';
import { ReminderSurfaceManager } from './reminderSurface';
import { ReminderHistoryStore } from './reminderHistory';
import { RuntimeStateStore } from './runtimeState';
import { ReminderTrace, noopReminderTrace, type ReminderTraceSink } from './scheduling/reminderTrace';
import { SchedulerKernel } from './scheduling/kernel';
import { isTrustedRendererUrl } from './security';
import { SettingsStore, syncStartupShortcut } from './settings';
import { AppWindows, getRuntimeInfo } from './windows';
import { TaskStore } from './taskStore';
import { TaskService } from './taskService';
import { TaskScheduler } from './taskScheduler';
import { PomodoroService } from './pomodoro';
import { isCurrentTask } from '../shared/simpleTasks';
import { ActivityMonitor, type ActivityResume } from './activityMonitor';
import { NotificationDeliveryQueue } from './notificationDelivery';
import { asProjectInput, asProjectUpdateInput } from './ipcProjectInput';
import { asSimpleTaskInput, asSimpleTaskUpdateInput } from './ipcTaskInput';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const rendererIndexPath = join(moduleDir, '../renderer/index.html');
const fallbackTrayPng =
  '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';

let tray: Tray | null = null;
let isQuitting = false;

if (process.platform === 'win32') {
  app.setAppUserModelId('local.eyeprotect.pet');
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
}

// A startup migration prompt can appear before the windows service exists.
// Re-launching the portable executable should still bring that native prompt
// to the foreground instead of looking like the application failed to open.
let handleSecondInstance = (): void => app.focus({ steal: true });
if (lock) {
  app.on('second-instance', () => handleSecondInstance());
}

// ── Main-process crash diagnostics ─────────────────────────────────────────
// A last-resort sink that starts as a no-op and is swapped to the real
// rolling trace once whenReady creates it. Recording an uncaught exception /
// unhandled rejection means a tray app that hits an unexpected error leaves
// evidence in reminder-trace.log instead of dying silently. The process keeps
// running: every persistent write in this app is atomic (tmp+rename) or a
// SQLite transaction, so a single stray exception cannot corrupt state.
let crashTraceSink: ReminderTraceSink = noopReminderTrace;
const recordMainProcessFailure = (source: string, error: unknown): void => {
  try {
    const detail =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: String(error.stack ?? '').slice(0, 2000)
          }
        : { message: String(error) };
    crashTraceSink.append({ t: Date.now(), src: 'system', event: source, data: detail });
  } catch {
    // Diagnostics must never throw into the dying stack.
  }
};
process.on('uncaughtException', (error) => {
  logger.error('uncaught exception', error);
  recordMainProcessFailure('uncaught-exception', error);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', reason);
  recordMainProcessFailure('unhandled-rejection', reason);
});

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

const THEME_DISPLAY_NAMES: Record<string, string> = {
  default: '奋斗猫 (默认)',
  dog: '治愈柴犬',
  rabbit: '粉耳白兔',
  hamster: '软萌仓鼠'
};

const buildPetSubmenuTemplate = (
  settingsStore: SettingsStore
): MenuItemConstructorOptions[] => {
  const baseDir = join(settingsStore.getDataDir(), 'custom-pet');
  const settings = settingsStore.get();
  const currentTheme = settings.customPetTheme;
  const currentAppearance = settings.petAppearance;

  const customItems: MenuItemConstructorOptions[] = [];

  if (existsSync(baseDir)) {
    try {
      const files = readdirSync(baseDir, { withFileTypes: true });
      const hasRootAssets = files.some(
        (f) => f.isFile() && (f.name.endsWith('.gif') || f.name.endsWith('.png'))
      );
      if (hasRootAssets) {
        customItems.push({
          label: THEME_DISPLAY_NAMES.default ?? '奋斗猫 (默认)',
          type: 'radio',
          checked: currentTheme === 'default',
          click: () => void settingsStore.save({ customPetTheme: 'default' })
        });
      }

      for (const entry of files) {
        if (entry.isDirectory()) {
          const subDir = join(baseDir, entry.name);
          const subFiles = readdirSync(subDir);
          const hasAssets = subFiles.some(
            (name) => name.endsWith('.gif') || name.endsWith('.png')
          );
          if (hasAssets) {
            customItems.push({
              label: THEME_DISPLAY_NAMES[entry.name] ?? entry.name,
              type: 'radio',
              checked: currentTheme === entry.name,
              click: () => void settingsStore.save({ customPetTheme: entry.name })
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const classicItems: MenuItemConstructorOptions[] = [
    {
      label: '经典像素橘猫',
      type: 'radio',
      checked: currentTheme === null && currentAppearance === 'cat',
      click: () => void settingsStore.save({ customPetTheme: null, petAppearance: 'cat' })
    },
    {
      label: '经典像素小狗',
      type: 'radio',
      checked: currentTheme === null && currentAppearance === 'dog',
      click: () => void settingsStore.save({ customPetTheme: null, petAppearance: 'dog' })
    },
    {
      label: '经典像素白兔',
      type: 'radio',
      checked: currentTheme === null && currentAppearance === 'rabbit',
      click: () => void settingsStore.save({ customPetTheme: null, petAppearance: 'rabbit' })
    }
  ];

  if (customItems.length > 0) {
    return [
      ...customItems,
      { type: 'separator' },
      ...classicItems
    ];
  }

  return classicItems;
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
  getTasks: () => Task[],
  startRest: (id: string) => unknown
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
            { label: settingsStore.get().eyeEnabled ? `下次护眼：${formatClock(status.nextEyeAt)}` : '护眼提醒已关闭', enabled: false },
            { label: settingsStore.get().walkEnabled ? `下次走动：${formatClock(status.nextWalkAt)}` : '走动提醒已关闭', enabled: false }
          ]),
      ...(status.activeReminder
        ? [
            { type: 'separator' as const },
            { label: '当前提醒', enabled: false },
            { label: '开始休息', enabled: typeof status.activeReminder.restStartedAt !== 'number', click: (): void => { startRest(status.activeReminder!.id); } },
            {
              label: '完成当前提醒',
              enabled: typeof status.activeReminder.restStartedAt === 'number' && Date.now() >= status.activeReminder.unlockAt,
              click: (): void => void scheduler.handleAction('complete', status.activeReminder!.id)
            },
            {
              label: '稍后提醒',
              enabled: Date.now() >= status.activeReminder.snoozeAllowedAt,
              click: (): void => void scheduler.handleAction('snooze', status.activeReminder!.id)
            },
            {
              label: '跳过当前提醒',
              click: (): void => void scheduler.handleAction('skip', status.activeReminder!.id)
            }
          ]
        : []),
      { type: 'separator' },
      ...(paused
        ? [
            { label: '恢复提醒', click: (): void => void scheduler.resume() },
            { label: '重新开始计时', click: (): void => void scheduler.restartCycle() }
          ]
        : [
            // '立即休息' and the test buttons are no-ops while a reminder is
            // already up (the scheduler refuses to stack), so surface that by
            // disabling them instead of eating the click.
            { label: '立即休息', enabled: !status.activeReminder, click: (): void => void scheduler.triggerNow() },
            { label: '暂停 30 分钟', click: (): void => void scheduler.pause(30) },
            { label: '暂停 1 小时', click: (): void => void scheduler.pause(60) },
          ]),
      { type: 'separator' },
      { label: `待办：${pendingTodos} 项未完成`, enabled: false },
      { label: '打开工作台', click: (): void => void windows.showWorkbenchWindow('today') },
      { label: '打开设置', click: (): void => windows.showWorkbenchWindow('settings') },
      {
        label: '🐾 切换桌宠',
        submenu: buildPetSubmenuTemplate(settingsStore)
      },
      {
        label: '召回桌宠到当前屏幕',
        click: (): void => {
          windows.bringPetToActiveDisplay();
        }
      },
      {
        label: '重新加载宠物',
        click: (): void => {
          // Best-effort: a pet-window reload must never throw into the tray.
          void windows.loadPetWindowBestEffort().catch((error) => {
            logger.error('reload pet failed from tray', error);
          });
        }
      },
      { type: 'separator' },
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

const handleIpc = (channel: string, handler: (...args: unknown[]) => unknown, allowSender?: (event: Electron.IpcMainInvokeEvent) => boolean): void => {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      console.warn(`[ipc] rejected '${channel}' from untrusted sender`);
      return null;
    }
    if (allowSender && !allowSender(event)) return null;
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
  // A second instance already called app.quit() at module scope; quit() alone
  // is not enough because whenReady can still fire in the dying process. Never
  // start services or touch shared files (settings.json / eyeprotect.db) from
  // a process that does not own the single-instance lock.
  if (!lock) {
    return;
  }
  const settingsStore = new SettingsStore();
  const runtimeStateStore = new RuntimeStateStore(settingsStore.getDataDir());
  // Begin a session BEFORE load() so the new session id owns the restore and
  // every subsequent save()/checkpoint is tagged with it. A crash restore then
  // reads a recent checkpoint from THIS session instead of a stale prior exit.
  runtimeStateStore.beginSession();
  const historyStore = new ReminderHistoryStore(settingsStore.getDataDir());
  // One shared deadline queue for every timed event (breaks, standalone
  // reminders, task reminders, pause expiry).
  // A rolling reminder-trace backs the kernel so a missed reminder can be
  // diagnosed from data instead of guesswork (USERPLAN §四.B).
  const reminderTrace: ReminderTraceSink = new ReminderTrace(settingsStore.getDataDir());
  crashTraceSink = reminderTrace;
  // Errors logged anywhere in the main process land in the rolling trace file,
  // so a packaged build has one on-disk trail to hand over for diagnosis.
  setLoggerSink((level, message, args) => {
    const first = args[0];
    reminderTrace.append({
      t: Date.now(),
      src: 'system',
      event: `log-${level}`,
      data: {
        message,
        detail: first instanceof Error ? first.message : typeof first === 'string' ? first : undefined
      }
    });
  });
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
    manualStart: true,
    getEffectiveIntervals: (settings) => ({ eyeMinutes: settings.eyeIntervalMinutes, walkMinutes: settings.walkIntervalMinutes }),
    getEffectiveMode: () => 'focused',
    onContextNotification: (decision) => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'EyeProtect · 休息提醒',
          body: `${decision.reason ?? '当前会议场景暂不弹窗'}，5 分钟后再次确认。`,
          silent: true
        }).show();
      }
    },
    beforeReminder: async () => ({ action: 'show' }),
    trace: (event, data) =>
      reminderTrace.append({ t: Date.now(), src: 'scheduler', event, data })
  });
  // v1.1 Task Core (USERPLAN §二): SQLite keeps task/project/reminder state
  // independent from settings.json. Task deadlines share the kernel so they
  // participate in the same suspend/resume reconciliation as breaks.
  let allowTaskModelReset = true;
  if (TaskStore.requiresTaskModelReset(settingsStore.getDataDir())) {
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '升级任务数据模型',
      message: 'EyeProtect 1.1 需要升级任务状态模型。',
      detail: '继续前会在数据目录保留数据库快照。取消后应用会进入不写回原数据库的恢复模式。',
      buttons: ['取消并进入恢复模式', '创建快照并升级'],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    });
    allowTaskModelReset = confirmation.response === 1;
  }
  const taskStore = new TaskStore(settingsStore.getDataDir(), { allowTaskModelReset });
  const requireWritableTaskDatabase = <T>(action: () => T): T => {
    if (taskStore.getRecoveryStatus().readOnly) {
      throw new Error('任务数据库处于恢复模式；原数据库未被修改');
    }
    return action();
  };
  const taskService = new TaskService(taskStore, false);
  const taskScheduler = new TaskScheduler(kernel, () => taskService.getTasks().filter((task) => isCurrentTask(task, taskService.getProjects())), Date.now, {
    persist: (events) => taskStore.replaceScheduledEvents('task', events),
    isConsumed: (task) =>
      task.reminderAt !== null && taskStore.isTaskReminderConsumed(task.id, task.reminderAt)
  });
  const activityMonitor = new ActivityMonitor({
    getIdleSeconds: () => process.env.EYEPROTECT_SMOKE === '1' ? 0 : powerMonitor.getSystemIdleTime(),
    naturalBreakMs: () => settingsStore.get().naturalBreakMinutes * 60_000
  });
  activityMonitor.on('inactive', () => kernel.pauseElapsed());
  activityMonitor.on('active', ({ inactiveMs }: ActivityResume) => {
    kernel.resumeElapsed();
    scheduler.handleActivityResume(inactiveMs);
  });
  // Migration happens before any scheduler is armed so imported task and alarm
  // deadlines are visible during the first startup reconciliation.
  if (!taskStore.getRecoveryStatus().readOnly) {
    taskService.migrateFromTodos(settingsStore.get().todos, Date.now(), settingsStore.get().alarms);
    settingsStore.clearLegacyTaskData();
  }
  scheduler.updateTasks([]);
  taskScheduler.arm();
  const windows = new AppWindows(settingsStore, scheduler, () => taskService.getTasks(), () => taskService.getProjects());
  const pomodoro = new PomodoroService(settingsStore.getDataDir(), kernel, {
    taskAvailable: (id) => { const task = taskService.getTask(id); return Boolean(task && task.status === 'open' && isCurrentTask(task, taskService.getProjects())); },
    healthBreakActive: () => Boolean(scheduler.getStatus().activeReminder),
    breakMinutes: () => settingsStore.get().pomodoroBreakMinutes
  });
  const beginHealthRest = (id: string) => {
    const active = scheduler.getStatus().activeReminder;
    if (!active || active.id !== id || typeof active.restStartedAt === 'number') return scheduler.getStatus();
    const state = pomodoro.getState();
    const focusEnded = state.phase === 'focus-finished' || (state.phase === 'focus' && state.remainingMs <= 0);
    const minimumMs = focusEnded ? settingsStore.get().pomodoroBreakMinutes * 60000 : state.phase === 'break' ? state.remainingMs : 0;
    return scheduler.beginRest(id, minimumMs);
  };
  windows.setPomodoroProvider(() => pomodoro.getState());
  pomodoro.on('changed', (state) => windows.broadcastPomodoro(state));
  activityMonitor.on('inactive', () => pomodoro.act('pause'));
  const refreshTasks = (): void => { taskScheduler.arm(); pomodoro.reconcileTask(); };
  taskService.on('task-upserted', (task) => { windows.broadcastTaskUpserted(task); refreshTasks(); });
  taskService.on('task-removed', (id) => { windows.broadcastTaskRemoved(id); refreshTasks(); });
  taskService.on('tasks-replaced', (tasks) => { windows.broadcastTasks(tasks); refreshTasks(); });
  taskService.on('project-upserted', (project) => { windows.broadcastProjectUpserted(project); refreshTasks(); });
  taskService.on('project-removed', (id) => { windows.broadcastProjectRemoved(id); refreshTasks(); });
  taskService.on('projects-replaced', (projects) => { windows.broadcastProjects(projects); refreshTasks(); });
  taskService.on('undo-changed', (state) => windows.broadcastUndo(state));

  const refreshSystemTheme = (): void => windows.refreshWorkbenchTheme();
  nativeTheme.on('updated', refreshSystemTheme);

  // ── AppHealth (USERPLAN §二十八) ──────────────────────────────────────────
  // Derive subsystem health from real state so the renderer can explain *why* an
  // action is unavailable. Database health comes straight from the store's
  // recovery status; notification availability from Electron's Notification API.
  // The scheduler is treated as healthy here; a future signal may downgrade it.
  const getAppHealth = (): AppHealth => {
    const recovery = taskStore.getRecoveryStatus();
    // `readOnly` is the in-memory recovery path: the database IS open and
    // usable, it just does not persist writes back to the original file. That is
    // "degraded", not "unavailable" — the two states carry different recovery
    // copy in the banner, so they must not be conflated (USERPLAN §十七/§二十八).
    return {
      database: recovery.readOnly ? 'degraded' : 'healthy',
      scheduler: 'healthy',
      notification: Notification.isSupported() ? 'available' : 'unavailable'
    };
  };

  /** Push health to all windows; debounced so a flurry of changes coalesces. */
  let healthBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcastAppHealth = (): void => {
    if (healthBroadcastTimer) {
      return;
    }
    healthBroadcastTimer = setTimeout(() => {
      healthBroadcastTimer = null;
      windows.broadcastAppHealth(getAppHealth());
    }, 50);
  };
  // Fallback chain for reminder visibility (USERPLAN §四.B): if the primary
  // AlertWindow renderer crashes, the emergency surface takes over so a reminder
  // is never silently dropped while the main process is alive.
  const reminderSurface = new ReminderSurfaceManager(
    (active) =>
      process.env.EYEPROTECT_SMOKE === '1' &&
      process.argv.includes('--eyeprotect-smoke-emergency')
        ? Promise.resolve(false)
        : windows.showReminderOnPrimary(active),
    (action, reminderId) => action === 'start' ? beginHealthRest(reminderId) : scheduler.handleAction(action, reminderId),
    () => windows.showWorkbenchWindow('today'),
    (event, data) => reminderTrace.append({ t: Date.now(), src: 'surface', event, data }),
    () => windows.getReminderSurfaceWebContentsId(),
    () => windows.isReminderSurfaceHealthy(),
    () => {
      // Fail-open: no surface could present the reminder, so the dim masks (if
      // any) must come down — an active focused reminder must always satisfy
      // "actionable surface available OR dim masks destroyed".
      console.warn('[surface] all reminder surfaces failed; tearing down dim masks (fail-open)');
      windows.destroyDimMasks();
    }
  );
  const deliveryQueue = new NotificationDeliveryQueue(taskStore, {
    onDelivered: (delivery) => {
      if (delivery.source === 'task') {
        taskStore.consumeTaskReminder(delivery.sourceId, delivery.occurrenceAt);
        taskScheduler.arm();
      }
      windows.broadcastFailedDeliveries(taskStore.getFailedDeliveries());
    },
    onClick: (delivery) => {
      void windows.showWorkbenchWindow('today');
    },
    onFailed: (delivery) => {
      windows.broadcastFailedDeliveries(taskStore.getFailedDeliveries());
      void windows.showWorkbenchWindow('today');
    }
  });
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
          void windows.showWorkbenchWindow('today');
        },
        todos: () => {
          void windows.showWorkbenchWindow('today');
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

  // OS lifecycle: sleep/wake/unlock are reconciled by the scheduler with an
  // idle-aware grace period instead of dumping a backlog of overdue popups.
  // The kernel drops its timer on suspend (it would misfire on wake) and
  // reconciles every registered service on resume/unlock — so alarms, which
  // previously ran an independent timer outside this loop, now wake alongside
  // the break scheduler (fixes the "alarm ignores suspend/resume" gap).
  powerMonitor.on('suspend', () => {
    activityMonitor.suspend();
    pomodoro.act('pause');
    kernel.suspend();
    scheduler.suspend();
    taskScheduler.suspend();
  });
  powerMonitor.on('resume', () => {
    activityMonitor.resume(powerMonitor.getSystemIdleTime());
    kernel.resume(powerMonitor.getSystemIdleTime() * 1000);
    taskScheduler.resume();
  });
  powerMonitor.on('lock-screen', () => activityMonitor.lock());
  powerMonitor.on('unlock-screen', () => {
    activityMonitor.unlock();
    scheduler.handleScreenUnlock();
    kernel.reconcile();
    taskScheduler.arm();
  });

  handleSecondInstance = () => {
    app.focus({ steal: true });
    windows.showWorkbenchWindow('today');
  };

  // If any renderer (including the alert window) crashes while a reminder is on
  // screen, fall back to the emergency surface instead of leaving the user with
  // an invisible, un-dismissable reminder. 'render-process-gone' covers crashes
  // and OOM kills; 'child-process-gone' covers GPU-process losses that also
  // blank a window.
  const onRendererGone = (webContentsId?: number) => {
    const active = scheduler.getStatus().activeReminder;
    if (active) {
      reminderSurface.handleRendererGone(active, webContentsId);
    }
  };
  app.on('render-process-gone', (_event, webContents) => onRendererGone(webContents.id));
  app.on('child-process-gone', () => onRendererGone());
  app.on('web-contents-created', (_event, contents) => {
    contents.on('unresponsive', () => onRendererGone(contents.id));
    contents.on('did-fail-load', () => onRendererGone(contents.id));
  });

  // Domain-scoped reactions: a preference save only touches the subsystems
  // whose inputs actually changed. Todo/alarm mutations never reach this
  // handler at all (they emit their own events), so checking off a todo no
  // longer re-syncs the startup shortcut, resizes the pet or re-schedules.
  settingsStore.onChanged(({ settings, previous }) => {
    if (
      settings.eyeEnabled !== previous.eyeEnabled || settings.walkEnabled !== previous.walkEnabled ||
      settings.eyeRestSeconds !== previous.eyeRestSeconds || settings.walkRestSeconds !== previous.walkRestSeconds ||
      settings.eyeIntervalMinutes !== previous.eyeIntervalMinutes ||
      settings.walkIntervalMinutes !== previous.walkIntervalMinutes ||
      settings.snoozeMinutes !== previous.snoozeMinutes ||
      settings.naturalBreakMinutes !== previous.naturalBreakMinutes ||
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
    }
    if (
      settings.petScale !== previous.petScale ||
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
    if (active) reminderSurface.update(active);
    if (typeof active?.restStartedAt === 'number') pomodoro.beginHealthRest();
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

  taskScheduler.on('task-reminder', (due: Task[]) => {
    for (const task of due) {
      deliveryQueue.enqueue(
        'task',
        task.id,
        task.reminderAt!,
        'EyeProtect · 任务提醒',
        `该处理：「${task.title}」`
      );
    }
  });

  const publishApplicationState = (): void => {
    const tasks = taskService.getTasks();
    scheduler.updateTasks([]);
    taskScheduler.arm();
    windows.broadcastSettings(settingsStore.get());
    windows.broadcastReminderStatus(scheduler.getStatus());
    windows.broadcastTasks(tasks);
    windows.broadcastProjects(taskService.getProjects());
    windows.broadcastActiveTask(taskService.getActiveTaskId());
    windows.broadcastHotkeyStatus(hotkeyStatus);
    // Health is derived, not part of any domain push, so seed it explicitly —
    // otherwise a recovery-mode launch would show no banner until the next
    // successful task/character write.
    windows.broadcastAppHealth(getAppHealth());
  };

  // Every handler is sender-verified (handleIpc) and coerces its arguments:
  // renderers are trusted code, but IPC payloads are still an external input.
  handleIpc('settings:get', () => settingsStore.get());
  handleIpc('settings:save', (payload) => settingsStore.save(asPartialSettings(payload)));
  handleIpc('runtime:get', () => getRuntimeInfo(settingsStore));
  handleIpc('app:health:get', () => getAppHealth());
  // A renderer-only reload cannot exit database-recovery mode: the main-process
  // TaskStore is constructed once at startup. A full restart is required, so
  // this relaunches the app and quits the current instance.
  handleIpc('app:relaunch', () => {
    app.relaunch();
    app.quit();
  });
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
  handleIpc('delivery:failed:list', () => taskStore.getFailedDeliveries());
  handleIpc('delivery:failed:retry', (id) => {
    requireWritableTaskDatabase(() => taskStore.retryFailedDelivery(asString(id)));
    void deliveryQueue.pump();
    const notices = taskStore.getFailedDeliveries();
    windows.broadcastFailedDeliveries(notices);
    return notices;
  });
  handleIpc('delivery:failed:dismiss', (id) => {
    const deliveryId = asString(id);
    const notice = taskStore.getFailedDeliveries().find((entry) => entry.id === deliveryId);
    requireWritableTaskDatabase(() => taskStore.dismissFailedDelivery(deliveryId));
    // The user saw the durable in-app surface and explicitly dismissed it, so
    // this occurrence is now closed just like a visible native delivery.
    if (notice?.source === 'task') {
      taskStore.consumeTaskReminder(notice.sourceId, notice.occurrenceAt);
      taskScheduler.arm();
    }
    const notices = taskStore.getFailedDeliveries();
    windows.broadcastFailedDeliveries(notices);
    return notices;
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
        standaloneReminders: taskStore.getStandaloneReminders(),
        activeTaskId: taskService.getActiveTaskId(),
        taskReminderOccurrences: taskStore.getTaskReminderOccurrences(),
        dailyTaskPlans: taskStore.getAllDailyTaskPlans(),
        timeBlocks: taskStore.getTimeBlocks(),
        projectSections: taskStore.getAllProjectSections(),
        focusSessions: taskStore.getFocusSessions(),
        taskCheckpoints: taskStore.getTaskCheckpoints(),
        dailyReflections: taskStore.getDailyReflections()
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
      requireWritableTaskDatabase(() => undefined);
      const currentBackupText = createBackup(
        settingsStore.get(),
        historyStore.getEvents(),
        app.getVersion(),
        Date.now(),
        {
          tasks: taskService.getTasks(),
          projects: taskService.getProjects(),
          standaloneReminders: taskStore.getStandaloneReminders(),
          activeTaskId: taskService.getActiveTaskId(),
          taskReminderOccurrences: taskStore.getTaskReminderOccurrences(),
            dailyTaskPlans: taskStore.getAllDailyTaskPlans(),
          timeBlocks: taskStore.getTimeBlocks(),
          projectSections: taskStore.getAllProjectSections(),
          focusSessions: taskStore.getFocusSessions(),
          taskCheckpoints: taskStore.getTaskCheckpoints(),
          dailyReflections: taskStore.getDailyReflections()
        }
      );
      const rollbackPath = join(settingsStore.getDataDir(), `import-rollback-${Date.now()}.json`);
      writeFileSync(rollbackPath, currentBackupText, 'utf8');
      const previous = parseBackup(currentBackupText);
      const applyBackup = (candidate: typeof backup): void => {
        // Apply the relational domain before preferences/history. If any step
        // rejects, the catch below restores the complete pre-import snapshot.
        // Order matters: projects → sections → tasks (tasks carry section FKs)
        // → plans/blocks (need tasks) → focus sessions (need tasks and blocks).
        taskStore.replaceProjects(candidate.projects);
        taskStore.replaceAllProjectSections(candidate.projectSections);
        taskStore.replaceAll(candidate.tasks);
        taskStore.replaceAllDailyTaskPlans(candidate.dailyTaskPlans);
        taskStore.replaceAllTimeBlocks(candidate.timeBlocks);
        taskStore.replaceAllFocusSessions(candidate.focusSessions);
        taskStore.replaceAllTaskCheckpoints(candidate.taskCheckpoints);
        taskStore.replaceAllDailyReflections(candidate.dailyReflections);
        taskStore.replaceTaskReminderOccurrences(candidate.taskReminderOccurrences);
        taskStore.replaceStandaloneReminders(candidate.standaloneReminders);
        taskStore.setActiveTaskId(candidate.activeTaskId);
        const next = settingsStore.save(candidate.settings);
        historyStore.replaceEvents(candidate.reminderHistory, next);
      };
      try {
        applyBackup(backup);
      pomodoro.act('stop');
      } catch (importError) {
        try {
          applyBackup(previous);
        } catch {
          throw new Error(`导入失败，自动回滚也失败；请保留 ${rollbackPath}`);
        }
        throw importError;
      }
      publishApplicationState();
      return { success: true, message: '备份已导入，设置已经生效；导入前快照已保留' };
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
    requireWritableTaskDatabase(() => undefined);
    settingsStore.save(DEFAULT_SETTINGS);
    taskStore.replaceAll([]);
    taskStore.replaceProjects([]);
    taskStore.replaceAllDailyTaskPlans([]);
    taskStore.replaceAllTimeBlocks([]);
    taskStore.replaceAllFocusSessions([]);
    taskStore.replaceAllTaskCheckpoints([]);
    taskStore.replaceAllDailyReflections([]);
    taskStore.replaceStandaloneReminders([]);
    taskStore.setActiveTaskId(null);
    publishApplicationState();
    return { success: true, message: '已恢复默认设置' };
  });
  handleIpc('data:open-directory', async () => {
    const dataDir = settingsStore.getDataDir();
    try {
      mkdirSync(dataDir, { recursive: true });
      const error = await shell.openPath(dataDir);
      return error
        ? { success: false, message: error }
        : { success: true, message: '已打开数据目录' };
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开数据目录';
      return { success: false, message };
    }
  });
  handleIpc('pet:custom:open-folder', async (subfolder) => {
    const baseDir = join(settingsStore.getDataDir(), 'custom-pet');
    const customDir =
      typeof subfolder === 'string' && subfolder.trim().length > 0
        ? join(baseDir, subfolder.trim())
        : baseDir;
    try {
      if (!existsSync(customDir)) {
        mkdirSync(customDir, { recursive: true });
      }
      const readmePath = join(baseDir, '使用说明.txt');
      if (!existsSync(readmePath)) {
        const readme =
          'EyeProtect 自定义桌宠说明文档\r\n\r\n' +
          '【1. 如何添加多种动物？】\r\n' +
          '在当前 custom-pet 文件夹下新建子文件夹即可，每个子文件夹对应一个独立角色，例如：\r\n' +
          '  custom-pet/\r\n' +
          '    ├── 柴犬/\r\n' +
          '    │    ├── idle.gif\r\n' +
          '    │    ├── click1.gif\r\n' +
          '    │    └── click2.gif\r\n' +
          '    └── 卡皮巴拉/\r\n' +
          '         ├── idle.gif\r\n' +
          '         ├── click.gif\r\n' +
          '         └── sleep.gif\r\n' +
          '创建后，在工作台「设置 - 桌面外观」中将直接列出所有角色，点击即可自由切换！\r\n\r\n' +
          '【2. 如何让点击（Click）触发多种随机动作？】\r\n' +
          '只要在角色文件夹中放入多个以 click 开头的动图即可，点击时会自动随机抽取播放：\r\n' +
          '  - click1.gif（例如开心跳跃）\r\n' +
          '  - click2.gif（例如冒爱心）\r\n' +
          '  - click3.gif（例如打哈欠）\r\n' +
          '  - 或 interact_*.gif\r\n' +
          '每次鼠标单击桌宠时，都会在这些动作中随机播放一个！\r\n\r\n' +
          '【3. 动作文件命名规范】\r\n' +
          '- idle*.gif / idle*.png：平时常驻桌面的待机/呼吸循环\r\n' +
          '- click*.gif / interact*.gif：鼠标单击桌宠时的随机互动动作\r\n' +
          '- fidget*.gif / action*.gif：闲置时每隔十几秒自发触发的随机小动作（如伸懒腰、打滚）\r\n' +
          '- sleep*.gif / rest*.gif：护眼休息提醒期间播放的休息动作\r\n';
        writeFileSync(readmePath, readme, 'utf8');
      }
      const error = await shell.openPath(customDir);
      return error
        ? { success: false, message: error }
        : { success: true, message: '已打开自定义桌宠目录' };
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开自定义桌宠目录';
      return { success: false, message };
    }
  });
  handleIpc('pet:custom:get-assets', (requestedTheme) => {
    const baseDir = join(settingsStore.getDataDir(), 'custom-pet');
    if (!existsSync(baseDir)) {
      return {
        hasCustomPet: false,
        activeTheme: null,
        availableThemes: [],
        idles: [],
        clicks: [],
        fidgets: [],
        sleeps: []
      };
    }

    const isImageFile = (filename: string): boolean => {
      const lower = filename.toLowerCase();
      return lower.endsWith('.gif') || lower.endsWith('.png') || lower.endsWith('.webp') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
    };

    const toDataUrl = (filePath: string): string | null => {
      try {
        const buf = readFileSync(filePath);
        const lower = filePath.toLowerCase();
        const ext = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/gif';
        return `data:${ext};base64,${buf.toString('base64')}`;
      } catch {
        return null;
      }
    };

    const loadDirAssets = (dirPath: string) => {
      if (!existsSync(dirPath)) return { idles: [], clicks: [], fidgets: [], sleeps: [] };
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        const idles: string[] = [];
        const clicks: string[] = [];
        const fidgets: string[] = [];
        const sleeps: string[] = [];

        for (const entry of entries) {
          if (!entry.isFile() || !isImageFile(entry.name)) continue;
          const lower = entry.name.toLowerCase();
          const fullPath = join(dirPath, entry.name);
          const dataUrl = toDataUrl(fullPath);
          if (!dataUrl) continue;

          if (lower.startsWith('click') || lower.startsWith('interact') || lower.startsWith('tap')) {
            clicks.push(dataUrl);
          } else if (lower.startsWith('fidget') || lower.startsWith('action') || lower.startsWith('play')) {
            fidgets.push(dataUrl);
          } else if (lower.startsWith('sleep') || lower.startsWith('rest')) {
            sleeps.push(dataUrl);
          } else if (lower.startsWith('idle') || lower.startsWith('stand') || lower.startsWith('stay')) {
            idles.push(dataUrl);
          } else {
            idles.push(dataUrl);
          }
        }
        return { idles, clicks, fidgets, sleeps };
      } catch {
        return { idles: [], clicks: [], fidgets: [], sleeps: [] };
      }
    };

    const availableThemes: CustomPetThemeInfo[] = [];

    const rootAssets = loadDirAssets(baseDir);
    if (rootAssets.idles.length > 0 || rootAssets.clicks.length > 0 || rootAssets.fidgets.length > 0 || rootAssets.sleeps.length > 0) {
      availableThemes.push({
        id: 'default',
        name: THEME_DISPLAY_NAMES.default,
        preview: rootAssets.idles[0] ?? rootAssets.clicks[0] ?? rootAssets.fidgets[0] ?? null
      });
    }

    try {
      const dirEntries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (entry.isDirectory()) {
          const subDirPath = join(baseDir, entry.name);
          const subAssets = loadDirAssets(subDirPath);
          if (subAssets.idles.length > 0 || subAssets.clicks.length > 0 || subAssets.fidgets.length > 0 || subAssets.sleeps.length > 0) {
            availableThemes.push({
              id: entry.name,
              name: THEME_DISPLAY_NAMES[entry.name] ?? entry.name,
              preview: subAssets.idles[0] ?? subAssets.clicks[0] ?? subAssets.fidgets[0] ?? null
            });
          }
        }
      }
    } catch {
      // ignore
    }

    const currentThemeSetting =
      typeof requestedTheme === 'string'
        ? requestedTheme
        : settingsStore.get().customPetTheme;

    let activeDir: string | null = null;
    let resolvedActiveTheme: string | null = null;

    if (currentThemeSetting) {
      const match = availableThemes.find((t) => t.id === currentThemeSetting);
      if (match) {
        resolvedActiveTheme = match.id;
        activeDir = match.id === 'default' ? baseDir : join(baseDir, match.id);
      }
    }

    const activeAssets = activeDir ? loadDirAssets(activeDir) : { idles: [], clicks: [], fidgets: [], sleeps: [] };
    const hasCustomPet = Boolean(
      activeAssets.idles.length > 0 ||
      activeAssets.clicks.length > 0 ||
      activeAssets.fidgets.length > 0 ||
      activeAssets.sleeps.length > 0
    );

    return {
      hasCustomPet,
      activeTheme: resolvedActiveTheme,
      availableThemes,
      idles: activeAssets.idles,
      clicks: activeAssets.clicks,
      fidgets: activeAssets.fidgets,
      sleeps: activeAssets.sleeps
    };
  });
  handleIpc('data:recovery-info', () => {
    const dataDir = settingsStore.getDataDir();
    const corruptBackups = existsSync(dataDir)
      ? readdirSync(dataDir)
          .filter((name) => name.includes('.corrupt-') || name.includes('.recovery-') || name.includes('.pre-model-reset-'))
          .sort()
      : [];
    return { dataDir, corruptBackups, taskDatabase: taskStore.getRecoveryStatus() };
  });

  // ── v1.1 Task Core IPC (USERPLAN §二) ───────────────────────────────────────
  // All handlers are sender-verified (handleIpc) and coerce their arguments.
  // Every mutation flows through TaskService, which re-emits domain events that
  // the wiring above broadcasts to the workbench and re-arms the task scheduler.
  // Pet window badge: a count, not the task list (perf pass). The pet is
  // the only always-resident renderer, so it must not rebuild a task Map on
  // every edit elsewhere in the app.
  handleIpc('task:pending-count', () =>
    taskService
      .getTasks()
      .filter((task) => task.status !== 'done' && task.status !== 'archived').length
  );

  handleIpc('task:complete-tree', (id, revisions) => requireWritableTaskDatabase(() => taskService.completeTaskTree(asString(id), revisions && typeof revisions === 'object' && !Array.isArray(revisions) ? revisions as Record<string, number> : {})));
  handleIpc('task:move-step', (id, direction) => { if (direction !== -1 && direction !== 1) throw new Error('无效移动方向'); return requireWritableTaskDatabase(() => taskService.moveStep(asString(id), direction)); });
  handleIpc('task:create-step', (id, title) => requireWritableTaskDatabase(() => taskService.createStep(asString(id), asString(title))));
  handleIpc('reminder:begin-rest', (id) => beginHealthRest(asString(id)));
  handleIpc('task:restore-legacy', (id) => requireWritableTaskDatabase(() => {
    const task = taskService.getTask(asString(id));
    if (task?.projectId) taskService.updateProject(task.projectId, { status: 'active' });
    return taskService.setTaskStatus(asString(id), 'open');
  }));
  handleIpc('data:legacy', () => ({ sections: [
    { title: '已停用的独立提醒', items: taskStore.getStandaloneReminders().map((item) => ({ title: item.label, detail: '已停用；原规则随备份保留' })) },
    { title: '任务旧附加资料', items: taskService.getTasks().filter((t) => t.recurrence || t.plannedAt || t.dueAt || t.tags.length).map((t) => ({ title: t.title, detail: [t.plannedAt ? `原计划：${new Date(t.plannedAt).toLocaleString()}` : '', t.dueAt ? `原截止：${new Date(t.dueAt).toLocaleString()}` : '', t.recurrence ? `重复规则：${t.recurrence.type}（已停用）` : '', t.tags.join('、')].filter(Boolean).join('；') })) },
    { title: '旧每日规划', items: taskStore.getAllDailyTaskPlans().map((p) => ({ title: taskService.getTask(p.taskId)?.title ?? '旧任务', detail: p.localDate })) },
    { title: '历史专注', items: taskStore.getFocusSessions().map((s) => ({ title: taskService.getTask(s.taskId)?.title ?? '旧任务', detail: new Date(s.startedAt).toLocaleString() })) }
  ] }));
  handleIpc('pomodoro:prepare', (id, replace) => pomodoro.prepare(typeof id === 'string' ? id : null, replace === true));
  handleIpc('pomodoro:get', () => pomodoro.getState());
  handleIpc('pomodoro:start', (id, minutes, replace) => {
    const state = pomodoro.start(typeof id === 'string' ? id : null, typeof minutes === 'number' ? minutes : Number.NaN, replace === true);
    settingsStore.save({ pomodoroMinutes: asNumber(minutes, 25) });
    return state;
  });
  handleIpc('pomodoro:action', (action) => {
    if (action !== 'pause' && action !== 'resume' && action !== 'stop' && action !== 'break') throw new Error('无效番茄钟操作');
    return pomodoro.act(action);
  });
  handleIpc('task:list', () => taskService.getTasks());
  handleIpc('task:get', (id) => taskService.getTask(asString(id)));
  handleIpc('task:create', (input) =>
    requireWritableTaskDatabase(() => taskService.createTask(asSimpleTaskInput(input)))
  );
  handleIpc('task:update', (id, input) =>
    requireWritableTaskDatabase(() => taskService.updateTask(asString(id), asSimpleTaskUpdateInput(input)))
  );
  handleIpc('task:set-status', (id, status) =>
    requireWritableTaskDatabase(() => taskService.setTaskStatus(
      asString(id),
      status === 'open' || status === 'done' || status === 'archived'
        ? (status as TaskStatus)
        : 'open'
    ))
  );
  handleIpc('task:delete', (id) => {
    return requireWritableTaskDatabase(() => taskService.deleteTask(asString(id)));
  });
  handleIpc('task:undo:get', () => taskService.getUndoState());
  handleIpc('task:undo', (operationId) =>
    requireWritableTaskDatabase(() => taskService.undo(asString(operationId)))
  );
  handleIpc('task:active:get', () => taskService.getActiveTaskId());
  handleIpc('task:active:set', (id) =>
    requireWritableTaskDatabase(() => taskService.setActiveTask(typeof id === 'string' ? id : null))
  );
  handleIpc('project:list', () => taskService.getProjects());
  handleIpc('project:get', (id) => taskService.getProject(asString(id)));
  handleIpc('project:create', (input) =>
    requireWritableTaskDatabase(() => taskService.createProject(asProjectInput(input)))
  );
  handleIpc('project:update', (id, input) =>
    requireWritableTaskDatabase(() =>
      taskService.updateProject(asString(id), asProjectUpdateInput(input))
    )
  );
  handleIpc('project:delete', (id) =>
    requireWritableTaskDatabase(() => taskService.deleteProject(asString(id)))
  );

  handleIpc('window:workbench:open', (section) =>
    windows.showWorkbenchWindow(
      section === 'settings' || section === 'review' ? section : 'today'
    )
  );
  handleIpc('task:move', (input) => {
    const candidate = (input && typeof input === 'object' ? input : {}) as Partial<TaskMoveInput>;
    const scope = candidate.scope?.type === 'project' && typeof candidate.scope.projectId === 'string'
      ? { type: 'project' as const, projectId: candidate.scope.projectId }
      : { type: 'inbox' as const };
    return requireWritableTaskDatabase(() => taskService.moveTask({
      taskId: asString(candidate.taskId),
      beforeTaskId: typeof candidate.beforeTaskId === 'string' ? candidate.beforeTaskId : null,
      scope
    }));
  });
  handleIpc('window:workbench:close', () => windows.closeWorkbenchWindow());
  handleIpc('window:workbench:section', () => windows.getWorkbenchSection());
  handleIpc('window:pet:artwork-bounds', (bounds) => windows.reportPetArtworkBounds(bounds), (event) => windows.isSurfaceSender('pet', event.sender.id));
  handleIpc('window:bubble:height', (height) => windows.reportBubbleHeight(height), (event) => windows.isSurfaceSender('bubble', event.sender.id));
  handleIpc('window:pet:move', (value) => {
    const position = value && typeof value === 'object'
      ? value as { x?: unknown; y?: unknown }
      : {};
    const x = asNumber(position.x, Number.NaN);
    const y = asNumber(position.y, Number.NaN);
    return Number.isFinite(x) && Number.isFinite(y)
      ? windows.movePetWindow({ x, y })
      : null;
  });
  handleIpc('window:pet:toggle-visibility', () => windows.togglePetVisibility());
  handleIpc('window:pet:recall', () => windows.bringPetToActiveDisplay());
  handleIpc('window:pet:context-menu', () => {
    const petWin = windows.getPetWindow();
    if (!petWin) return;
    const status = scheduler.getStatus();
    const paused = status.pausedUntil !== null && status.pausedUntil > Date.now();
    const settings = settingsStore.get();
    const pomodoroState = pomodoro.getState();

    const menu = Menu.buildFromTemplate([
      {
        label: '🍵 立即休息',
        enabled: !status.activeReminder,
        submenu: [
          { label: '护眼休息', click: () => void scheduler.triggerTest('eye') },
          { label: '走动休息', click: () => void scheduler.triggerTest('walk') },
          { label: '合并提醒', click: () => void scheduler.triggerTest('combined') }
        ]
      },
      {
        label: paused ? '▶ 恢复提醒' : '⏸ 暂停提醒',
        submenu: paused
          ? [
              { label: '立即恢复', click: () => void scheduler.resume() },
              { label: '重新开始计时', click: () => void scheduler.restartCycle() }
            ]
          : [
              { label: '暂停 30 分钟', click: () => void scheduler.pause(30) },
              { label: '暂停 1 小时', click: () => void scheduler.pause(60) },
              { label: '暂停至明天', click: () => void scheduler.pause(1440) }
            ]
      },
      {
        label: pomodoroState.phase === 'focus' ? '⏹ 停止专注' : '⏱ 开始专注 (25分钟)',
        click: () => {
          if (pomodoroState.phase === 'focus') {
            void pomodoro.act('stop');
          } else {
            void pomodoro.start(null, settings.pomodoroMinutes || 25, true);
          }
        }
      },
      { type: 'separator' },
      {
        label: '🐾 切换桌宠',
        submenu: buildPetSubmenuTemplate(settingsStore)
      },
      {
        label: '桌宠小动作',
        type: 'checkbox',
        checked: settings.petMotion,
        click: () => void settingsStore.save({ petMotion: !settings.petMotion })
      },
      { type: 'separator' },
      {
        label: '📋 打开工作台',
        submenu: [
          { label: '待办任务', click: () => void windows.showWorkbenchWindow('today') },
          { label: '完成记录', click: () => void windows.showWorkbenchWindow('review') },
          { label: '设置', click: () => void windows.showWorkbenchWindow('settings') }
        ]
      },
      {
        label: '🎯 召回桌宠到当前屏幕',
        click: () => { windows.bringPetToActiveDisplay(); }
      },
      {
        label: '👁 隐藏桌宠 (可在托盘唤醒)',
        click: () => { windows.togglePetVisibility(); }
      }
    ]);

    menu.popup({ window: petWin });
  });

  // Start the pet renderer as soon as its IPC surface exists so first paint
  // overlaps the control-plane sync below. The load is async and non-fatal:
  // a pet-window failure is caught+retried inside loadPetWindowBestEffort()
  // and never aborts startup, so the scheduler/tray below still start
  // regardless (the pet is best-effort eye-candy, not a dependency).
  void windows.loadPetWindowBestEffort();

  // The control plane (kernel, scheduler, tray, delivery queue, activity
  // monitor, task work tracker) must start even if the pet renderer fails to
  // load: the pet is best-effort eye-candy, not a scheduling dependency.
  kernel.start();
  scheduler.start();
  runtimeStateStore.startCheckpoint(() => scheduler.serialize());
  activityMonitor.start();
  // Dead-letter recovery: any delivery that reached terminal `failed` in a
  // prior run is reset to `due` so it is retried instead of forgotten.
  taskStore.disableLegacyDeliveries();
  taskStore.reconcileFailedDeliveries();
  // Bounded storage: terminal deliveries older than 30 days are dropped; the
  // dedup key only matters for in-flight rows (see pruneDeliveries).
  taskStore.pruneDeliveries(Date.now(), 30 * 24 * 60 * 60 * 1_000);
  deliveryQueue.start();
  applyGlobalHotkeys(settingsStore.get().hotkeysEnabled);
  createTray(windows, scheduler, settingsStore, () => taskService.getTasks(), beginHealthRest);
  syncStartupShortcut(settingsStore.get());
  startDiagnostics();
  // A break session recovered from a crash (USERPLAN §一.3) is active in the
  // scheduler, but startup never emits 'changed', so the presentation layer
  // would never show it — the reminder would exist only in the tray until some
  // later state change woke it. Present it explicitly right away.
  const recoveredActive = scheduler.getStatus().activeReminder;
  if (recoveredActive) {
    presentedReminderId = recoveredActive.id;
    void reminderSurface.present(recoveredActive);
  }
  if (process.env.EYEPROTECT_SMOKE === '1' && process.argv.includes('--eyeprotect-smoke-pet-failure')) {
    // Keep a renderer control surface available to the packaged fault smoke;
    // the pet itself remains intentionally unavailable.
    windows.showWorkbenchWindow('today');
  }

  // Persist on the way out so a restart resumes the running countdowns
  // instead of silently resetting (or bypassing) them.
  app.on('before-quit', () => {
    pomodoro.dispose();
    runtimeStateStore.stopCheckpoint();
    activityMonitor.stop();
    deliveryQueue.stop();
    // Flush the last ~250ms of trace entries; they are buffered for batching.
    reminderTrace.flush();
    runtimeStateStore.markExiting();
    runtimeStateStore.save(scheduler.serialize());
    taskScheduler.dispose();
    kernel.stop();
    scheduler.stop();
    taskStore.close();
    globalShortcut.unregisterAll();
    nativeTheme.removeListener('updated', refreshSystemTheme);
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
