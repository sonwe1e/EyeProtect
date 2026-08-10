/**
 * Renderer command layer (USERPLAN §十五, §二十七).
 *
 * Every user mutation MUST go through here. These functions wrap the
 * `window.eyeProtect` IPC bridge and normalise both success and failure into a
 * single `CommandResult<T>` — so a component can never `void` a promise and
 * silently swallow an error. Success carries the domain data; failure carries a
 * stable {@link ErrorCode}, a human message, and whether the user can retry.
 *
 * The domain data types mirror the IPC return shapes exactly, so the optimistic
 * push events (`task:changed`, `project:changed`, …) keep working unchanged.
 */
import type {
  CharacterCollectionState,
  CommandResult,
  DailyTaskPlan,
  DailyTaskPlanInput,
  DataActionResult,
  FailedDeliveryNotice,
  Project,
  ProjectInput,
  ProjectUpdateInput,
  ReminderAction,
  ReminderKind,
  ReminderStatus,
  Settings,
  StandaloneReminder,
  StandaloneReminderInput,
  Task,
  TaskInput,
  TaskMoveInput,
  TaskStatus,
  TaskUpdateInput,
  WeeklyReport
} from '../../../shared/types';
import { toCommandResult } from '../../../shared/types';

/** Run an IPC command, catching any rejection into a structured result. */
const run = <T>(ipcCall: () => Promise<T>): Promise<CommandResult<T>> =>
  ipcCall()
    .then((data): CommandResult<T> => ({ ok: true, data }))
    .catch((err): CommandResult<never> => toCommandResult(err));

export const commands = {
  // ── Tasks ──────────────────────────────────────────────────────────────────
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

  // ── Projects ───────────────────────────────────────────────────────────────
  projects: {
    create: (input: ProjectInput) =>
      run<Project[]>(() => window.eyeProtect.createProject(input)),
    update: (id: string, input: ProjectUpdateInput) =>
      run<Project[]>(() => window.eyeProtect.updateProject(id, input)),
    remove: (id: string) =>
      run<Project[]>(() => window.eyeProtect.deleteProject(id))
  },

  // ── Daily planning (USERPLAN 1.2 PR3) ───────────────────────────────
  // Mutations return the full plan list of the affected local date so callers
  // can apply the fresh state without a second round-trip.
  planning: {
    upsert: (input: DailyTaskPlanInput) =>
      run<DailyTaskPlan[]>(() => window.eyeProtect.upsertDailyPlan(input)),
    remove: (taskId: string, localDate: string) =>
      run<DailyTaskPlan[]>(() => window.eyeProtect.removeDailyPlan(taskId, localDate))
  },

  // ── Characters ─────────────────────────────────────────────────────────────
  characters: {
    collect: () =>
      run<CharacterCollectionState>(() => window.eyeProtect.collectDailyCharacter()),
    discard: () =>
      run<CharacterCollectionState>(() => window.eyeProtect.discardDailyCharacter()),
    rename: (id: string, name: string) =>
      run<CharacterCollectionState>(() => window.eyeProtect.renameCharacter(id, name)),
    remove: (id: string) =>
      run<CharacterCollectionState>(() => window.eyeProtect.deleteCharacter(id)),
    setFavorite: (id: string, favorite: boolean) =>
      run<CharacterCollectionState>(() => window.eyeProtect.setCharacterFavorite(id, favorite)),
    setAppearance: (mode: Parameters<typeof window.eyeProtect.setCharacterAppearance>[0], id?: string | null) =>
      run<CharacterCollectionState>(() => window.eyeProtect.setCharacterAppearance(mode, id)),
    setMaterial: (id: string, material: Parameters<typeof window.eyeProtect.setCharacterMaterial>[1]) =>
      run<CharacterCollectionState>(() => window.eyeProtect.setCharacterMaterial(id, material)),
    setAccessory: (id: string, accessory: Parameters<typeof window.eyeProtect.setCharacterAccessory>[1]) =>
      run<CharacterCollectionState>(() => window.eyeProtect.setCharacterAccessory(id, accessory))
  },

  // ── Standalone reminders ────────────────────────────────────────────────────
  reminders: {
    create: (input: StandaloneReminderInput) =>
      run<StandaloneReminder[]>(() => window.eyeProtect.createStandaloneReminder(input)),
    update: (id: string, input: Partial<StandaloneReminderInput>) =>
      run<StandaloneReminder[]>(() => window.eyeProtect.updateStandaloneReminder(id, input)),
    remove: (id: string) =>
      run<StandaloneReminder[]>(() => window.eyeProtect.deleteStandaloneReminder(id))
  },

  // ── Failed deliveries ──────────────────────────────────────────────────────
  deliveries: {
    retry: (id: string) =>
      run<FailedDeliveryNotice[]>(() => window.eyeProtect.retryFailedDelivery(id)),
    dismiss: (id: string) =>
      run<FailedDeliveryNotice[]>(() => window.eyeProtect.dismissFailedDelivery(id))
  },

  // ── Reminder actions (USERPLAN §十 Rest loop) ───────────────────────────────
  // Acting on the active break (complete/snooze/skipp) and the soft pre-alert.
  // These return a fresh ReminderStatus; the result is currently reflected via
  // the pushed reminder:changed event, but routing them through the command
  // layer guarantees a rejection is never an unhandled promise.
  reminderActions: {
    act: (action: ReminderAction, reminderId: string) =>
      run<ReminderStatus>(() => window.eyeProtect.reminderAction(action, reminderId)),
    preAlert: (action: Parameters<typeof window.eyeProtect.preAlertAction>[0]) =>
      run<ReminderStatus>(() => window.eyeProtect.preAlertAction(action))
  },

  // ── Scheduler controls ─────────────────────────────────────────────────────
  // Pause/resume/restart and the manual "rest now" / test triggers.
  scheduler: {
    pause: (minutes: number) =>
      run<ReminderStatus>(() => window.eyeProtect.pause(minutes)),
    resume: () =>
      run<ReminderStatus>(() => window.eyeProtect.resume()),
    restartCycle: () =>
      run<ReminderStatus>(() => window.eyeProtect.restartCycle()),
    triggerNow: () =>
      run<ReminderStatus>(() => window.eyeProtect.triggerNow()),
    test: (kind: ReminderKind) =>
      run<ReminderStatus>(() => window.eyeProtect.testReminder(kind))
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  // Persisting preferences. Surfaced separately so the settings UI can show a
  // structured save-error (e.g. disk-full) instead of silently swallowing it.
  settings: {
    save: (patch: Partial<Settings>) =>
      run<Settings>(() => window.eyeProtect.saveSettings(patch))
  },

  // ── Data management ─────────────────────────────────────────────────────────
  // Backup import/export, history export/clear, reset, and opening the data dir.
  data: {
    exportBackup: () =>
      run<DataActionResult>(() => window.eyeProtect.exportBackup()),
    importBackup: () =>
      run<DataActionResult>(() => window.eyeProtect.importBackup()),
    resetToDefaults: () =>
      run<DataActionResult>(() => window.eyeProtect.resetToDefaults()),
    exportHistory: (format: 'json' | 'csv') =>
      run<boolean>(() => window.eyeProtect.exportReminderHistory(format)),
    clearHistory: () =>
      run<WeeklyReport>(() => window.eyeProtect.clearReminderHistory()),
    openDataDirectory: () =>
      run<DataActionResult>(() => window.eyeProtect.openDataDirectory())
  },

  // ── App lifecycle ────────────────────────────────────────────────────────────
  // Relaunch (used by the fail-loud health banner to exit recovery mode). A
  // renderer-only reload cannot leave recovery mode, so this restarts the app.
  system: {
    relaunch: () =>
      run<void>(() => window.eyeProtect.relaunchApp())
  }
};
