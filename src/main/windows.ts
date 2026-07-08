import { app, BrowserWindow, screen } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Alarm, ReminderStatus, RuntimeInfo, Settings, TodoItem } from '../shared/types';
import type { ReminderScheduler } from './reminders';
import type { SettingsStore } from './settings';
import { getAlertBounds } from './windowBounds';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const IDLE_SIZE = 160;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const loadRenderer = async (window: BrowserWindow, view: 'pet' | 'settings'): Promise<void> => {
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
    this.petWindow.on('moved', () => this.persistPetPositionSoon());
    this.petWindow.on('resized', () => this.persistPetPositionSoon());
    this.petWindow.on('closed', () => {
      this.petWindow = null;
    });

    await loadRenderer(this.petWindow, 'pet');
    this.petWindow.showInactive();
    this.applyReminderStatus(this.scheduler.getStatus());
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
