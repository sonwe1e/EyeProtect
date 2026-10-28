import type {
  AppHealth,
  CustomPetAssets,
  DataActionResult,
  DataRecoveryInfo,
  EyeProtectApi,
  FailedDeliveryNotice,
  HotkeyStatus,
  HydrationStatus,
  LegacyData,
  PetPosition,
  PetReactionEvent,
  PomodoroState,
  Project,
  ReminderStatus,
  RestCompanionSummary,
  RuntimeInfo,
  Settings,
  Task,
  UndoState,
  WorkbenchNavPayload
} from '../../../shared/types';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauriRuntime = (): boolean => '__TAURI_INTERNALS__' in window;

/**
 * Tauri mirror of the Electron preload bridge (`src/preload/index.ts`).
 *
 * Invoke command names map from the Electron IPC channels (colons become
 * underscores, camelCase verbs become snake_case); event names stay identical
 * so renderer code can subscribe through the same channels. Multi-argument
 * commands pass one object whose camelCase keys Tauri maps to Rust
 * snake_case parameters.
 */
export const installTauriBridge = async (): Promise<void> => {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  const on = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
    const pending = listen<T>(channel, (event) => callback(event.payload));
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  };

  const api: EyeProtectApi = {
    // ── Settings / app health ──────────────────────────────────────────────
    getSettings: () => invoke<Settings>('settings_get'),
    saveSettings: (settings) => invoke<Settings>('settings_save', { patch: settings }),
    onSettingsChanged: (callback) => on<Settings>('settings:changed', callback),
    getRuntimeInfo: () => invoke<RuntimeInfo>('runtime_get'),
    getAppHealth: () => invoke<AppHealth>('app_health_get'),
    onAppHealthChanged: (callback) => on<AppHealth>('app:health:changed', callback),
    relaunchApp: () => invoke<void>('app_relaunch'),

    // ── Health reminders ───────────────────────────────────────────────────
    getReminderStatus: () => invoke<ReminderStatus>('reminder_status'),
    reminderAction: (action, reminderId) =>
      invoke<ReminderStatus>('reminder_action', { action, reminderId }),
    preAlertAction: (action) => invoke<ReminderStatus>('reminder_pre_alert', { action }),
    testReminder: (kind) => invoke<ReminderStatus>('reminder_test', { kind }),
    triggerNow: () => invoke<ReminderStatus>('reminder_now'),
    pause: (minutes) => invoke<ReminderStatus>('reminder_pause', { minutes }),
    resume: () => invoke<ReminderStatus>('reminder_resume'),
    restartCycle: () => invoke<ReminderStatus>('reminder_restart'),
    onReminderChanged: (callback) => on<ReminderStatus>('reminder:changed', callback),
    beginHealthRest: (id) => invoke<ReminderStatus>('reminder_begin_rest', { id }),
    getRestCompanion: () => invoke<RestCompanionSummary>('reminder_companion'),
    onRestCompanionChanged: (callback) =>
      on<RestCompanionSummary>('reminder:companion-changed', callback),
    onPetReaction: (callback) => on<PetReactionEvent>('pet:reaction', callback),

    // ── Hydration ──────────────────────────────────────────────────────────
    getHydration: () => invoke<HydrationStatus>('hydration_get'),
    recordHydrationCup: () => invoke<HydrationStatus>('hydration_record'),
    dismissHydrationPrompt: () => invoke<HydrationStatus>('hydration_dismiss'),
    onHydrationChanged: (callback) => on<HydrationStatus>('hydration:changed', callback),

    // ── Pomodoro ───────────────────────────────────────────────────────────
    preparePomodoro: (taskId, replace) =>
      invoke<PomodoroState>('pomodoro_prepare', { taskId, replace }),
    getPomodoro: () => invoke<PomodoroState>('pomodoro_get'),
    startPomodoro: (taskId, minutes, replace) =>
      invoke<PomodoroState>('pomodoro_start', { taskId, minutes, replace }),
    pomodoroAction: (action) => invoke<PomodoroState>('pomodoro_action', { action }),
    onPomodoroChanged: (callback) => on<PomodoroState>('pomodoro:changed', callback),

    // ── Tasks / lists ──────────────────────────────────────────────────────
    getTasks: () => invoke<Task[]>('task_list'),
    createTask: (input) => invoke<Task[]>('task_create', { input }),
    updateTask: (id, input) => invoke<Task[]>('task_update', { id, input }),
    moveTask: (input) => invoke<Task[]>('task_move', { input }),
    reorderTaskQueue: (orderedIds) => invoke<Task[]>('task_reorder_queue', { ids: orderedIds }),
    setTaskStatus: (id, status) => invoke<Task[]>('task_set_status', { id, status }),
    deleteTask: (id) => invoke<Task[]>('task_delete', { id }),
    completeTaskTree: (id, revisions) =>
      invoke<Task[]>('task_complete_tree', { id, revisions }),
    moveStep: (id, direction) => invoke<Task[]>('task_move_step', { id, direction }),
    createStep: (rootId, title) => invoke<Task[]>('task_create_step', { rootId, title }),
    getUndoState: () => invoke<UndoState | null>('task_undo_get'),
    undoTaskOperation: (operationId) => invoke<Task[]>('task_undo', { operationId }),
    onUndoChanged: (callback) => on<UndoState | null>('task:undo-changed', callback),
    onTasksChanged: (callback) => on<Task[]>('task:changed', callback),
    onTaskUpserted: (callback) => on<Task>('task:upserted', callback),
    onTaskRemoved: (callback) => on<string>('task:removed', callback),

    getProjects: () => invoke<Project[]>('project_list'),
    createProject: (input) => invoke<Project[]>('project_create', { input }),
    updateProject: (id, input) => invoke<Project[]>('project_update', { id, input }),
    deleteProject: (id) => invoke<Project[]>('project_delete', { id }),
    onProjectsChanged: (callback) => on<Project[]>('project:changed', callback),
    onProjectUpserted: (callback) => on<Project>('project:upserted', callback),
    onProjectRemoved: (callback) => on<string>('project:removed', callback),

    setActiveTask: (id) => invoke<Task[]>('task_active_set', { id }),

    getFailedDeliveries: () => invoke<FailedDeliveryNotice[]>('delivery_failed_list'),
    retryFailedDelivery: (id) => invoke<FailedDeliveryNotice[]>('delivery_failed_retry', { id }),
    dismissFailedDelivery: (id) =>
      invoke<FailedDeliveryNotice[]>('delivery_failed_dismiss', { id }),
    onFailedDeliveriesChanged: (callback) =>
      on<FailedDeliveryNotice[]>('delivery:failed-changed', callback),

    // ── Windows / pet / bubble ─────────────────────────────────────────────
    reportPetArtworkBounds: (bounds) =>
      invoke<void>('window_pet_artwork_bounds', { top: bounds.top, bottom: bounds.bottom }),
    reportBubbleHeight: (height) => invoke<void>('window_bubble_height', { height }),
    onBubbleLayout: (callback) =>
      on<{ placement: 'above' | 'below'; tailX: number }>('bubble:layout', callback),
    movePetWindow: (position) => invoke<PetPosition | null>('window_pet_move', { position }),
    showPetContextMenu: () => invoke<void>('window_pet_context_menu'),
    togglePetVisibility: () => invoke<boolean>('window_pet_toggle_visibility'),
    recallPet: () => invoke<void>('window_pet_recall'),
    openWorkbench: (section = 'today', focusTaskId = null) =>
      invoke<void>('window_workbench_open', { section, focusTaskId }),
    closeWorkbench: () => invoke<void>('window_workbench_close'),
    getWorkbenchSection: () => invoke<WorkbenchNavPayload>('window_workbench_section'),
    onWorkbenchNavigate: (callback) => on<WorkbenchNavPayload>('workbench:navigate', callback),

    openCustomPetFolder: () =>
      invoke<{ success: boolean; message: string }>('pet_custom_open_folder'),
    getCustomPetAssets: () => invoke<CustomPetAssets>('pet_custom_get_assets'),

    // ── Data / backup / compat ─────────────────────────────────────────────
    exportBackup: () => invoke<DataActionResult>('data_backup_export'),
    importBackup: () => invoke<DataActionResult>('data_backup_import'),
    resetToDefaults: () => invoke<DataActionResult>('data_reset'),
    openDataDirectory: () => invoke<DataActionResult>('data_open_directory'),
    getDataRecoveryInfo: () => invoke<DataRecoveryInfo>('data_recovery_info'),
    getLegacyData: () => invoke<LegacyData>('data_legacy'),
    restoreLegacyTask: (id) => invoke<Task[]>('task_restore_legacy', { id }),

    getHotkeyStatus: () => invoke<HotkeyStatus>('hotkeys_status'),
    onHotkeyStatusChanged: (callback) => on<HotkeyStatus>('hotkeys:changed', callback)
  };

  (window as { eyeProtect?: EyeProtectApi }).eyeProtect = api;
};
