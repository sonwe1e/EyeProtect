import type { FocusStatus, TaskCheckpointDraft } from '../shared/types';
import type { FocusSessionService } from './focusSession';
import type { TaskWorkTracker } from './taskWorkTracker';

/** Keeps the logical focus session and precise work tracker on one timeline. */
export class FocusRuntime {
  constructor(
    private readonly sessions: FocusSessionService,
    private readonly work: TaskWorkTracker,
    private readonly setActiveTask: (taskId: string | null) => void,
    private readonly isHealthBreakActive: () => boolean = () => false
  ) {}

  start(taskId: string, timeBlockId: string | null = null): FocusStatus {
    return this.switchTo(taskId, null, timeBlockId);
  }

  switchTo(
    taskId: string,
    checkpoint: TaskCheckpointDraft | null = null,
    timeBlockId: string | null = null
  ): FocusStatus {
    const current = this.sessions.getStatus();
    if (current.session?.onBreak || this.isHealthBreakActive()) {
      return current;
    }
    this.work.flush();
    const status = this.sessions.switchTo(taskId, checkpoint, timeBlockId);
    this.setActiveTask(status.session?.taskId ?? null);
    return status;
  }

  pause(checkpoint: TaskCheckpointDraft | null = null): FocusStatus {
    const taskId = this.sessions.getStatus().session?.taskId ?? null;
    this.work.flush();
    const status = this.sessions.pause(checkpoint);
    this.setActiveTask(taskId);
    return status;
  }

  complete(): FocusStatus {
    this.work.flush();
    const status = this.sessions.complete();
    this.setActiveTask(null);
    return status;
  }

  resume(): FocusStatus {
    const current = this.sessions.getStatus();
    if (current.session?.onBreak || this.isHealthBreakActive()) {
      return current;
    }
    this.work.flush();
    const status = this.sessions.resume();
    this.setActiveTask(status.session?.taskId ?? null);
    return status;
  }

  beginBreak(): FocusStatus {
    this.work.pause();
    return this.sessions.beginBreak();
  }

  endBreak(naturalBreak: boolean = false): FocusStatus {
    const status = this.sessions.endBreak();
    this.work.resume(naturalBreak);
    return status;
  }
}
