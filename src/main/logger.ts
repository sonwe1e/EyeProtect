/**
 * Main-process logger (quality step 3).
 *
 * Single funnel for main-process diagnostics so packaged builds have one
 * on-disk trail: `console` for dev visibility, plus an injectable sink so
 * errors also land in the rolling reminder-trace log. Levels keep
 * crash/diagnostic noise out of the default release log.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Receives warn/error entries for on-disk persistence (e.g. ReminderTrace). */
export type LoggerSink = (level: 'warn' | 'error', message: string, args: readonly unknown[]) => void;

let sink: LoggerSink | null = null;

/** Install the persistent sink once at startup. Idempotent; last one wins. */
export const setLoggerSink = (next: LoggerSink | null): void => {
  sink = next;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (): LogLevel => {
  if (!process.env.EYEPROTECT_VERBOSE) return 'info';
  return 'debug';
};

const shouldLog = (level: LogLevel): boolean =>
  LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel()];

const formatArgs = (args: readonly unknown[]): unknown[] => args;

const write = (level: LogLevel, message: string, args: unknown[]): void => {
  if ((level === 'warn' || level === 'error') && sink) {
    try {
      sink(level, message, args);
    } catch {
      // The sink is observability only; a failed write must never recurse.
    }
  }
  if (!shouldLog(level)) return;
  const line = `[eyeprotect] ${message}`;
  if (level === 'debug') console.debug(line, ...formatArgs(args));
  else if (level === 'info') console.info(line, ...formatArgs(args));
  else if (level === 'warn') console.warn(line, ...formatArgs(args));
  else console.error(line, ...formatArgs(args));
};

export const logger = {
  debug: (message: string, ...args: unknown[]): void => write('debug', message, args),
  info: (message: string, ...args: unknown[]): void => write('info', message, args),
  warn: (message: string, ...args: unknown[]): void => write('warn', message, args),
  error: (message: string, ...args: unknown[]): void => write('error', message, args),
};
