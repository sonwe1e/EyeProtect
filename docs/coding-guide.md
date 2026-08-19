# Coding Guide

This document bridges the universal engineering rules in `RULES.md` with the concrete patterns used in EyeProtect. When the two conflict, `RULES.md` wins.

## 1. The Command Layer Is Mandatory

Every user mutation flows through the command layer. A component may never `void` an IPC call or silently swallow a failure.

**Pattern:**
```tsx
// commands.ts — typed IPC wrapper
export const commands = {
  tasks: {
    create: (input: TaskInput) =>
      run<Task[]>(() => window.eyeProtect.createTask(input)),
  },
};

// useCommand.ts — state + double-submit protection
const create = useCommand(async ({ input }: { input: TaskInput }) => {
  const result = await commands.tasks.create(input);
  if (!result.ok) return result; // failure is visible, not swallowed
  return result;
});

// CommandButton.tsx — reflects pending/error state
<CommandButton state={create.state} errorReason={create.error?.message} onClick={() => void create.run({ input })}>
  添加
</CommandButton>
```

**Rule reference:** `RULES.md` §14 (Make failure understandable) — a mutation that fails silently is worse than one that fails loudly.

## 2. Cross-Process Data Lives in One Place

Types shared between main, preload, and renderer must be defined in `src/shared/types.ts`. Never duplicate a type across process boundaries.

**Pattern:**
```typescript
// src/shared/types.ts — single source of truth
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string | null;
  // ...
}

// src/preload/index.ts — exposes the typed API
contextBridge.exposeInMainWorld('eyeProtect', {
  createTask: (input: TaskInput) => ipcRenderer.invoke('task:create', input),
});

// src/main/index.ts — validates and handles
ipcMain.handle('task:create', (event, input) => {
  if (!isTrustedSender(event.sender.url)) return;
  return taskStore.createTask(sanitizeTaskInput(input));
});
```

**Rule reference:** `RULES.md` §10 (Create abstractions for concepts) and §12 (Make data and state easy to follow).

## 3. Sanitize at the IPC Boundary

Every field that crosses the process boundary must be whitelisted. Task and project sanitizers live in `src/main/ipcTaskInput.ts` and `src/main/ipcProjectInput.ts`.

**Pattern:**
```typescript
// ipcTaskInput.ts — whitelist + transform
export const sanitizeTaskUpdateInput = (input: TaskUpdateInput): WhitelistedTaskUpdate => ({
  title: typeof input.title === 'string' ? input.title.slice(0, TASK_TITLE_MAX) : undefined,
  status: input.status && TASK_STATUSES.includes(input.status) ? input.status : undefined,
  baseRevision: typeof input.baseRevision === 'number' ? input.baseRevision : undefined,
  // ... every field explicitly listed
});
```

**Rule reference:** `RULES.md` §1 (Understand before changing) — an unvalidated field is a latent bug.

## 4. The Pet Window Stays Lightweight

The always-resident pet window subscribes only to lightweight channels (pending-task count, care status, reminder status, character collection). It never receives the full task list.

**Pattern:**
```typescript
// ✅ Correct — lightweight channel for the pet
window.eyeProtect.onPendingTaskCountChanged(setCount);

// ❌ Wrong — full task list in the pet window
window.eyeProtect.onTasksChanged(setTasks); // never do this
```

**Rule reference:** `RULES.md` §5 (Preserve scope) — don't subscribe a window to data it doesn't need.

## 5. Renderer Never Touches Node/Electron Directly

Only `window.eyeProtect` is available to the renderer. No `require('fs')`, no `require('electron')`, no `process.env`.

**Pattern:**
```tsx
// ✅ Correct — via preload bridge
const tasks = await window.eyeProtect.getTasks();

// ❌ Wrong — direct Node access in renderer
import { readFileSync } from 'fs'; // never do this
```

## 6. Window Transparency and Drag

`-webkit-app-region: drag` makes a region draggable. Interactive elements (buttons, inputs) must override with `-webkit-app-region: no-drag`.

**Pattern:**
```css
/* ✅ Correct — interactive elements stay clickable */
.pet-drag-handle { pointer-events: none; -webkit-app-region: no-drag; }
button { -webkit-app-region: no-drag; }
```

## 7. Project Lifecycle Gates All Mutations

`src/shared/projectPolicy.ts` is the single source of truth for what a project status allows. Every consumer that creates, edits, or plans tasks must route through these functions.

**Pattern:**
```typescript
// projectPolicy.ts
export const isProjectAssignable = (project: Project | null | undefined): boolean =>
  project?.status === 'active';

export const isProjectWritable = (project: Project | null | undefined): boolean =>
  project?.status === 'active' || project?.status === 'onHold';

export const isTaskAvailableForPlanning = (task: Task, project: Project | null | undefined): boolean => {
  if (!task.projectId) return true;
  if (!project) return true;
  return project.status === 'active' || project.status === 'onHold';
};

// TaskComposer.tsx — filter dropdown
const assignableProjects = projects.filter(isProjectAssignable);

// todaySections.ts — filter Today candidates
const activeTasks = tasks.filter(
  (task) => task.status === 'open' && isTaskAvailableForPlanning(task, projectById.get(task.projectId))
);
```

**Rule reference:** `RULES.md` §6 (Prefer local change) — when the lifecycle model changes, only `projectPolicy.ts` should need updating.

## 8. Test Naming and Placement

Tests use `*.test.ts` in `tests/`. They run under Node's built-in test runner (`tsx --test`).

**Conventions:**
- One test file per source file: `src/main/taskStore.ts` → `tests/task-store.test.ts`
- Pure helpers (no IPC/DB) can be tested directly
- Main-process code that needs Electron is tested via `tests/electron-loader.mjs` + `tests/electron-stub.mjs`
- UI contract tests (`tests/design-system-contract.test.ts`, `tests/theme-authority.test.ts`) run separately via `npm run verify:ui-contract`

**Rule reference:** `RULES.md` §17 (Verify what matters) — a change that breaks a test is a signal, not an obstacle.

## 9. Settings Changes Require Three-Part Updates

When adding a settings field:
1. `src/shared/types.ts` — add to `Settings` interface + `DEFAULT_SETTINGS` + `SETTINGS_LIMITS`
2. `src/main/settings.ts` — the store reads/writes `settings.json`; sanitization happens on read
3. `src/renderer/src/views/SettingsView.tsx` — add the UI control

**Rule reference:** `RULES.md` §18 (Documentation is part of the system) — when the data model changes, all three layers must agree.

## 10. Today and Focus Must Agree

`deriveTodayExecutionModel` in `src/renderer/src/features/tasks/todayViewModel.ts` is the single source of truth for what appears in Today, what shows in the nav badge, and what Focus candidates are available. Never derive these independently.

**Pattern:**
```typescript
// WorkbenchView.tsx — one call powers everything
const todayModel = useMemo(
  () => deriveTodayExecutionModel(tasks, todayPlans, scheduledTodayIds, projects),
  [tasks, todayPlans, scheduledTodayIds, projects]
);

// FocusSurface.tsx — candidates come from todayModel.tasks
<FocusSurface candidates={todayModel.tasks} />
```

**Rule reference:** `RULES.md` §3 (Choose the simplest good solution) — one derivation, multiple consumers.

## 11. IPC Channel Naming

Channels are scoped by domain: `task:create`, `project:update`, `settings:save`, `focus:start`. The domain prefix groups related capabilities and makes the preload ↔ main contract auditable.

**Pattern:**
```typescript
// preload
'task:create': (input: TaskInput) => ipcRenderer.invoke('task:create', input),

// main
ipcMain.handle('task:create', (event, input) => { ... }),
```

## 12. Backup and Recovery

Before any destructive database operation (migration, model reset, bulk replace), create a snapshot. The original database files are never overwritten in place.

**Pattern:**
```typescript
// taskStore.ts — snapshot before destructive operations
private snapshotDatabase(): string | null {
  const suffix = `.recovery-${Date.now()}`;
  copyFileSync(this.filePath, `${this.filePath}${suffix}`);
  return `${this.filePath}${suffix}`;
}
```

**Rule reference:** `RULES.md` §19 (Preserve trade-offs and reversibility) — a snapshot is cheap insurance against an unrecoverable mistake.
