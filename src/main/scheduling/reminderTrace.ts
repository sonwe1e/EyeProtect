import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rolling local reminder-event trace (USERPLAN §四.B). Records the lifecycle of
 * every timed event the kernel and scheduler touch:
 *
 *   scheduled → gate → window-create → shown → action → reschedule
 *
 * So a user report of "the 14:20 eye reminder never popped up" can be answered
 * from data instead of guesswork. Single-line JSON: one object per line, a tiny
 * self-describing log that survives restarts and caps its own size.
 */

export interface ReminderTraceEntry {
  /** Epoch ms when the entry was written. */
  t: number
  /** Origin writer: the kernel, the scheduler, or a surface. */
  src: 'kernel' | 'scheduler' | 'surface' | 'alarm'
  /** Coarse lifecycle phase. */
  event: string
  /** Optional structured detail (kind, id, owner, deadline, …). */
  data?: Record<string, unknown>
}

const MAX_BYTES = 1024 * 1024; // 1 MB cap; roll to a single `.prev` backup.
const MAX_RECENT = 50;

/** The sink both the real tracer and the no-op implement. */
export interface ReminderTraceSink {
  append(entry: ReminderTraceEntry): void
  flush(): void
  recent(count?: number): ReminderTraceEntry[]
}

export class ReminderTrace implements ReminderTraceSink {
  private readonly filePath: string;
  private readonly prevPath: string;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'reminder-trace.log');
    this.prevPath = `${this.filePath}.prev`;
  }

  /** Append one entry; flushed to disk on the next tick to batch bursts. */
  append(entry: ReminderTraceEntry): void {
    this.buffer.push(JSON.stringify(entry));
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 250);
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  /** Write through whatever is buffered, rolling the file if it grew too large. */
  flush(): void {
    if (this.buffer.length === 0) {
      return;
    }
    const lines = this.buffer;
    this.buffer = [];
    try {
      mkdirSync(join(this.filePath, '..'), { recursive: true });
      if (this.overLimit()) {
        this.rotate();
      }
      appendFileSync(this.filePath, `${lines.join('\n')}\n`, 'utf8');
    } catch {
      // Trace is observability only; a failed write must never crash the app.
    }
  }

  /** Most-recent entries (newest last), for diagnostics/recovery-info. */
  recent(count = MAX_RECENT): ReminderTraceEntry[] {
    this.flush();
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return raw
        .split('\n')
        .filter((line) => line.trim())
        .slice(-count)
        .map((line) => JSON.parse(line) as ReminderTraceEntry);
    } catch {
      return [];
    }
  }

  private overLimit(): boolean {
    try {
      return statSync(this.filePath).size > MAX_BYTES;
    } catch {
      return false;
    }
  }

  private rotate(): void {
    try {
      rmSync(this.prevPath, { force: true });
      renameSync(this.filePath, this.prevPath);
    } catch {
      // No existing file to rotate, or a rename race — nothing to do.
    }
  }
}

/** No-op sink used when tracing is disabled (keaves the call sites allocation-free). */
export const noopReminderTrace: ReminderTraceSink = {
  append: () => {},
  flush: () => {},
  recent: () => [] as ReminderTraceEntry[]
};
