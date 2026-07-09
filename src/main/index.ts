import { app, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReminderAction, ReminderKind, Settings } from '../shared/types';
import { AlarmClock } from './alarms';
import { ReminderScheduler } from './reminders';
import { SettingsStore, syncStartupShortcut } from './settings';
import { AppWindows, getRuntimeInfo } from './windows';

const moduleDir = dirname(fileURLToPath(import.meta.url));
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

const createTray = (windows: AppWindows, scheduler: ReminderScheduler): void => {
  tray = new Tray(loadTrayIcon());
  tray.setToolTip('EyeProtect');

  const rebuildMenu = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '打开设置',
          click: () => {
            void windows.showSettingsWindow();
          }
        },
        {
          label: '暂停 1 小时',
          click: () => scheduler.pause(60)
        },
        { type: 'separator' },
        {
          label: '测试护眼提醒',
          click: () => scheduler.triggerTest('eye')
        },
        {
          label: '测试走动提醒',
          click: () => scheduler.triggerTest('walk')
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            isQuitting = true;
            scheduler.stop();
            app.quit();
          }
        }
      ])
    );
  };

  rebuildMenu();
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

app.setAppUserModelId('local.eyeprotect.pet');

app.whenReady().then(async () => {
  const settingsStore = new SettingsStore();
  const scheduler = new ReminderScheduler(settingsStore.get());
  const alarmClock = new AlarmClock();
  alarmClock.hydrate(settingsStore.get().alarms);
  const windows = new AppWindows(settingsStore, scheduler);

  app.on('second-instance', () => {
    void windows.showSettingsWindow();
  });

  settingsStore.onChanged(({ settings, previous }) => {
    scheduler.updateSettings(settings, previous);
    syncStartupShortcut(settings);
    windows.applySettings(settings);
    windows.broadcastSettings(settings);
  });

  scheduler.onChanged((status) => {
    windows.broadcastReminderStatus(status);
  });

  alarmClock.on('changed', (alarms) => windows.broadcastAlarms(alarms));
  alarmClock.on('changed', (alarms) => settingsStore.persistAlarms(alarms));
  settingsStore.on('todos-changed', (todos) => windows.broadcastTodos(todos));
  alarmClock.on('fired', (alarm) => windows.broadcastAlarmFired(alarm));

  ipcMain.handle('settings:get', () => settingsStore.get());
  ipcMain.handle('settings:save', (_event, payload: unknown) => settingsStore.save(asPartialSettings(payload)));
  ipcMain.handle('runtime:get', () => getRuntimeInfo(settingsStore));
  ipcMain.handle('reminder:status', () => scheduler.getStatus());
  ipcMain.handle('reminder:action', (_event, action: ReminderAction, reminderId: string) =>
    scheduler.handleAction(action, reminderId)
  );
  ipcMain.handle('reminder:test', (_event, kind: ReminderKind) => scheduler.triggerTest(kind));
  ipcMain.handle('reminder:pause', (_event, minutes: number) => scheduler.pause(minutes));
  ipcMain.handle('window:settings:open', () => windows.showSettingsWindow());
  ipcMain.handle('window:settings:close', () => windows.closeSettingsWindow());
  ipcMain.handle('window:panel:open', (_event, tab: unknown) =>
    windows.openPanel(tab === 'alarms' ? 'alarms' : 'todos')
  );
  ipcMain.handle('window:panel:close', () => windows.closePanel());
  ipcMain.handle('window:panel:tab', () => windows.getPanelTab());
  ipcMain.handle('alarm:list', () => alarmClock.getAlarms());
  ipcMain.handle('alarm:set', (_event, input) => alarmClock.setAlarm(input));
  ipcMain.handle('alarm:cancel', (_event, id: string) => alarmClock.cancelAlarm(id));
  ipcMain.handle('todo:list', () => settingsStore.get().todos);
  ipcMain.handle('todo:add', (_event, text: unknown) =>
    settingsStore.addTodo(typeof text === 'string' ? text : '')
  );
  ipcMain.handle('todo:remove', (_event, id: string) => settingsStore.removeTodo(id));

  await windows.createPetWindow();
  createTray(windows, scheduler);
  scheduler.start();
  syncStartupShortcut(settingsStore.get());
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  }
});
