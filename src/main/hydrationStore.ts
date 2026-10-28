import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localDateKey } from '../shared/calendar';
import { emptyHydrationDay, type HydrationDayState } from '../shared/hydration';
import { logger } from './logger';

const FILE_NAME = 'hydration-state.json';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Today's cup count, in its own file.
 *
 * Deliberately NOT settings.json: writing it 8 times a day would turn the user's
 * preference file into a counter, and every `settingsStore.save` also re-syncs
 * the startup shortcut and broadcasts the whole settings object (a full window
 * repaint). Deliberately NOT the task database either: the database can enter
 * read-only recovery mode, and drinking water must not stop working because of a
 * task-store problem. It is also deliberately not part of the backup format —
 * today's count has no value on another machine.
 */
export class HydrationStore {
  private readonly filePath: string;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.filePath = join(directory, FILE_NAME);
  }

  getPath(): string {
    return this.filePath;
  }

  /** Read as a best-effort snapshot; anything unreadable becomes an empty day. */
  load(now: number): HydrationDayState {
    const today = localDateKey(now);
    if (!existsSync(this.filePath)) return emptyHydrationDay(today);
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<HydrationDayState>;
      const localDate = typeof raw.localDate === 'string' && DATE_KEY.test(raw.localDate) ? raw.localDate : today;
      const cups = typeof raw.cups === 'number' && Number.isFinite(raw.cups)
        ? Math.max(0, Math.round(raw.cups))
        : 0;
      return {
        localDate,
        cups,
        lastCupAt: typeof raw.lastCupAt === 'number' && Number.isFinite(raw.lastCupAt) ? raw.lastCupAt : null,
        lastPromptAt: typeof raw.lastPromptAt === 'number' && Number.isFinite(raw.lastPromptAt) ? raw.lastPromptAt : null
      };
    } catch (error) {
      // A corrupt counter is not worth a recovery dialog: the day restarts at 0.
      logger.warn('hydration state is unreadable; starting today from zero', error);
      return emptyHydrationDay(today);
    }
  }

  /** Atomic replace: a crash mid-write must never leave a half-written day. */
  save(state: HydrationDayState): void {
    const payload = JSON.stringify(state);
    writeFileSync(`${this.filePath}.tmp`, payload, 'utf8');
    renameSync(`${this.filePath}.tmp`, this.filePath);
  }
}
