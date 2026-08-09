import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReminderSnapshot } from './reminders';

const STATE_FILE = 'runtime-state.json';
const SCHEMA_VERSION = 1;

interface RuntimeStateFile {
  version: number;
  /** Epoch ms of the last write; helps debugging stale-state questions. */
  savedAt: number;
  /** Epoch ms of the last clean exit, when known. */
  lastExitAt: number | null;
  reminder: ReminderSnapshot;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const sanitizeSnapshot = (value: unknown): ReminderSnapshot | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<ReminderSnapshot>;
  const pausedUntil =
    candidate.pausedUntil === null || isFiniteNumber(candidate.pausedUntil) ? candidate.pausedUntil : null;
  const frozenEyeMs = isFiniteNumber(candidate.frozenEyeMs) ? candidate.frozenEyeMs : null;
  const frozenWalkMs = isFiniteNumber(candidate.frozenWalkMs) ? candidate.frozenWalkMs : null;
  if (!isFiniteNumber(candidate.nextEyeAt) || !isFiniteNumber(candidate.nextWalkAt)) {
    return null;
  }
  const snoozeCount =
    Number.isInteger(candidate.snoozeCount) && (candidate.snoozeCount as number) >= 0
      ? (candidate.snoozeCount as number)
      : 0;
  // The active break session is validated on restore by the scheduler; here we
  // only guard its shape so a corrupt value can't crash the sanitizer.
  const active =
    candidate.active && typeof candidate.active === 'object'
      ? (candidate.active as ReminderSnapshot['active'])
      : null;
  return {
    nextEyeAt: candidate.nextEyeAt,
    nextWalkAt: candidate.nextWalkAt,
    pausedUntil,
    snoozeCount,
    frozenEyeMs,
    frozenWalkMs,
    active
  };
};

/**
 * Persists reminder scheduling state (data/runtime-state.json), kept separate
 * from settings.json: this file changes on reminder transitions, not on user
 * preference edits, and a corrupt copy must never clobber user settings.
 *
 * Writes only happen on transitions (action/pause/resume/interval change/quit
 * /suspend) — never per tick.
 */
export class RuntimeStateStore {
  private readonly filePath: string;
  private lastExitAt: number | null = null;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, STATE_FILE);
  }

  load(now: () => number = Date.now): ReminderSnapshot | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RuntimeStateFile>;
      if (parsed.version !== SCHEMA_VERSION) {
        // Future or unknown schema: start fresh rather than guessing.
        return null;
      }
      this.lastExitAt = isFiniteNumber(parsed.lastExitAt) ? parsed.lastExitAt : null;
      const snapshot = sanitizeSnapshot(parsed.reminder);
      if (!snapshot || this.lastExitAt === null || snapshot.pausedUntil !== null) {
        return snapshot;
      }
      // Break and snooze deadlines live in the active-use clock domain. A
      // cleanly closed application cannot observe activity, so keep the exact
      // remaining duration instead of treating offline wall time as work.
      const offlineMs = Math.max(0, now() - this.lastExitAt);
      return {
        ...snapshot,
        nextEyeAt: snapshot.nextEyeAt + offlineMs,
        nextWalkAt: snapshot.nextWalkAt + offlineMs,
        active: offlineMs > 0 ? null : snapshot.active
      };
    } catch {
      // Unreadable/corrupt: preserve the evidence, then start fresh.
      this.quarantine(now());
      return null;
    }
  }

  save(snapshot: ReminderSnapshot, now: () => number = Date.now): void {
    const file: RuntimeStateFile = {
      version: SCHEMA_VERSION,
      savedAt: now(),
      lastExitAt: this.lastExitAt,
      reminder: snapshot
    };
    try {
      mkdirSync(join(this.filePath, '..'), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
      renameSync(tempPath, this.filePath);
    } catch (error) {
      // Persistence is best-effort; a failed write must never crash the app.
      console.error('[runtime-state] failed to persist:', error);
    }
  }

  markExiting(now: () => number = Date.now): void {
    this.lastExitAt = now();
  }

  private quarantine(now: number): void {
    try {
      renameSync(this.filePath, `${this.filePath}.corrupt-${now}`);
    } catch {
      // Nothing more we can do; load() will fall back to defaults.
    }
  }
}
