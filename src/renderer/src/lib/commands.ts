/**
 * Renderer command layer.
 *
 * Mutations wrap `window.eyeProtect` and normalise success/failure into
 * `CommandResult<T>`. Only groups that the simplified product (and its tests)
 * still use are listed here — planning/focus/section command groups were
 * removed with their dead IPC surface. See docs/architecture.md.
 */
import type {
  CommandResult,
  DataActionResult,
  FailedDeliveryNotice,
  Project,
  ProjectInput,
  ProjectUpdateInput,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  Settings,
  Task,
  TaskInput,
  TaskMoveInput,
  TaskStatus,
  TaskUpdateInput
} from '../../../shared/types';
import { toCommandResult } from '../../../shared/types';

/** Run an IPC command, catching any rejection into a structured result. */
export const run = async <T>(ipcCall: () => Promise<T>): Promise<CommandResult<T>> => {
  try {
    return { ok: true, data: await ipcCall() };
  } catch (error) {
    return toCommandResult(error);
  }
};

export const commands = {
  tasks: {
    create: (input: TaskInput) =>
      run<Task[]>(() => window.eyeProtect.createTask(input)),
    update: (id: string, input: TaskUpdateInput) =>
      run<Task[]>(() => window.eyeProtect.updateTask(id, input)),
    setStatus: (id: string, status: TaskStatus) =>
      run<Task[]>(() => window.eyeProtect.setTaskStatus(id, status)),
    delete: (id: string) =>
      run<Task[]>(() => window.eyeProtect.deleteTask(id)),
    move: (input: TaskMoveInput) =>
      run<Task[]>(() => window.eyeProtect.moveTask(input)),
    undo: (operationId: string) =>
      run<Task[]>(() => window.eyeProtect.undoTaskOperation(operationId)),
    setActive: (id: string | null) =>
      run<Task[]>(() => window.eyeProtect.setActiveTask(id))
  },
  projects: {
    create: (input: ProjectInput) =>
      run<Project[]>(() => window.eyeProtect.createProject(input)),
    update: (id: string, input: ProjectUpdateInput) =>
      run<Project[]>(() => window.eyeProtect.updateProject(id, input)),
    delete: (id: string) =>
      run<Project[]>(() => window.eyeProtect.deleteProject(id))
  },
  deliveries: {
    retry: (id: string) =>
      run<FailedDeliveryNotice[]>(() => window.eyeProtect.retryFailedDelivery(id)),
    dismiss: (id: string) =>
      run<FailedDeliveryNotice[]>(() => window.eyeProtect.dismissFailedDelivery(id))
  },
  reminders: {
    action: (action: ReminderAction, reminderId: string) =>
      run<ReminderStatus>(() => window.eyeProtect.reminderAction(action, reminderId)),
    test: (kind: ReminderKind) =>
      run<ReminderStatus>(() => window.eyeProtect.testReminder(kind)),
    beginRest: (id: string) =>
      run<ReminderStatus>(() => window.eyeProtect.beginHealthRest(id))
  },
  pomodoro: {
    prepare: (taskId: string | null, replace: boolean) =>
      run(() => window.eyeProtect.preparePomodoro(taskId, replace)),
    start: (taskId: string | null, minutes: number, replace: boolean) =>
      run(() => window.eyeProtect.startPomodoro(taskId, minutes, replace)),
    action: (action: 'pause' | 'resume' | 'stop' | 'break') =>
      run(() => window.eyeProtect.pomodoroAction(action))
  },
  settings: {
    save: (patch: Partial<Settings>) =>
      run<Settings>(() => window.eyeProtect.saveSettings(patch))
  },
  data: {
    exportBackup: () =>
      run<DataActionResult>(() => window.eyeProtect.exportBackup()),
    importBackup: () =>
      run<DataActionResult>(() => window.eyeProtect.importBackup()),
    openDataDirectory: () =>
      run<DataActionResult>(() => window.eyeProtect.openDataDirectory()),
    restoreLegacyTask: (id: string) =>
      run<Task[]>(() => window.eyeProtect.restoreLegacyTask(id))
  },
  system: {
    relaunch: () => run<void>(() => window.eyeProtect.relaunchApp()),
    openCustomPetFolder: () =>
      run(() => window.eyeProtect.openCustomPetFolder())
  }
};
