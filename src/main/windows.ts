import { app, BrowserWindow, screen } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Alarm, PanelTab, ReminderStatus, RuntimeInfo, Settings, TodoItem } from '../shared/types';
import type { ReminderScheduler } from './reminders';
import type { SettingsStore } from './settings';
import { getAlertBounds } from './windowBounds';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const IDLE_SIZE = 160;
const PANEL_SIZE = { width: 344, height: 496 } as const;
const BUBBLE_SIZE = { width: 220, height: 150 } as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const loadRenderer = async (
  window: BrowserWindow,
  view: 'pet' | 'settings' | 'panel' | 'bubble'
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

const getCharacterAssetPath = (): string => {
  if (process.env.ELECTRON_RENDERER_URL) {
    return join(process.cwd(), 'public/assets/character.riv');
  }
  return join(moduleDir, '../renderer/assets/character.riv');
};

export const getRuntimeInfo = (settingsStore: SettingsStore): RuntimeInfo => ({
  appVersion: process.env.npm_package_version ?? '0.2.0',
  isPackaged: app.isPackaged,
  riveAvailable: existsSync(getCharacterAssetPath()),
  dataDir: settingsStore.getDataDir()
});

export class AppWindows {
  private petWindow: BrowserWindow | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private panelWindow: BrowserWindow | null = null;
  private panelTab: PanelTab = 'todos';
  private bubbleWindow: BrowserWindow | null = null;
  private dimWindows: BrowserWindow[] = [];
  private savePositionTimer: NodeJS.Timeout | null = null;
  private applyingBounds = false;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly scheduler: ReminderScheduler
  ) {}

  async createPetWindow(): Promise<void> {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      return;
    }

    const settings = this.settingsStore.get();
    const size = this.getIdlePetSize(settings);
    const bounds = this.getInitialPetBounds(size.width, size.height, settings, screen.getPrimaryDisplay().workArea);

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
        preload: join(moduleDir, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
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
    this.applyReminderStatus(this.scheduler.getStatus());
    this.refreshBubble();
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
        preload: join(moduleDir, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
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

  getPanelTab(): PanelTab {
    return this.panelTab;
  }

  async openPanel(tab: PanelTab): Promise<void> {
    this.panelTab = tab;
    // The panel supersedes the bubble while open; it returns when the panel closes.
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      this.bubbleWindow.hide();
    }
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
        preload: join(moduleDir, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
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

  closePanel(): void {
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.close();
    }
  }

  // The pet window is only 160px with overflow:hidden, so the todo bubble lives
  // in its own frameless, non-focusable window anchored to the pet's top-left.
  // It shows only when there are todos and no reminder is active.
  private async ensureBubbleWindow(): Promise<void> {
    if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
      return;
    }

    this.bubbleWindow = new BrowserWindow({
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
        preload: join(moduleDir, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    this.bubbleWindow.setAlwaysOnTop(true, 'floating');
    this.bubbleWindow.setIgnoreMouseEvents(false);
    this.bubbleWindow.on('closed', () => {
      this.bubbleWindow = null;
    });

    await loadRenderer(this.bubbleWindow, 'bubble');
  }

  refreshBubble(): void {
    const status = this.scheduler.getStatus();
    const active = Boolean(status.activeReminder);
    const todos = this.settingsStore.get().todos;
    const panelOpen = Boolean(
      this.panelWindow && !this.panelWindow.isDestroyed() && this.panelWindow.isVisible()
    );
    const shouldShow =
      !active && !panelOpen && todos.length > 0 && Boolean(this.petWindow) && !this.petWindow?.isDestroyed();

    if (!shouldShow) {
      if (this.bubbleWindow && !this.bubbleWindow.isDestroyed()) {
        this.bubbleWindow.hide();
      }
      return;
    }

    void this.ensureBubbleWindow().then(() => {
      if (!this.bubbleWindow || this.bubbleWindow.isDestroyed()) {
        return;
      }
      this.positionBubbleWindow();
      this.bubbleWindow.showInactive();
    });
  }

  broadcastSettings(settings: Settings): void {
    this.sendAll('settings:changed', settings);
  }

  broadcastReminderStatus(status: ReminderStatus): void {
    this.sendAll('reminder:changed', status);
    this.applyReminderStatus(status);
  }

  broadcastAlarms(alarms: Alarm[]): void {
    this.sendAll('alarm:changed', alarms);
  }

  broadcastAlarmFired(alarm: Alarm): void {
    this.sendAll('alarm:fired', alarm);
  }

  broadcastTodos(todos: TodoItem[]): void {
    this.sendAll('todo:changed', todos);
    this.refreshBubble();
  }

  applySettings(settings: Settings): void {
    this.applyReminderStatus(this.scheduler.getStatus(), settings);
  }

  private applyReminderStatus(status: ReminderStatus, settings = this.settingsStore.get()): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) {
      return;
    }

    const current = this.petWindow.getBounds();
    const display = screen.getDisplayMatching(current);
    const bounds = this.getPetBounds(status, settings, display.workArea);
    const active = Boolean(status.activeReminder);

    this.applyingBounds = true;
    this.petWindow.setBounds(bounds, true);
    this.applyingBounds = false;
    this.petWindow.setAlwaysOnTop(true, active ? 'screen-saver' : 'floating');

    this.updateDimWindows(active, settings);

    if (active) {
      this.petWindow.showInactive();
      this.petWindow.flashFrame(true);
    } else {
      this.petWindow.flashFrame(false);
    }

    this.refreshBubble();
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

      // Mask sits on the 'floating' band while the pet reminder card runs on
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

  private getPetBounds(status: ReminderStatus, settings: Settings, workArea: Electron.Rectangle): Electron.Rectangle {
    const active = status.activeReminder;
    if (!active) {
      const size = this.getIdlePetSize(settings);
      return this.getInitialPetBounds(size.width, size.height, settings, workArea);
    }

    return getAlertBounds(workArea);
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
    const saved = settings.petPosition;
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
    const width = BUBBLE_SIZE.width;
    const height = BUBBLE_SIZE.height;
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

  private positionBubbleWindow(): void {
    if (!this.bubbleWindow || this.bubbleWindow.isDestroyed()) {
      return;
    }
    this.bubbleWindow.setBounds(this.getBubbleBounds());
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
      this.settingsStore.save({ petPosition: { x, y } });
    }, 400);
  }

  private sendAll(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload);
      }
    }
  }
}
