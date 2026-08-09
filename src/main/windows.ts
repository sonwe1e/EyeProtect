import { app, BrowserWindow, screen } from 'electron';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActiveReminder,
  Alarm,
  CareStatus,
  HotkeyStatus,
  PanelTab,
  Project,
  ReminderStatus,
  RuntimeInfo,
  Settings,
  StandaloneReminder,
  Task,
  TodoItem,
  WeeklyReport
} from '../shared/types';
import type { ReminderScheduler } from './reminders';
import type { SettingsStore } from './settings';
import { getDisplayLayoutKey } from './displayLayout';
import { getAlertBounds } from './windowBounds';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(moduleDir, '../preload/index.cjs');
const IDLE_SIZE = 160;
const PANEL_SIZE = { width: 344, height: 496 } as const;
const TODO_BUBBLE_SIZE = { width: 220, height: 150 } as const;
const PRE_ALERT_BUBBLE_SIZE = { width: 300, height: 172 } as const;
const GENTLE_BUBBLE_SIZE = { width: 300, height: 224 } as const;
const GENTLE_COMBINED_BUBBLE_SIZE = { width: 320, height: 292 } as const;
/** How long the bubble stays up showing "all done" after the last pending todo is completed. */
const ALL_DONE_DISPLAY_MS = 2_500;
/** A hidden bubble is destroyed after this cooldown instead of lingering as an idle WebContents. */
const BUBBLE_DESTROY_DELAY_MS = 30_000;
/** Coalesce bursts of display-added/removed/metrics events into one relayout. */
const DISPLAY_CHANGE_DEBOUNCE_MS = 250;
const forceEmergencySmoke =
  process.env.EYEPROTECT_SMOKE === '1' && process.argv.includes('--eyeprotect-smoke-emergency');

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const loadRenderer = async (
  window: BrowserWindow,
  view: 'pet' | 'settings' | 'panel' | 'bubble' | 'alert' | 'workbench'
): Promise<void> => {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    const url = new URL(rendererUrl);
    url.hash = view;
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(join(moduleDir, '../renderer/index.html'), { hash: view });
};

const getAppVersion = (): string => {
  if (app.isPackaged) {
    return app.getVersion();
  }
  try {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    ) as { version?: unknown };
    return typeof manifest.version === 'string' && manifest.version
      ? manifest.version
      : app.getVersion();
  } catch {
    return app.getVersion();
  }
};

export const getRuntimeInfo = (settingsStore: SettingsStore): RuntimeInfo => ({
  // Packaged builds use Electron's app metadata. Direct development/preview
  // launches otherwise report Electron's own version, so read the project
  // manifest there and keep app.getVersion() as a safe fallback.
  appVersion: getAppVersion(),
  isPackaged: app.isPackaged,
  dataDir: settingsStore.getDataDir()
});

/**
 * Window lifecycle, split by role:
 * - PetWindow: the only long-lived window; always 160px-scale, never resized
 *   for reminders.
 * - AlertWindow: created when a reminder fires (own renderer, own image
 *   cache), destroyed the moment the reminder ends — reminder artwork memory
 *   does not accumulate in the long-lived pet process.
 * - BubbleWindow: created on demand, destroyed after a hide cooldown or
 *   immediately once there are no pending todos.
 * - PanelWindow / SettingsWindow: on demand, closed → destroyed as before.
 * - Dim overlays: exist only while an alert is on screen.
 */
export class AppWindows {
  private petWindow: BrowserWindow | null = null;
  private petTemporarilyHidden = false;
  private settingsWindow: BrowserWindow | null = null;
  private panelWindow: BrowserWindow | null = null;
  private panelTab: PanelTab = 'todos';
  private quickAddPending = false;
  private bubbleWindow: BrowserWindow | null = null;
  private bubbleLoading: Promise<void> | null = null;
  private bubbleShouldShow = false;
  private bubbleDestroyTimer: NodeJS.Timeout | null = null;
  private allDoneTimer: NodeJS.Timeout | null = null;
  private alertWindow: BrowserWindow | null = null;
  private alertLoading: Promise<boolean> | null = null;
  private dimWindows: BrowserWindow[] = [];
  private workbenchWindow: BrowserWindow | null = null;
  private workbenchSection: 'today' | 'settings' | 'reminders' = 'today';
  private savePositionTimer: NodeJS.Timeout | null = null;
  private displayChangeTimer: NodeJS.Timeout | null = null;
  private applyingBounds = false;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly scheduler: ReminderScheduler,
    private readonly getTasks: () => Task[] = () => []
  ) {
    const onDisplaysChanged = (): void => this.handleDisplaysChangedSoon();
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-metrics-changed', onDisplaysChanged);
  }

  async createPetWindow(): Promise<void> {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      return;
    }

    const settings = this.settingsStore.get();
    const size = this.getIdlePetSize(settings);
    // Clamp against the display nearest the saved position, not the primary
    // display: users who park the pet on a secondary monitor expect it (and
    // the todo bubble anchored to it) to restore there after a restart.
    const savedPosition = this.getSavedPetPosition(settings);
    const display = savedPosition
      ? screen.getDisplayNearestPoint(savedPosition)
      : screen.getPrimaryDisplay();
    const bounds = this.getInitialPetBounds(size.width, size.height, settings, display.workArea);

    this.petWindow = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    this.petWindow.setAlwaysOnTop(true, 'floating');
    this.petWindow.on('moved', () => {
      this.persistPetPositionSoon();
      this.positionBubbleWindow();
    });
    this.petWindow.on('resized', () => {
      this.persistPetPositionSoon();
      this.positionBubbleWindow();
    });
    this.petWindow.on('closed', () => {
      this.petWindow = null;
    });

    await loadRenderer(this.petWindow, 'pet');
    this.petWindow.showInactive();
    this.refreshBubble();
  }

  togglePetVisibility(): boolean {
    this.petTemporarilyHidden = !this.petTemporarilyHidden;
    if (this.petTemporarilyHidden) {
      if (this.petWindow && !this.petWindow.isDestroyed()) {
        this.petWindow.hide();
      }
      this.destroyBubble();
    } else {
      this.applyReminderStatus(this.scheduler.getStatus());
    }
    return this.petTemporarilyHidden;
  }

  async showSettingsWindow(): Promise<void> {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 560,
      height: 680,
      minWidth: 520,
      minHeight: 620,
      title: 'EyeProtect 设置',
      autoHideMenuBar: true,
      skipTaskbar: true,
      backgroundColor: '#f7f2e8',
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });

    await loadRenderer(this.settingsWindow, 'settings');
    this.settingsWindow.show();
  }

  closeSettingsWindow(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close();
    }
  }

  /**
   * The Workbench is the v1.1 task-management surface (USERPLAN §三): a normal,
   * resizable, taskbar-visible MainWindow (~1080×720) hosting the Inbox/Today/
   * Upcoming/Projects/Completed views. Unlike the pet/panel it is not a
   * floating overlay — it is a real workspace the user switches to.
   */
  showWorkbenchWindow(section: 'today' | 'settings' | 'reminders' = 'today'): void {
    this.workbenchSection = section;
    if (this.workbenchWindow && !this.workbenchWindow.isDestroyed()) {
      this.workbenchWindow.show();
      this.workbenchWindow.focus();
      this.workbenchWindow.webContents.send('workbench:navigate', section);
      return;
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const initialWidth = Math.max(960, Math.min(1280, Math.round(width * 0.7)));
    const initialHeight = Math.max(600, Math.min(800, Math.round(height * 0.75)));

    this.workbenchWindow = new BrowserWindow({
      width: initialWidth,
      height: initialHeight,
      minWidth: 880,
      minHeight: 560,
      title: 'EyeProtect · 工作台',
      autoHideMenuBar: true,
      backgroundColor: '#f7f2e8',
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    this.workbenchWindow.on('closed', () => {
      this.workbenchWindow = null;
    });

    this.workbenchWindow.webContents.once('did-finish-load', () => {
      this.workbenchWindow?.webContents.send('workbench:navigate', section);
      this.workbenchWindow?.show();
      this.workbenchWindow?.focus();
    });
    void loadRenderer(this.workbenchWindow, 'workbench');
  }

  closeWorkbenchWindow(): void {
    if (this.workbenchWindow && !this.workbenchWindow.isDestroyed()) {
      this.workbenchWindow.close();
    }
  }

  getWorkbenchSection(): 'today' | 'settings' | 'reminders' {
    return this.workbenchSection;
  }

  getPanelTab(): PanelTab {
    return this.panelTab;
  }

  async openPanel(tab: PanelTab): Promise<void> {
    this.panelTab = tab;
    // The panel supersedes the bubble while open; it returns when the panel closes.
    this.hideBubble();
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.positionPanelWindow();
      this.panelWindow.show();
      this.panelWindow.focus();
      this.panelWindow.webContents.send('panel:tab', tab);
      return;
    }

    this.panelWindow = new BrowserWindow({
      ...this.getPanelBounds(),
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    this.panelWindow.setAlwaysOnTop(true, 'floating');
    // Smart close: the renderer decides whether blur may close the panel (it
    // stays open while a draft is being composed). Defer so the incoming
    // focus has settled, and skip entirely when focus only moved to another
    // app window (pet, settings) — the user is still inside the app.
    this.panelWindow.on('blur', () => {
      setTimeout(() => {
        if (!this.panelWindow || this.panelWindow.isDestroyed()) {
          return;
        }
        const appFocused = BrowserWindow.getAllWindows().some(
          (window) => !window.isDestroyed() && window.isFocused()
        );
        if (appFocused) {
          return;
        }
        this.panelWindow.webContents.send('panel:blur');
      }, 0);
    });
    this.panelWindow.on('closed', () => {
      this.panelWindow = null;
      this.refreshBubble();
    });

    await loadRenderer(this.panelWindow, 'panel');
    this.panelWindow.webContents.send('panel:tab', tab);
    this.panelWindow.show();
    this.panelWindow.focus();
  }

  async openQuickTodo(): Promise<void> {
    const panelAlreadyOpen = Boolean(
      this.panelWindow && !this.panelWindow.isDestroyed()
    );
    this.quickAddPending = true;
    await this.openPanel('todos');
    if (panelAlreadyOpen && this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.quickAddPending = false;
      this.panelWindow.webContents.send('panel:quick-add');
      this.panelWindow.focus();
    }
  }

  consumeQuickAddRequest(): boolean {
    const pending = this.quickAddPending;
    this.quickAddPending = false;
    return pending;
  }

  closePanel(): void {
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.close();
    }
  }

  // The pet window is only 160px with overflow:hidden, so the todo bubble lives
  // in its own frameless, non-focusable window anchored to the pet's top-left.
  // It shows only when there are pending todos and no reminder is active.
  private ensureBubbleWindow(): Promise<void> {
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      return Promise.resolve();
    }
    if (this.bubbleLoading) {
      // Concurrent refreshBubble() calls must not create two windows.
      return this.bubbleLoading;
    }

    this.bubbleLoading = (async () => {
      const window = new BrowserWindow({
        ...this.getBubbleBounds(),
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      this.bubbleWindow = window;
      window.setAlwaysOnTop(true, 'floating');
      window.setIgnoreMouseEvents(false);
      window.on('closed', () => {
        if (this.bubbleWindow === window) {
          this.bubbleWindow = null;
        }
      });

      try {
        await loadRenderer(window, 'bubble');
      } catch (error) {
        // Creation failed (renderer load error etc.) — drop the window so the
        // next refreshBubble() retries instead of silently never showing.
        console.error('[bubble] failed to create bubble window:', error);
        if (!window.isDestroyed()) {
          window.destroy();
        }
        this.bubbleWindow = null;
        throw error;
      }
    })().finally(() => {
      this.bubbleLoading = null;
    });

    return this.bubbleLoading;
  }

  private showBubble(): void {
    this.bubbleShouldShow = true;
    this.cancelBubbleTimers();
    void this.ensureBubbleWindow()
      .then(() => {
        if (!this.bubbleShouldShow) {
          return; // state changed while the renderer was loading
        }
        if (!this.bubbleWindow || this.bubbleWindow.isDestroyed()) {
          return;
        }
        this.positionBubbleWindow();
        // show(), not showInactive(): the window is focusable:false so it
        // cannot steal focus, and showInactive() on a transparent
        // non-focusable window sometimes never paints on Windows (esp. at
        // non-100% DPI scaling).
        this.bubbleWindow.show();
        this.bubbleWindow.webContents.invalidate();
      })
      .catch(() => {
        // Logged where the error occurs; nothing to do here.
      });
  }

  private hideBubble(): void {
    this.bubbleShouldShow = false;
    this.cancelBubbleTimers();
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      this.bubbleWindow.hide();
    }
    // A hidden bubble should not keep a WebContents alive indefinitely.
    this.scheduleBubbleDestroy(BUBBLE_DESTROY_DELAY_MS);
  }

  private destroyBubble(): void {
    this.bubbleShouldShow = false;
    this.cancelBubbleTimers();
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      this.bubbleWindow.destroy();
    }
    this.bubbleWindow = null;
  }

  private scheduleBubbleDestroy(delayMs: number): void {
    if (this.bubbleDestroyTimer) {
      return;
    }
    this.bubbleDestroyTimer = setTimeout(() => {
      this.bubbleDestroyTimer = null;
      if (!this.bubbleShouldShow) {
        this.destroyBubble();
      }
    }, delayMs);
  }

  private cancelBubbleTimers(): void {
    if (this.allDoneTimer) {
      clearTimeout(this.allDoneTimer);
      this.allDoneTimer = null;
    }
    if (this.bubbleDestroyTimer) {
      clearTimeout(this.bubbleDestroyTimer);
      this.bubbleDestroyTimer = null;
    }
  }

  refreshBubble(): void {
    const status = this.scheduler.getStatus();
    const active = status.activeReminder;
    const tasks = this.getTasks();
    const pending = tasks.filter((task) => task.status !== 'done' && task.status !== 'archived').length;
    const panelOpen = Boolean(
      this.panelWindow && !this.panelWindow.isDestroyed() && this.panelWindow.isVisible()
    );
    const petAlive = Boolean(this.petWindow) && !this.petWindow?.isDestroyed();

    // Gentle reminders and soft pre-alerts use the bubble as their surface
    // and take precedence over the todo preview.
    const reminderBubble = Boolean(active && active.mode === 'gentle') || Boolean(status.preAlert);
    if (reminderBubble) {
      if (!petAlive || panelOpen) {
        this.hideBubble();
        return;
      }
      this.showBubble();
      return;
    }

    if (active || panelOpen || !petAlive) {
      this.hideBubble();
      return;
    }

    if (pending > 0) {
      this.showBubble();
      return;
    }

    if (tasks.length === 0) {
      // Nothing left at all: no reason to keep the window around.
      this.destroyBubble();
      return;
    }

    // No pending items but completed ones exist: if the bubble was visible,
    // let it flash "all done" briefly, then destroy it.
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed() && this.bubbleWindow.isVisible()) {
      if (!this.allDoneTimer) {
        this.allDoneTimer = setTimeout(() => {
          this.allDoneTimer = null;
          this.destroyBubble();
        }, ALL_DONE_DISPLAY_MS);
      }
      return;
    }
    this.destroyBubble();
  }

  /** Preferences matter to the settings window and the pet's skin/size. */
  broadcastSettings(settings: Settings): void {
    this.sendTo([this.settingsWindow, this.workbenchWindow, this.petWindow], 'settings:changed', settings);
  }

  broadcastReminderStatus(status: ReminderStatus): void {
    // The pet only needs reminder status for its first-class double-click
    // shortcut in gentle mode; alert/settings/bubble render the visible state.
    this.sendTo(
      [this.petWindow, this.alertWindow, this.settingsWindow, this.workbenchWindow, this.bubbleWindow],
      'reminder:changed',
      status
    );
    this.applyReminderStatus(status);
  }

  /** Only the panel lists alarms; pet merely reacts to alarm:fired. */
  broadcastAlarms(alarms: Alarm[]): void {
    this.sendTo([this.panelWindow], 'alarm:changed', alarms);
  }

  broadcastAlarmFired(alarm: Alarm): void {
    this.sendTo([this.petWindow], 'alarm:fired', alarm);
  }

  broadcastStandaloneReminders(reminders: StandaloneReminder[]): void {
    this.sendTo([this.workbenchWindow, this.panelWindow], 'standalone-reminder:changed', reminders);
  }

  broadcastStandaloneReminderFired(reminder: StandaloneReminder): void {
    this.sendTo([this.workbenchWindow, this.panelWindow], 'standalone-reminder:fired', reminder);
  }

  broadcastTodos(todos: TodoItem[]): void {
    this.sendTo([this.petWindow, this.bubbleWindow, this.panelWindow], 'todo:changed', todos);
    this.refreshBubble();
  }

  broadcastHistory(report: WeeklyReport, care: CareStatus): void {
    this.sendTo([this.settingsWindow, this.workbenchWindow], 'history:changed', report);
    this.sendTo([this.petWindow, this.settingsWindow, this.workbenchWindow], 'care:changed', care);
  }

  broadcastHotkeyStatus(status: HotkeyStatus): void {
    this.sendTo([this.settingsWindow, this.workbenchWindow], 'hotkeys:changed', status);
  }

  /** Pet scale/skin/dim changes: recompute pet bounds, nothing else. */
  applyPetSettings(settings: Settings): void {
    this.applyReminderStatus(this.scheduler.getStatus(), settings);
  }

  /**
   * Reminder lifecycle for windows, by mode:
   * - gentle: the reminder lives in the bubble next to the pet — no alert
   *   window, no dimming, pet stays on screen as the bubble's anchor.
   * - guided/focused: the pet yields the screen (hidden) and a dedicated
   *   AlertWindow takes over; dim overlays exist only for focused mode.
   * When the reminder ends, alert and overlays are destroyed and the pet
   * returns at its idle size.
   */
  private applyReminderStatus(status: ReminderStatus, settings = this.settingsStore.get()): void {
    const active = status.activeReminder;
    if (active) {
      this.closePanel();
      if (active.mode === 'gentle') {
        if (this.petWindow && !this.petWindow.isDestroyed()) {
          this.petWindow.showInactive();
        }
        this.destroyAlertWindow();
        this.updateDimWindows(false, settings);
        this.refreshBubble();
        return;
      }
      if (this.petWindow && !this.petWindow.isDestroyed() && this.petWindow.isVisible()) {
        this.petWindow.hide();
      }
      this.destroyBubble();
      this.updateDimWindows(active.mode === 'focused', settings);
      if (!forceEmergencySmoke) {
        void this.ensureAlertWindow();
      }
      return;
    }

    this.destroyAlertWindow();
    this.updateDimWindows(false, settings);

    if (this.petWindow && !this.petWindow.isDestroyed()) {
      const display = screen.getDisplayMatching(this.petWindow.getBounds());
      const size = this.getIdlePetSize(settings);
      this.applyingBounds = true;
      this.petWindow.setBounds(
        this.getInitialPetBounds(size.width, size.height, settings, display.workArea),
        true
      );
      this.applyingBounds = false;
      this.petWindow.setAlwaysOnTop(true, 'floating');
      if (!this.petTemporarilyHidden || status.preAlert) {
        this.petWindow.showInactive();
      } else {
        this.petWindow.hide();
      }
      this.petWindow.flashFrame(false);
    }
    if (!this.petTemporarilyHidden || status.preAlert) {
      this.refreshBubble();
    } else {
      this.destroyBubble();
    }
  }

  private ensureAlertWindow(): Promise<boolean> {
    if (this.alertWindow && !this.alertWindow.isDestroyed()) {
      this.positionAlertWindow();
      return Promise.resolve(true);
    }
    if (this.alertLoading) {
      return this.alertLoading;
    }

    this.alertLoading = (async () => {
      const window = new BrowserWindow({
        ...this.getAlertBoundsForPetDisplay(),
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      // Above the dim masks ('floating'), same level the pet card used before.
      window.setAlwaysOnTop(true, 'screen-saver');
      window.on('closed', () => {
        if (this.alertWindow === window) {
          this.alertWindow = null;
        }
      });

      try {
        await loadRenderer(window, 'alert');
      } catch (error) {
        console.error('[alert] failed to create alert window:', error);
        if (!window.isDestroyed()) {
          window.destroy();
        }
        return false;
      }

      if (!this.scheduler.getStatus().activeReminder) {
        // Reminder ended while the renderer was loading: discard silently.
        if (!window.isDestroyed()) {
          window.destroy();
        }
        return false;
      }

      this.alertWindow = window;
      window.show();
      window.flashFrame(true);
      return window.isVisible();
    })().finally(() => {
      this.alertLoading = null;
    });

    return this.alertLoading;
  }

  private destroyAlertWindow(): void {
    if (this.alertWindow && !this.alertWindow.isDestroyed()) {
      this.alertWindow.destroy();
    }
    this.alertWindow = null;
  }

  private positionAlertWindow(): void {
    if (this.alertWindow && !this.alertWindow.isDestroyed()) {
      this.alertWindow.setBounds(this.getAlertBoundsForPetDisplay());
    }
  }

  /** Center the alert on the display the pet lives on. */
  private getAlertBoundsForPetDisplay(): Electron.Rectangle {
    const anchor =
      this.petWindow && !this.petWindow.isDestroyed()
        ? this.petWindow.getBounds()
        : { x: 0, y: 0, width: 0, height: 0 };
    return getAlertBounds(screen.getDisplayMatching(anchor).workArea);
  }

  private updateDimWindows(active: boolean, settings: Settings): void {
    if (!active || !settings.dimDesktop) {
      this.destroyDimWindows();
      return;
    }

    if (this.dimWindows.length > 0) {
      return;
    }

    const displays = screen.getAllDisplays();
    const created = displays.map((display) => {
      const mask = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#000000',
        fullscreenable: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });

      // Mask sits on the 'floating' band while the alert card runs on
      // 'screen-saver', so the card is always above regardless of show order.
      mask.setAlwaysOnTop(true, 'floating');
      mask.setSkipTaskbar(true);
      mask.showInactive();
      return mask;
    });

    this.dimWindows = created;
  }

  private destroyDimWindows(): void {
    for (const mask of this.dimWindows) {
      if (!mask.isDestroyed()) {
        mask.destroy();
      }
    }
    this.dimWindows = [];
  }

  private getIdlePetSize(settings: Settings): { width: number; height: number } {
    const size = Math.round(IDLE_SIZE * settings.petScale);
    return { width: size, height: size };
  }

  private getInitialPetBounds(
    width: number,
    height: number,
    settings: Settings,
    workArea: Electron.Rectangle
  ): Electron.Rectangle {
    const saved = this.getSavedPetPosition(settings);
    return {
      x: saved ? clamp(saved.x, workArea.x, workArea.x + workArea.width - width) : workArea.x + workArea.width - width - 24,
      y: saved ? clamp(saved.y, workArea.y, workArea.y + workArea.height - height) : workArea.y + workArea.height - height - 24,
      width,
      height
    };
  }

  private getPanelBounds(): Electron.Rectangle {
    const width = PANEL_SIZE.width;
    const height = PANEL_SIZE.height;
    const anchor =
      this.petWindow && !this.petWindow.isDestroyed()
        ? this.petWindow.getBounds()
        : { x: 0, y: 0, width: 0, height: 0 };
    const display = screen.getDisplayMatching(anchor);
    const workArea = display.workArea;

    // Prefer placing the panel to the left of the pet; fall back to the right
    // if there is not enough room, then clamp fully inside the work area.
    const gap = 12;
    let x = anchor.x - width - gap;
    if (x < workArea.x) {
      x = anchor.x + anchor.width + gap;
    }
    x = clamp(x, workArea.x, workArea.x + workArea.width - width);
    const y = clamp(anchor.y, workArea.y, workArea.y + workArea.height - height);

    return { x, y, width, height };
  }

  private positionPanelWindow(): void {
    if (!this.panelWindow || this.panelWindow.isDestroyed()) {
      return;
    }
    this.panelWindow.setBounds(this.getPanelBounds());
  }

  private getBubbleBounds(): Electron.Rectangle {
    const size = this.getBubbleSize();
    const width = size.width;
    const height = size.height;
    const anchor =
      this.petWindow && !this.petWindow.isDestroyed()
        ? this.petWindow.getBounds()
        : { x: 0, y: 0, width: 0, height: 0 };
    const display = screen.getDisplayMatching(anchor);
    const workArea = display.workArea;

    // Anchor the bubble above the pet's top-left, like a speech bubble. Fall
    // back below the pet if there is not enough room above, then clamp inside
    // the work area.
    const gap = 8;
    let y = anchor.y - height - gap;
    if (y < workArea.y) {
      y = anchor.y + anchor.height + gap;
    }
    y = clamp(y, workArea.y, workArea.y + workArea.height - height);
    const x = clamp(anchor.x, workArea.x, workArea.x + workArea.width - width);

    return { x, y, width, height };
  }

  private getBubbleSize(): { width: number; height: number } {
    const status = this.scheduler.getStatus();
    if (status.preAlert) {
      return PRE_ALERT_BUBBLE_SIZE;
    }
    const active = status.activeReminder;
    if (active?.mode === 'gentle') {
      return active.kind === 'combined' || Boolean(active.breakTask)
        ? GENTLE_COMBINED_BUBBLE_SIZE
        : GENTLE_BUBBLE_SIZE;
    }
    return TODO_BUBBLE_SIZE;
  }

  private positionBubbleWindow(): void {
    if (!this.bubbleWindow || this.bubbleWindow.isDestroyed()) {
      return;
    }
    this.bubbleWindow.setBounds(this.getBubbleBounds());
  }

  private handleDisplaysChangedSoon(): void {
    if (this.displayChangeTimer) {
      return;
    }
    this.displayChangeTimer = setTimeout(() => {
      this.displayChangeTimer = null;
      this.handleDisplaysChanged();
    }, DISPLAY_CHANGE_DEBOUNCE_MS);
  }

  /**
   * Monitors plugged/unplugged/rescaled/DPI-changed: keep every window inside
   * a real work area and rebuild the dim overlays to match the new set of
   * displays.
   */
  private handleDisplaysChanged(): void {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      const bounds = this.petWindow.getBounds();
      const settings = this.settingsStore.get();
      const saved = this.getSavedPetPosition(settings, false);
      const targetBounds = saved ? { ...bounds, x: saved.x, y: saved.y } : bounds;
      const display = saved
        ? screen.getDisplayNearestPoint(saved)
        : screen.getDisplayMatching(bounds);
      const workArea = display.workArea;
      const x = clamp(
        targetBounds.x,
        workArea.x,
        workArea.x + workArea.width - bounds.width
      );
      const y = clamp(
        targetBounds.y,
        workArea.y,
        workArea.y + workArea.height - bounds.height
      );
      if (x !== bounds.x || y !== bounds.y) {
        this.applyingBounds = true;
        this.petWindow.setBounds({ ...bounds, x, y });
        this.applyingBounds = false;
      }
      this.settingsStore.savePetPosition(
        { x, y },
        this.getCurrentDisplayLayoutKey()
      );
    }

    if (this.alertWindow && !this.alertWindow.isDestroyed()) {
      this.positionAlertWindow();
      // Display count may have changed: rebuild the masks (focused mode only;
      // a guided alert runs without dimming).
      const settings = this.settingsStore.get();
      this.destroyDimWindows();
      const active = this.scheduler.getStatus().activeReminder;
      this.updateDimWindows(active?.mode === 'focused', settings);
    }

    this.positionBubbleWindow();
    this.positionPanelWindow();
  }

  private persistPetPositionSoon(): void {
    if (this.applyingBounds || this.scheduler.getStatus().activeReminder) {
      return;
    }

    if (this.savePositionTimer) {
      clearTimeout(this.savePositionTimer);
    }

    this.savePositionTimer = setTimeout(() => {
      if (!this.petWindow || this.petWindow.isDestroyed()) {
        return;
      }
      const { x, y } = this.petWindow.getBounds();
      // Silent write: dragging the pet must not broadcast settings anywhere.
      this.settingsStore.savePetPosition(
        { x, y },
        this.getCurrentDisplayLayoutKey()
      );
    }, 400);
  }

  private getCurrentDisplayLayoutKey(): string {
    return getDisplayLayoutKey(screen.getAllDisplays());
  }

  private getSavedPetPosition(
    settings: Settings,
    fallBackToLegacy: boolean = true
  ): { x: number; y: number } | null {
    return (
      settings.petPositionsByLayout[this.getCurrentDisplayLayoutKey()] ??
      (fallBackToLegacy ? settings.petPosition : null)
    );
  }

  /**
   * Present a reminder on the primary (full) alert surface. Returns true if the
   * primary surface is showing or became showing; false if it could not (e.g. the
   * reminder ended mid-flight), in which case the caller falls back to the
   * emergency surface. Used by ReminderSurfaceManager's fallback chain.
   */
  async showReminderOnPrimary(active: ActiveReminder): Promise<boolean> {
    if (forceEmergencySmoke) {
      return false;
    }
    if (active.mode === 'gentle') {
      // Gentle reminders surface through the bubble, not the alert window.
      this.refreshBubble();
      if (this.bubbleLoading) {
        try {
          await this.bubbleLoading;
        } catch {
          return false;
        }
      }
      return this.bubbleWindow !== null && !this.bubbleWindow.isDestroyed() && this.bubbleWindow.isVisible();
    }
    if (this.scheduler.getStatus().activeReminder?.id !== active.id) {
      return false;
    }
    const loaded = await this.ensureAlertWindow();
    const showing =
      this.alertWindow !== null &&
      !this.alertWindow.isDestroyed() &&
      this.alertWindow.isVisible();
    return loaded && showing;
  }

  private sendTo(targets: Array<BrowserWindow | null>, channel: string, payload: unknown): void {
    for (const window of targets) {
      if (window && !window.isDestroyed()) {
        window.webContents.send(channel, payload);
      }
    }
  }

  // Push the full task list to every live window so hooks subscribed to
  // onTasksChanged re-render. The workbench is the primary consumer; the pet/
  // panel ignore the channel (per the project's separate-subscriptions rule).
  broadcastTasks(tasks: Task[]): void {
    this.sendTo(
      [this.petWindow, this.panelWindow, this.bubbleWindow, this.workbenchWindow, this.settingsWindow],
      'task:changed',
      tasks
    );
    this.refreshBubble();
  }

  broadcastProjects(projects: Project[]): void {
    this.sendTo([this.workbenchWindow], 'project:changed', projects);
  }

  broadcastActiveTask(id: string | null): void {
    this.sendTo([this.workbenchWindow, this.panelWindow, this.bubbleWindow], 'task:active-changed', id);
  }
}
