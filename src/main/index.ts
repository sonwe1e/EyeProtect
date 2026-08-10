import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
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
  CharacterAppearanceMode,
  CharacterMaterial,
  HotkeyAction,
  HotkeyStatus,
  PetAccessory,
  PreAlertAction,
  ReminderAction,
  ReminderKind,
  Settings,
  StandaloneReminderInput,
  Task,
  TaskInput,
  TaskMoveInput,
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
import { ActivityMonitor, type ActivityResume } from './activityMonitor';
import { NotificationDeliveryQueue } from './notificationDelivery';
import { TaskWorkTracker } from './taskWorkTracker';
import { CharacterService } from './characterService';
import { asProjectInput, asProjectUpdateInput } from './ipcProjectInput';

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
      ...(status.activeReminder
        ? [
            { type: 'separator' as const },
            { label: '当前提醒', enabled: false },
            {
              label: '完成当前提醒',
              enabled: Date.now() >= status.activeReminder.unlockAt,
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
            { label: '立即休息', click: (): void => void scheduler.triggerNow() },
            { label: '快速暂停 10 分钟', click: (): void => void scheduler.pause(10) },
            { label: '会议 30 分钟', click: (): void => void scheduler.pause(30) },
            { label: '暂停到下一整点', click: (): void => void scheduler.pause(minutesUntilNextHour()) },
            { label: '暂停 1 小时', click: (): void => void scheduler.pause(60) },
            { label: '今日停用', click: (): void => void scheduler.pause(minutesUntilMidnight()) }
          ]),
      { type: 'separator' },
      { label: `待办：${pendingTodos} 项未完成`, enabled: false },
      { label: '打开工作台', click: (): void => void windows.showWorkbenchWindow('today') },
      { label: '公仔收藏', click: (): void => windows.showWorkbenchWindow('collection') },
      { label: '打开设置', click: (): void => windows.showWorkbenchWindow('settings') },
      {
        label: '重新加载宠物',
        click: (): void => {
          // Best-effort: a pet-window reload must never throw into the tray.
          void windows.loadPetWindowBestEffort().catch((error) => {
            console.error('[tray] reload pet failed:', error);
          });
        }
      },
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
  // Begin a session BEFORE load() so the new session id owns the restore and
  // every subsequent save()/checkpoint is tagged with it. A crash restore then
  // reads a recent checkpoint from THIS session instead of a stale prior exit.
  runtimeStateStore.beginSession();
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
  const taskService = new TaskService(taskStore);
  const characterService = new CharacterService(taskStore);
  characterService.getState();
  const taskWorkTracker = new TaskWorkTracker(taskStore, (id) => taskService.getTask(id));
  const taskScheduler = new TaskScheduler(kernel, () => taskService.getTasks(), Date.now, {
    persist: (events) => taskStore.replaceScheduledEvents('task', events),
    isConsumed: (task) =>
      task.reminderAt !== null && taskStore.isTaskReminderConsumed(task.id, task.reminderAt)
  });
  const activityMonitor = new ActivityMonitor({
    getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
    naturalBreakMs: () => settingsStore.get().naturalBreakMinutes * 60_000
  });
  activityMonitor.on('inactive', () => kernel.pauseElapsed());
  activityMonitor.on('inactive', () => taskWorkTracker.pause());
  activityMonitor.on('active', ({ inactiveMs }: ActivityResume) => {
    kernel.resumeElapsed();
    scheduler.handleActivityResume(inactiveMs);
  });
  activityMonitor.on('active', ({ naturalBreak }: ActivityResume) => taskWorkTracker.resume(naturalBreak));
  // Migration happens before any scheduler is armed so imported task and alarm
  // deadlines are visible during the first startup reconciliation.
  if (!taskStore.getRecoveryStatus().readOnly) {
    taskService.migrateFromTodos(settingsStore.get().todos, Date.now(), settingsStore.get().alarms);
    settingsStore.clearLegacyTaskData();
  }
  scheduler.updateTasks(taskService.getTasks());
  const standaloneReminders = new StandaloneReminderService(taskStore, kernel);
  taskScheduler.arm();
  standaloneReminders.arm();
  const windows = new AppWindows(settingsStore, scheduler, () => taskService.getTasks());
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
    (action, reminderId) => scheduler.handleAction(action, reminderId),
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
      } else if (delivery.source === 'standalone') {
        standaloneReminders.acknowledgeDelivery(delivery.sourceId, delivery.occurrenceAt);
      }
      windows.broadcastFailedDeliveries(taskStore.getFailedDeliveries());
    },
    onClick: (delivery) => {
      void windows.showWorkbenchWindow(delivery.source === 'standalone' ? 'reminders' : 'today');
    },
    onFailed: (delivery) => {
      windows.broadcastFailedDeliveries(taskStore.getFailedDeliveries());
      void windows.showWorkbenchWindow(delivery.source === 'standalone' ? 'reminders' : 'today');
    }
  });
  taskWorkTracker.on('timebox', (task: Task) => {
    deliveryQueue.enqueue(
      'timebox',
      task.id,
      Date.now(),
      'EyeProtect · 预计时间已到',
      `「${task.title}」已达到预计用时，可以决定继续或完成。`
    );
  });
  taskWorkTracker.on('changed', (summary) => windows.broadcastTaskWork(summary));
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
    activityMonitor.suspend();
    kernel.suspend();
    scheduler.suspend();
    taskScheduler.suspend();
    standaloneReminders.suspend();
  });
  powerMonitor.on('resume', () => {
    activityMonitor.resume(powerMonitor.getSystemIdleTime());
    kernel.resume(powerMonitor.getSystemIdleTime() * 1000);
    taskScheduler.resume();
    standaloneReminders.resume();
  });
  powerMonitor.on('lock-screen', () => activityMonitor.lock());
  powerMonitor.on('unlock-screen', () => {
    activityMonitor.unlock();
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
      broadcastHistory();
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
    if (active) {
      taskWorkTracker.pause();
    } else if (activityMonitor.getState() === 'active') {
      taskWorkTracker.resume(false);
    }
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
  standaloneReminders.on('fired', (reminder, fireAt) => {
    windows.broadcastStandaloneReminderFired(reminder);
    // Use the scheduled fireAt (not Date.now()) as the occurrence key so a
    // crash-replay re-fire dedupes on the same (source, id, occurrence_at)
    // instead of recording a brand-new occurrence every restart.
    deliveryQueue.enqueue(
      'standalone',
      reminder.id,
      fireAt,
      reminder.label || 'EyeProtect 提醒',
      '时间到了。点击打开工作台查看。'
    );
  });
  historyStore.onChanged(broadcastHistory);

  // v1.1 Task Core events → renderer. The workbench subscribes to these push
  // channels via the preload bridge; other windows ignore them.
  // USERPLAN 1.2 PR2: `tasks-changed` stays an internal main-process signal
  // (scheduler/health); renderers receive per-entity deltas, with the full
  // list reserved for bulk `*-replaced` operations (undo, import, migration).
  taskService.on('tasks-changed', (tasks: Task[]) => {
    scheduler.updateTasks(tasks);
    taskScheduler.arm();
  });
  taskService.on('tasks-replaced', (tasks: Task[]) => {
    windows.broadcastTasks(tasks);
  });
  taskService.on('task-upserted', (task: Task) => {
    windows.broadcastTaskUpserted(task);
  });
  taskService.on('task-removed', (taskId: string) => {
    windows.broadcastTaskRemoved(taskId);
  });
  taskService.on('projects-replaced', (projects: Project[]) => {
    windows.broadcastProjects(projects);
  });
  taskService.on('project-upserted', (project: Project) => {
    windows.broadcastProjectUpserted(project);
  });
  taskService.on('project-removed', (projectId: string) => {
    windows.broadcastProjectRemoved(projectId);
  });
  taskService.on('active-task-changed', (id: string | null) => {
    taskWorkTracker.setActiveTask(id);
    windows.broadcastActiveTask(id);
  });
  taskService.on('undo-changed', (state) => windows.broadcastUndo(state));
  characterService.on('changed', (state) => windows.broadcastCharacterCollection(state));
  // Database health can flip independently of domain data (e.g. a late
  // storage error). Re-evaluate on the next tick after any domain change and
  // when the store reports a recovery status change.
  taskService.on('tasks-changed', () => broadcastAppHealth());
  characterService.on('changed', () => broadcastAppHealth());

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
      taskService.getTasks().filter((task) =>
        task.remindOnBreak && (task.context === 'away' || task.context === 'any')
      )
    );
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
    scheduler.updateTasks(tasks);
    taskScheduler.arm();
    standaloneReminders.arm();
    windows.broadcastSettings(settingsStore.get());
    windows.broadcastReminderStatus(scheduler.getStatus());
    windows.broadcastTasks(tasks);
    windows.broadcastProjects(taskService.getProjects());
    windows.broadcastActiveTask(taskService.getActiveTaskId());
    windows.broadcastStandaloneReminders(standaloneReminders.list());
    windows.broadcastCharacterCollection(characterService.getState());
    windows.broadcastHotkeyStatus(hotkeyStatus);
    // Health is derived, not part of any domain push, so seed it explicitly —
    // otherwise a recovery-mode launch would show no banner until the next
    // successful task/character write.
    windows.broadcastAppHealth(getAppHealth());
    broadcastHistory();
  };

  // Every handler is sender-verified (handleIpc) and coerces its arguments:
  // renderers are trusted code, but IPC payloads are still an external input.
  handleIpc('settings:get', () => settingsStore.get());
  handleIpc('settings:save', (payload) => settingsStore.save(asPartialSettings(payload)));
  handleIpc('character:get', () => characterService.getState());
  handleIpc('character:collect', () =>
    requireWritableTaskDatabase(() => characterService.collectCandidate())
  );
  handleIpc('character:discard', () =>
    requireWritableTaskDatabase(() => characterService.discardCandidate())
  );
  handleIpc('character:rename', (id, name) =>
    requireWritableTaskDatabase(() => characterService.rename(asString(id), asString(name)))
  );
  handleIpc('character:delete', (id) =>
    requireWritableTaskDatabase(() => characterService.delete(asString(id)))
  );
  handleIpc('character:favorite', (id, favorite) =>
    requireWritableTaskDatabase(() => characterService.setFavorite(asString(id), favorite === true))
  );
  handleIpc('character:appearance', (mode, id) => {
    const normalizedMode: CharacterAppearanceMode = mode === 'pinned' ? 'pinned' : 'daily-random';
    return requireWritableTaskDatabase(() =>
      characterService.setAppearance(normalizedMode, typeof id === 'string' ? id : null)
    );
  });
  handleIpc('character:material', (id, material) => {
    const normalized: CharacterMaterial =
      material === 'glow' || material === 'plush' || material === 'candy' || material === 'cosmic'
        ? material
        : 'paper';
    return requireWritableTaskDatabase(() => characterService.setMaterial(asString(id), normalized));
  });
  handleIpc('character:accessory', (id, accessory) => {
    const normalized: PetAccessory =
      accessory === 'cup' || accessory === 'glasses' || accessory === 'leaf' ? accessory : 'none';
    return requireWritableTaskDatabase(() => characterService.setAccessory(asString(id), normalized));
  });
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
  handleIpc('standalone-reminder:list', () => standaloneReminders.list());
  handleIpc('standalone-reminder:create', (input) => {
    const normalized = asStandaloneReminderInput(input);
    return normalized
      ? requireWritableTaskDatabase(() => standaloneReminders.create(normalized))
      : standaloneReminders.list();
  });
  handleIpc('standalone-reminder:update', (id, input) => {
    return requireWritableTaskDatabase(() =>
      standaloneReminders.update(asString(id), asStandaloneReminderUpdate(input))
    );
  });
  handleIpc('standalone-reminder:delete', (id) =>
    requireWritableTaskDatabase(() => standaloneReminders.remove(asString(id)))
  );
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
    } else if (notice?.source === 'standalone') {
      standaloneReminders.acknowledgeDelivery(notice.sourceId, notice.occurrenceAt);
    }
    const notices = taskStore.getFailedDeliveries();
    windows.broadcastFailedDeliveries(notices);
    return notices;
  });
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
        activeTaskId: taskService.getActiveTaskId(),
        taskReminderOccurrences: taskStore.getTaskReminderOccurrences(),
        characterCollection: characterService.getState(),
        dailyTaskPlans: taskStore.getAllDailyTaskPlans(),
        timeBlocks: taskStore.getTimeBlocks(),
        projectSections: taskStore.getAllProjectSections(),
        focusSessions: taskStore.getFocusSessions()
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
          standaloneReminders: standaloneReminders.list(),
          activeTaskId: taskService.getActiveTaskId(),
          taskReminderOccurrences: taskStore.getTaskReminderOccurrences(),
          characterCollection: characterService.getState(),
          dailyTaskPlans: taskStore.getAllDailyTaskPlans(),
          timeBlocks: taskStore.getTimeBlocks(),
          projectSections: taskStore.getAllProjectSections(),
          focusSessions: taskStore.getFocusSessions()
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
        taskStore.replaceTaskReminderOccurrences(candidate.taskReminderOccurrences);
        taskStore.replaceStandaloneReminders(candidate.standaloneReminders);
        taskStore.setActiveTaskId(candidate.activeTaskId);
        characterService.replaceState(candidate.characterCollection);
        const next = settingsStore.save(candidate.settings);
        historyStore.replaceEvents(candidate.reminderHistory, next);
      };
      try {
        applyBackup(backup);
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
    taskStore.replaceStandaloneReminders([]);
    taskStore.setActiveTaskId(null);
    characterService.replaceState(null);
    publishApplicationState();
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
          .filter((name) => name.includes('.corrupt-') || name.includes('.recovery-') || name.includes('.pre-model-reset-'))
          .sort()
      : [];
    return { dataDir, corruptBackups, taskDatabase: taskStore.getRecoveryStatus() };
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
      remindOnBreak:
        typeof candidate.remindOnBreak === 'boolean' ? candidate.remindOnBreak : undefined,
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
    if (typeof candidate.title !== 'string') {
      delete input.title;
    }
    for (const key of Object.keys(input) as Array<keyof TaskUpdateInput>) {
      if (input[key] === undefined) {
        delete input[key];
      }
    }
    if (
      candidate.status === 'open' || candidate.status === 'done' || candidate.status === 'archived'
    ) {
      input.status = candidate.status;
    }
    if (typeof candidate.sortOrder === 'number' && Number.isInteger(candidate.sortOrder) && candidate.sortOrder >= 0) {
      input.sortOrder = candidate.sortOrder;
    }
    return input;
  };

  handleIpc('task:list', () => taskService.getTasks());
  handleIpc('task:get', (id) => taskService.getTask(asString(id)));
  handleIpc('task:create', (input) =>
    requireWritableTaskDatabase(() => taskService.createTask(asTaskInput(input)))
  );
  handleIpc('task:update', (id, input) =>
    requireWritableTaskDatabase(() => taskService.updateTask(asString(id), asTaskUpdateInput(input)))
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
  handleIpc('task:work-summary', () => taskWorkTracker.getSummary());
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
      section === 'settings' || section === 'reminders' || section === 'collection' ? section : 'today'
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

  // The control plane (kernel, scheduler, tray, delivery queue, activity
  // monitor, task work tracker) must start even if the pet renderer fails to
  // load: the pet is best-effort eye-candy, not a scheduling dependency. So the
  // scheduler etc. come first, and the pet window is created last and non-fatally.
  kernel.start();
  scheduler.start();
  runtimeStateStore.startCheckpoint(() => scheduler.serialize());
  activityMonitor.start();
  // Dead-letter recovery: any delivery that reached terminal `failed` in a
  // prior run is reset to `due` so it is retried instead of forgotten.
  taskStore.reconcileFailedDeliveries();
  deliveryQueue.start();
  taskWorkTracker.start(taskService.getActiveTaskId());
  applyGlobalHotkeys(settingsStore.get().hotkeysEnabled);
  createTray(windows, scheduler, settingsStore, () => taskService.getTasks());
  syncStartupShortcut(settingsStore.get());
  startDiagnostics();
  // Best-effort: a pet-window startup failure is caught+retried inside
  // loadPetWindowBestEffort() and never aborts startup.
  void windows.loadPetWindowBestEffort();
  if (process.env.EYEPROTECT_SMOKE === '1' && process.argv.includes('--eyeprotect-smoke-pet-failure')) {
    // Keep a renderer control surface available to the packaged fault smoke;
    // the pet itself remains intentionally unavailable.
    windows.showWorkbenchWindow('today');
  }

  // Persist on the way out so a restart resumes the running countdowns
  // instead of silently resetting (or bypassing) them.
  app.on('before-quit', () => {
    runtimeStateStore.stopCheckpoint();
    activityMonitor.stop();
    deliveryQueue.stop();
    taskWorkTracker.stop();
    runtimeStateStore.markExiting();
    runtimeStateStore.save(scheduler.serialize());
    taskScheduler.dispose();
    standaloneReminders.dispose();
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
