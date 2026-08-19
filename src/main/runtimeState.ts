import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
  /**
   * Epoch ms of the last successful save during the owning session. Updated on
   * every save(), so a crash restore (no clean exit) has a recent bound instead
   * of falling back to a stale prior-session exit timestamp.
   */
  lastCheckpointAt: number | null;
  /** Session that wrote this snapshot; identifies which exit/checkpoint is ours. */
  sessionId: string | null;
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
 * Writes happen on transitions plus one low-frequency crash checkpoint (60s in
 * production), never on the renderer's per-second countdown tick.
 */
export class RuntimeStateStore {
  private readonly filePath: string;
  private lastExitAt: number | null = null;
  private lastCheckpointAt: number | null = null;
  private sessionId: string | null = null;
  private checkpointTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, STATE_FILE);
  }

  /**
   * Begin a new session: generate a fresh session id so the snapshots written
   * during this run (via save() and its checkpoints) are identifiable. Must be
   * called once at startup BEFORE load() so the new session owns the restore.
   */
  beginSession(): void {
    this.sessionId = randomUUID();
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
      const restoreAt = now();
      this.lastExitAt = isFiniteNumber(parsed.lastExitAt) ? parsed.lastExitAt : null;
      this.lastCheckpointAt = isFiniteNumber(parsed.lastCheckpointAt) ? parsed.lastCheckpointAt : null;
      const snapshot = sanitizeSnapshot(parsed.reminder);
      // The offline bound. A deadline shift is only meaningful after a CLEAN
      // exit: a closed app cannot observe activity, so offline wall time must
      // not consume the remaining break duration. After a crash, the most
      // recent checkpoint is the last trustworthy proof of active use and is
      // used as the downtime bound. The store must not clear `active` here:
      // the scheduler's recovery grace window decides whether it is resumable.
      //
      // When a clean exit IS recorded, prefer the last checkpoint written
      // during that session as the bound. A checkpoint is written on every
      // save() and is always >= lastExitAt, so a stale clean exit left over
      // from an EARLIER session is never reused as the offline origin after a
      // later session crashed without updating lastExitAt.
      // A checkpoint is the latest proof that the owning process was alive. It
      // bounds both clean-exit and crash downtime; an old clean-exit timestamp
      // is used only for legacy snapshots without checkpoints.
      const bound = this.lastCheckpointAt ?? this.lastExitAt;
      const restored = !snapshot || bound === null || snapshot.pausedUntil !== null
        ? snapshot
        : {
            ...snapshot,
            nextEyeAt: snapshot.nextEyeAt + Math.max(0, restoreAt - bound),
            nextWalkAt: snapshot.nextWalkAt + Math.max(0, restoreAt - bound),
            active: snapshot.active
          };

      // Claim the restored snapshot for the new session immediately. This is
      // the crucial protocol edge: the prior session's clean-exit marker must
      // never survive a successful relaunch and leak into a later crash.
      this.lastExitAt = null;
      this.lastCheckpointAt = null;
      if (restored) {
        this.save(restored, () => restoreAt);
      }
      return restored;
    } catch {
      // Unreadable/corrupt: preserve the evidence, then start fresh.
      this.quarantine(now());
      return null;
    }
  }

  save(snapshot: ReminderSnapshot, now: () => number = Date.now): void {
    // Refresh the checkpoint on every write so a crash restore has a recent
    // bound. The clean-exit marker (lastExitAt) is only set on markExiting().
    const savedAt = now();
    this.lastCheckpointAt = savedAt;
    const file: RuntimeStateFile = {
      version: SCHEMA_VERSION,
      savedAt,
      lastExitAt: this.lastExitAt,
      lastCheckpointAt: this.lastCheckpointAt,
      sessionId: this.sessionId,
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

  /** Persist a recent crash-recovery bound without writing on every UI tick. */
  startCheckpoint(getSnapshot: () => ReminderSnapshot, intervalMs = 60_000): void {
    this.stopCheckpoint();
    this.checkpointTimer = setInterval(() => this.save(getSnapshot()), Math.max(1_000, intervalMs));
    this.checkpointTimer.unref?.();
  }

  stopCheckpoint(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
  }

  private quarantine(now: number): void {
    try {
      renameSync(this.filePath, `${this.filePath}.corrupt-${now}`);
    } catch {
      // Nothing more we can do; load() will fall back to defaults.
    }
  }
}
