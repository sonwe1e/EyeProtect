import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
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
  TODO_PRIORITIES,
  TODO_TEXT_MAX,
  sanitizeAlarms,
  sanitizeTodos,
  type Alarm,
  type PetPosition,
  type PetSkin,
  type Settings,
  type TodoItem,
  type TodoPriority
} from '../shared/types';

type SettingsChangedPayload = {
  settings: Settings;
  previous: Settings;
};

const SETTINGS_FILE = 'settings.json';
const STARTUP_SHORTCUT = 'EyeProtect.lnk';
/**
 * Bumped when the on-disk shape changes in an incompatible way. Sanitizing
 * still repairs field-by-field; this is the coarse "unknown format" guard.
 */
const SETTINGS_SCHEMA_VERSION = 1;

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
      typeof input.dimDesktop === 'boolean' ? input.dimDesktop : DEFAULT_SETTINGS.dimDesktop,
    alarms: sanitizeAlarms(input.alarms),
    todos: sanitizeTodos(input.todos)
  };
};

export const getDataDir = (): string => {
  if (process.env.EYEPROTECT_DATA_DIR) {
    return process.env.EYEPROTECT_DATA_DIR;
  }

  // Loaded lazily: `app` from electron cannot be imported at the module top
  // level in pure-Node test runs (electron's CJS entry throws outside the
  // Electron runtime), and `getDataDir` only reaches this branch on the
  // packaged-app path — never in tests, which set EYEPROTECT_DATA_DIR.
  const require = createRequire(import.meta.url);
  const { app } = require('electron');
  const baseDir = app.isPackaged ? dirname(process.execPath) : process.cwd();
  return join(baseDir, 'data');
};

/**
 * Domain-split events:
 * - 'changed'        — user preferences changed (settings:save). Subscribers
 *                      decide per-field what to do (scheduler, startup
 *                      shortcut, pet window). Todo/alarm mutations no longer
 *                      fire this, so checking a todo can never re-sync the
 *                      startup shortcut or resize the pet window.
 * - 'todos-changed'  — todo list changed; only pet/bubble/panel care.
 * Alarm persistence (persistAlarms) and pet-position saves are silent: the
 * AlarmClock owns alarm notifications, and nobody needs position echoes.
 */
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
    return {
      ...this.settings,
      petPosition: this.settings.petPosition ? { ...this.settings.petPosition } : null,
      alarms: this.settings.alarms.map((alarm) => ({ ...alarm })),
      todos: this.settings.todos.map((todo) => ({ ...todo }))
    };
  }

  save(partial: Partial<Settings>): Settings {
    const previous = this.get();
    const next = sanitizeSettings({ ...previous, ...partial });
    this.settings = next;
    this.write(next);
    this.emit('changed', { settings: this.get(), previous } satisfies SettingsChangedPayload);
    return this.get();
  }

  /** Pet drag persistence: rewrite the file, notify nobody. */
  savePetPosition(position: PetPosition | null): void {
    const next = sanitizeSettings({ ...this.get(), petPosition: position });
    this.settings = next;
    this.write(next);
  }

  addTodo(rawText: string): TodoItem[] {
    const text = typeof rawText === 'string' ? rawText.trim().slice(0, TODO_TEXT_MAX) : '';
    if (!text) {
      return this.get().todos;
    }
    const todo: TodoItem = {
      id: randomUUID(),
      text,
      createdAt: Date.now(),
      completed: false,
      priority: 'normal'
    };
    return this.commitTodos([...this.get().todos, todo]);
  }

  toggleTodo(id: string): TodoItem[] {
    if (typeof id !== 'string' || !id) {
      return this.get().todos;
    }
    const previous = this.get();
    if (!previous.todos.some((todo) => todo.id === id)) {
      return previous.todos;
    }
    const todos = previous.todos.map((todo) => {
      if (todo.id !== id) {
        return todo;
      }
      return todo.completed
        ? { ...todo, completed: false, completedAt: undefined }
        : { ...todo, completed: true, completedAt: Date.now() };
    });
    return this.commitTodos(todos);
  }

  updateTodo(id: string, rawText: string): TodoItem[] {
    const text = typeof rawText === 'string' ? rawText.trim().slice(0, TODO_TEXT_MAX) : '';
    if (typeof id !== 'string' || !id || !text) {
      return this.get().todos;
    }
    const previous = this.get();
    if (!previous.todos.some((todo) => todo.id === id)) {
      return previous.todos;
    }
    return this.commitTodos(previous.todos.map((todo) => (todo.id === id ? { ...todo, text } : todo)));
  }

  removeTodo(id: string): TodoItem[] {
    if (typeof id !== 'string' || !id) {
      return this.get().todos;
    }
    const previous = this.get();
    return this.commitTodos(previous.todos.filter((todo) => todo.id !== id));
  }

  setTodoPriority(id: string, priority: TodoPriority): TodoItem[] {
    if (typeof id !== 'string' || !id || !TODO_PRIORITIES.includes(priority)) {
      return this.get().todos;
    }
    const previous = this.get();
    if (!previous.todos.some((todo) => todo.id === id)) {
      return previous.todos;
    }
    return this.commitTodos(previous.todos.map((todo) => (todo.id === id ? { ...todo, priority } : todo)));
  }

  clearCompletedTodos(): TodoItem[] {
    const previous = this.get();
    const todos = previous.todos.filter((todo) => !todo.completed);
    if (todos.length === previous.todos.length) {
      return previous.todos;
    }
    return this.commitTodos(todos);
  }

  /**
   * AlarmClock is the source of truth and announces changes itself; this only
   * mirrors its list to disk — no 'changed' cascade.
   */
  persistAlarms(alarms: Alarm[]): void {
    const next = sanitizeSettings({ ...this.get(), alarms });
    this.settings = next;
    this.write(next);
  }

  onChanged(callback: (payload: SettingsChangedPayload) => void): void {
    this.on('changed', callback);
  }

  private commitTodos(todos: TodoItem[]): TodoItem[] {
    const next = sanitizeSettings({ ...this.get(), todos });
    this.settings = next;
    this.write(next);
    const result = this.get().todos;
    this.emit('todos-changed', result);
    return result;
  }

  private read(): Settings {
    if (!existsSync(this.filePath)) {
      return sanitizeSettings({});
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return sanitizeSettings(JSON.parse(raw));
    } catch {
      // Unreadable config: keep the broken file as evidence, start clean.
      this.quarantine();
      return sanitizeSettings({});
    }
  }

  private quarantine(): void {
    try {
      renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    } catch {
      // Best effort; read() already falls back to defaults.
    }
  }

  private write(settings: Settings): void {
    mkdirSync(this.dataDir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    const payload = { version: SETTINGS_SCHEMA_VERSION, ...settings };
    writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}

export const syncStartupShortcut = (settings: Settings): void => {
  // Electron is required lazily (see getDataDir): its CJS entry throws when
  // loaded outside the Electron runtime, as happens under the Node test runner.
  const require = createRequire(import.meta.url);
  const { app, shell } = require('electron');

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
