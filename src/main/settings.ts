import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { env } from 'node:process';
import {
  DEFAULT_SETTINGS,
  PET_SKINS,
  SETTINGS_LIMITS,
  type PetPosition,
  type PetSkin,
  type Settings
} from '../shared/types';

type SettingsChangedPayload = {
  settings: Settings;
  previous: Settings;
};

const SETTINGS_FILE = 'settings.json';
const STARTUP_SHORTCUT = 'EyeProtect.lnk';

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
};

const normalizePosition = (value: unknown): PetPosition | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PetPosition>;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
    return null;
  }

  return {
    x: Math.round(candidate.x as number),
    y: Math.round(candidate.y as number)
  };
};

export const sanitizeSettings = (value: Partial<Settings> | unknown): Settings => {
  const input = value && typeof value === 'object' ? (value as Partial<Settings>) : {};

  return {
    eyeIntervalMinutes: Math.round(
      clampNumber(
        input.eyeIntervalMinutes,
        DEFAULT_SETTINGS.eyeIntervalMinutes,
        SETTINGS_LIMITS.eyeIntervalMinutes.min,
        SETTINGS_LIMITS.eyeIntervalMinutes.max
      )
    ),
    walkIntervalMinutes: Math.round(
      clampNumber(
        input.walkIntervalMinutes,
        DEFAULT_SETTINGS.walkIntervalMinutes,
        SETTINGS_LIMITS.walkIntervalMinutes.min,
        SETTINGS_LIMITS.walkIntervalMinutes.max
      )
    ),
    snoozeMinutes: Math.round(
      clampNumber(
        input.snoozeMinutes,
        DEFAULT_SETTINGS.snoozeMinutes,
        SETTINGS_LIMITS.snoozeMinutes.min,
        SETTINGS_LIMITS.snoozeMinutes.max
      )
    ),
    startWithWindows:
      typeof input.startWithWindows === 'boolean'
        ? input.startWithWindows
        : DEFAULT_SETTINGS.startWithWindows,
    petScale: clampNumber(
      input.petScale,
      DEFAULT_SETTINGS.petScale,
      SETTINGS_LIMITS.petScale.min,
      SETTINGS_LIMITS.petScale.max
    ),
    petPosition: normalizePosition(input.petPosition),
    petSkin: PET_SKINS.includes(input.petSkin as PetSkin)
      ? (input.petSkin as PetSkin)
      : DEFAULT_SETTINGS.petSkin,
    dimDesktop:
      typeof input.dimDesktop === 'boolean' ? input.dimDesktop : DEFAULT_SETTINGS.dimDesktop
  };
};

export const getDataDir = (): string => {
  if (process.env.EYEPROTECT_DATA_DIR) {
    return process.env.EYEPROTECT_DATA_DIR;
  }

  const baseDir = app.isPackaged ? dirname(process.execPath) : process.cwd();
  return join(baseDir, 'data');
};

export class SettingsStore extends EventEmitter {
  private readonly dataDir: string;
  private readonly filePath: string;
  private settings: Settings;

  constructor() {
    super();
    this.dataDir = getDataDir();
    this.filePath = join(this.dataDir, SETTINGS_FILE);
    this.settings = this.read();
  }

  getDataDir(): string {
    return this.dataDir;
  }

  get(): Settings {
    return { ...this.settings, petPosition: this.settings.petPosition ? { ...this.settings.petPosition } : null };
  }

  save(partial: Partial<Settings>): Settings {
    const previous = this.get();
    const next = sanitizeSettings({ ...previous, ...partial });
    this.settings = next;
    this.write(next);
    this.emit('changed', { settings: this.get(), previous } satisfies SettingsChangedPayload);
    return this.get();
  }

  onChanged(callback: (payload: SettingsChangedPayload) => void): void {
    this.on('changed', callback);
  }

  private read(): Settings {
    if (!existsSync(this.filePath)) {
      return DEFAULT_SETTINGS;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return sanitizeSettings(JSON.parse(raw));
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private write(settings: Settings): void {
    mkdirSync(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}

export const syncStartupShortcut = (settings: Settings): void => {
  if (!app.isPackaged) {
    return;
  }

  const startupDir = env.APPDATA
    ? join(env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs\\Startup')
    : join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs\\Startup');
  const shortcutPath = join(startupDir, STARTUP_SHORTCUT);

  if (!settings.startWithWindows) {
    if (existsSync(shortcutPath)) {
      rmSync(shortcutPath, { force: true });
    }
    return;
  }

  shell.writeShortcutLink(shortcutPath, 'create', {
    target: process.execPath,
    cwd: dirname(process.execPath),
    description: 'EyeProtect'
  });
};
