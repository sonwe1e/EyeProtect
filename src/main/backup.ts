import { sanitizeReminderEvent } from './reminderHistory';
import { sanitizeSettings } from './settings';
import type { ReminderEvent, Settings } from '../shared/types';

const BACKUP_SCHEMA_VERSION = 1;

export interface EyeProtectBackup {
  version: 1;
  createdAt: number;
  appVersion: string;
  settings: Settings;
  reminderHistory: ReminderEvent[];
}

export const createBackup = (
  settings: Settings,
  reminderHistory: readonly ReminderEvent[],
  appVersion: string,
  now: number = Date.now()
): string =>
  `${JSON.stringify(
    {
      version: BACKUP_SCHEMA_VERSION,
      createdAt: now,
      appVersion,
      settings,
      reminderHistory: [...reminderHistory]
    } satisfies EyeProtectBackup,
    null,
    2
  )}\n`;

export const parseBackup = (text: string): EyeProtectBackup => {
  const parsed = JSON.parse(text) as Partial<EyeProtectBackup>;
  if (
    parsed.version !== BACKUP_SCHEMA_VERSION ||
    !Number.isFinite(parsed.createdAt) ||
    typeof parsed.appVersion !== 'string' ||
    !parsed.settings ||
    typeof parsed.settings !== 'object' ||
    !Array.isArray(parsed.reminderHistory)
  ) {
    throw new Error('不是受支持的 EyeProtect 备份文件');
  }
  const reminderHistory = parsed.reminderHistory.map((event) => sanitizeReminderEvent(event));
  if (reminderHistory.some((event) => event === null)) {
    throw new Error('备份中的提醒历史存在无效记录');
  }
  return {
    version: BACKUP_SCHEMA_VERSION,
    createdAt: parsed.createdAt as number,
    appVersion: parsed.appVersion,
    settings: sanitizeSettings(parsed.settings),
    reminderHistory: reminderHistory as ReminderEvent[]
  };
};
