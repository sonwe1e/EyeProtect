# Architecture Quick-Reference

This document maps each feature area to its source files, tests, and related documentation. Use it to locate code quickly without searching the entire codebase.

## Process Split

EyeProtect uses a classic Electron 3-process architecture, each built by its own electron-vite target:

| Process | Entry | Key Directories | Responsibility |
| --- | --- | --- | --- |
| Main | `src/main/index.ts` | `src/main/` | App lifecycle, single-instance lock, tray, IPC handlers, power lifecycle, scheduler, settings, SQLite store, backup, windows |
| Preload | `src/preload/index.ts` | `src/preload/` | `contextBridge` exposing `window.eyeProtect: EyeProtectApi` — the only way the renderer touches Electron/Node |
| Renderer | `src/renderer/src/main.tsx` | `src/renderer/src/` | React UI: hash router in `App.tsx`, window views in `views/`, domain UI in `features/`, IPC hooks in `hooks/` |

Data crosses process boundaries only through typed IPC channels defined in `src/shared/types.ts` (`EyeProtectApi`). Task/project payloads are sanitized in `src/main/ipcTaskInput.ts` and `src/main/ipcProjectInput.ts`.

## Feature → Source Map

### Reminder Scheduling & Rest Rhythm

| File | Role |
| --- | --- |
| `src/main/reminders.ts` | `ReminderScheduler` — one-shot deadline timers, pause/resume, action locks, persisted break sessions |
| `src/main/scheduling/kernel.ts` | `SchedulerKernel` — shared deadline queue, single timer + watchdog |
| `src/main/scheduling/emergencyTemplate.ts` | Emergency fallback template |
| `src/main/scheduling/reminderTrace.ts` | Rolling diagnostic trace log |
| `src/main/scheduling/surfaceFallback.ts` | Renderer-crash fallback chain |
| `src/main/sceneAwareness.ts` | Foreground app detection + deferral |
| `src/main/activityMonitor.ts` | Idle/lock detection, natural-break threshold |
| `src/main/standaloneReminders.ts` | Standalone reminder CRUD + scheduling |
| `src/main/taskScheduler.ts` | Task reminder arming + consumption |
| `src/main/reminderHistory.ts` | Local health history + weekly reports |
| `tests/reminders.test.ts` | Reminder scheduling tests |
| `tests/scheduler-kernel.test.ts` | Kernel deadline queue tests |
| `tests/reminder-action-lock.test.ts` | Action lock timing tests |
| `tests/scheduler-persistence.test.ts` | Persistence across restart |
| `tests/scheduler-power.test.ts` | Power lifecycle tests |

### Settings & Configuration

| File | Role |
| --- | --- |
| `src/shared/types.ts` | `Settings`, `DEFAULT_SETTINGS`, `SETTINGS_LIMITS` |
| `src/main/settings.ts` | `SettingsStore` — atomic writes, domain-scoped events |
| `src/renderer/src/views/SettingsView.tsx` | Settings UI (embedded in Workbench) |
| `tests/settings-write.test.ts` | Atomic write + sanitization tests |

### Task / Project / Plan / Focus Data Model

| File | Role |
| --- | --- |
| `src/shared/types.ts` | All domain types: `Task`, `Project`, `DailyTaskPlan`, `TimeBlock`, `FocusSession`, `ProjectSection` |
| `src/main/taskStore.ts` | `TaskStore` — SQLite-backed CRUD, migrations, undo, recurrence rollover |
| `src/main/taskService.ts` | Service layer wrapping `TaskStore` for IPC |
| `src/main/focusSession.ts` | `FocusSessionService` — session lifecycle, break sub-state |
| `src/main/focusRuntime.ts` | `FocusRuntime` — coordinates sessions + work tracker |
| `src/main/taskWorkTracker.ts` | Work tracking, timebox notification |
| `src/main/dailyReview.ts` | Daily review aggregation |
| `tests/task-store.test.ts` | Store CRUD + migration tests |
| `tests/task-service.test.ts` | Service layer tests |
| `tests/schema-v4.test.ts` | Schema v4 planning domain tests |
| `tests/focus-session.test.ts` | Focus session lifecycle tests |
| `tests/focus-runtime.test.ts` | Focus runtime coordination tests |
| `tests/daily-planning.test.ts` | Daily planning tests |
| `tests/daily-review.test.ts` | Daily review tests |

### Today View & Planning

| File | Role |
| --- | --- |
| `src/renderer/src/features/tasks/todaySections.ts` | `deriveTodaySections` — Today's 3 / Scheduled / Flexible from DailyTaskPlan + TimeBlock |
| `src/renderer/src/features/tasks/todayViewModel.ts` | `deriveTodayExecutionModel` — unique ordered union for nav count + Focus candidates |
| `src/renderer/src/features/tasks/FocusSurface.tsx` | Focus session UI |
| `src/renderer/src/features/tasks/PlanWorkspace.tsx` | Plan timeline UI |
| `src/renderer/src/features/tasks/DailyPlanningFlow.tsx` | Daily planning flow |
| `tests/today-sections.test.ts` | Today sections derivation tests |
| `tests/today-view-model.test.ts` | Today execution model tests |

### Project Lifecycle

| File | Role |
| --- | --- |
| `src/shared/projectPolicy.ts` | Pure lifecycle rules: `isProjectAssignable`, `isProjectWritable`, `isTaskAvailableForPlanning` |
| `src/renderer/src/features/tasks/ProjectWorkspace.tsx` | Project detail page — read-only for completed/archived |
| `src/renderer/src/features/tasks/ProjectList.tsx` | Sidebar project list with lifecycle actions |
| `tests/project-policy.test.ts` | Lifecycle rule tests |

### Window Management & Surfaces

| File | Role |
| --- | --- |
| `src/main/windows.ts` | `AppWindows` — creates/destroys Alert, Bubble, Workbench, dim-overlay windows |
| `src/main/reminderSurface.ts` | `ReminderSurface` — manages reminder presentation + fallback chain |
| `src/main/windowBounds.ts` | Window bounds persistence + display-change restore |
| `src/main/displayLayout.ts` | Display topology key generation |
| `src/renderer/src/views/PetView.tsx` | Pet window view |
| `src/renderer/src/views/AlertView.tsx` | Alert/reminder window view |
| `src/renderer/src/views/BubbleView.tsx` | Bubble window view |
| `src/renderer/src/views/WorkbenchView.tsx` | Workbench window view |
| `tests/reminder-surface.test.ts` | Surface presentation tests |

### Renderer UI — Workbench

| File | Role |
| --- | --- |
| `src/renderer/src/views/WorkbenchView.tsx` | Main workbench: Today / Plan / Focus / Projects / Search / Review / Settings / Reminders / Collection |
| `src/renderer/src/features/workbench/WorkbenchSidebar.tsx` | Sidebar navigation |
| `src/renderer/src/features/workbench/WorkbenchToolbar.tsx` | Toolbar with search + pause/resume |
| `src/renderer/src/features/workbench/workbenchNavigation.ts` | Section config, order, shortcuts |
| `tests/workbench-navigation.test.ts` | Navigation config tests |

### Renderer UI — Tasks & Projects

| File | Role |
| --- | --- |
| `src/renderer/src/features/tasks/TaskComposer.tsx` | Quick-add form (Today / Inbox / Project placement) |
| `src/renderer/src/features/tasks/TaskDetail.tsx` | Task detail side-sheet with autosave |
| `src/renderer/src/features/tasks/TaskList.tsx` | Task list with drag-reorder |
| `src/renderer/src/features/tasks/PlanWorkspace.tsx` | Plan timeline with drag-drop scheduling |
| `src/renderer/src/features/tasks/ProjectWorkspace.tsx` | Project detail with board/list views |
| `src/renderer/src/features/tasks/ProjectList.tsx` | Sidebar project list |
| `src/renderer/src/features/tasks/FocusSurface.tsx` | Focus session surface |
| `tests/task-drag-reorder.test.ts` | Drag-reorder tests |
| `tests/task-row-metadata.test.ts` | Row metadata tests |
| `tests/plan-layout.test.ts` | Plan layout tests |
| `tests/project-sections.test.ts` | Project sections tests |

### Renderer UI — Reminders & Characters

| File | Role |
| --- | --- |
| `src/renderer/src/features/reminders/ActivityGuide.tsx` | Activity guide during reminders |
| `src/renderer/src/features/reminders/ReminderArtwork.tsx` | Procedural SVG artwork |
| `src/renderer/src/features/reminders/StandaloneReminderSection.tsx` | Standalone reminders UI |
| `src/renderer/src/features/characters/CharacterCollectionView.tsx` | Character collection UI |
| `src/renderer/src/features/characters/ProceduralCharacter.tsx` | Procedural character SVG |
| `src/renderer/src/features/pet/PetCharacter.tsx` | Pet character rendering |
| `src/renderer/src/features/review/DailyReview.tsx` | Daily review UI |
| `tests/characters.test.ts` | Character generation tests |
| `tests/character-service.test.ts` | Character service tests |

### Command Layer (Renderer IPC Bridge)

| File | Role |
| --- | --- |
| `src/renderer/src/lib/commands.ts` | `commands` — typed IPC wrappers returning `CommandResult<T>` |
| `src/renderer/src/hooks/useCommand.ts` | `useCommand` hook — state, pending, error, double-submit protection |
| `src/renderer/src/components/CommandButton.tsx` | Button that reflects command state |
| `src/renderer/src/components/CommandPalette.tsx` | Command palette |
| `tests/command-layer.test.ts` | Command layer tests |

### IPC Input Sanitization

| File | Role |
| --- | --- |
| `src/main/ipcTaskInput.ts` | Task create/update sanitization + `baseRevision` passthrough |
| `src/main/ipcProjectInput.ts` | Project create/update sanitization |
| `tests/ipc-task-input.test.ts` | Task input sanitization tests |
| `tests/ipc-project-input.test.ts` | Project input sanitization tests |

### Styling & Design Tokens

| File | Role |
| --- | --- |
| `src/renderer/src/styles/tokens.css` | Non-color foundations (spacing, radius, typography, motion) |
| `src/renderer/src/styles/theme.css` | Semantic colors (light/dark) |
| `src/renderer/src/styles.css` | Legacy window styles (pet, reminder, bubble, embedded settings) |
| `tests/design-system-contract.test.ts` | Color/token ownership tests |
| `tests/theme-authority.test.ts` | Theme authority tests |
| `docs/color-system.md` | Color system design intent + contrast baselines |

### Backup, Recovery & Data

| File | Role |
| --- | --- |
| `src/main/backup.ts` | JSON backup import/export, snapshot creation |
| `src/main/runtimeState.ts` | Runtime state persistence (scheduler pause, eye/walk cycle) |
| `src/main/notificationDelivery.ts` | Notification delivery queue, retry, dead-letter |
| `tests/backup.test.ts` | Backup round-trip tests |
| `tests/runtime-state.test.ts` | Runtime state persistence tests |
| `tests/notification-delivery.test.ts` | Delivery queue tests |

### Security & Hardening

| File | Role |
| --- | --- |
| `src/main/security.ts` | Renderer URL trust check, IPC origin validation |
| `docs/hardening-notes.md` | Audit findings + fixes |
| `tests/security.test.ts` | Security tests |

## Key Patterns

### Adding a New IPC Capability

1. Add the method signature to `EyeProtectApi` in `src/shared/types.ts`
2. Add the preload bridge in `src/preload/index.ts`
3. Add the IPC handler in `src/main/index.ts` (keep the sender URL trust check)
4. Add the command wrapper in `src/renderer/src/lib/commands.ts`
5. If the input crosses the process boundary with new fields, whitelist them in `src/main/ipcTaskInput.ts` or `src/main/ipcProjectInput.ts`

### Adding a New Settings Field

1. Add the field to `Settings` interface in `src/shared/types.ts`
2. Add the default value to `DEFAULT_SETTINGS`
3. Add the limit to `SETTINGS_LIMITS` if applicable
4. Update `SettingsView.tsx` with the UI control
5. Add tests in `tests/settings-write.test.ts`

### Adding a New Task Field

1. Add the field to `Task` interface in `src/shared/types.ts`
2. Add it to `TaskInput` if the renderer can supply it
3. Add it to `sanitizeTask()` in `src/shared/types.ts`
4. Whitelist it in `src/main/ipcTaskInput.ts`
5. Add a column migration in `src/main/taskStore.ts` (`migrateSchema()`)
6. Update `rowToTask` and `taskSqlValues` in `src/main/taskStore.ts`
7. Update `tests/task-store.test.ts`

## Generated / Runtime Directories

Do not edit or commit:
- `data/` — `settings.json`, `runtime-state.json`, `reminder-history.json`, `eyeprotect.db`, `reminder-trace.log`
- `out/` — build output
- `release/` — packaged installers
- `node_modules/` — dependencies
