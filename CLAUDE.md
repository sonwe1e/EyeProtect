# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EyeProtect — a local-first Windows eye-care and work-rhythm assistant. It runs in the system tray with a transparent, draggable pet, merges nearby eye/walk reminders, and provides a unified workbench for tasks, projects, daily planning, TimeBlocks, focus sessions, and review. Settings and task data stay local; releases include Windows x64 NSIS and portable executables.

**Stack:** Electron 43 + electron-vite 2.3 + React 18 + Vite 5, strict TypeScript and ESM application code. Sandboxed preload bundles are emitted as CommonJS `.cjs` files for Electron compatibility.

## Default Engineering Rules

All coding work must follow the engineering craft rules in `RULES.md`. Those 20 rules are the default coding standard — covering understanding before changing, choosing the simplest good solution, preserving scope, evidence before architecture, explicitness over cleverness, and verification. This file (CLAUDE.md) provides project-specific architecture and conventions; `RULES.md` provides the universal engineering philosophy. When they conflict, `RULES.md` wins.

## Documentation Map

When starting any task, use this table to find the relevant docs and source files quickly:

| Work Area | Primary Docs | Key Source Files | Tests |
| --- | --- | --- | --- |
| Architecture & process split | [CLAUDE.md](CLAUDE.md) §Architecture, [docs/architecture.md](docs/architecture.md) | `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx` | — |
| Engineering craft rules | [RULES.md](RULES.md) | — | — |
| Task/Project/Plan/Focus data model | [CLAUDE.md](CLAUDE.md) §Architecture | `src/shared/types.ts` | `tests/task-store.test.ts`, `tests/schema-v4.test.ts` |
| IPC capability extension | [CLAUDE.md](CLAUDE.md) §IPC convention, [docs/ipc-guide.md](docs/ipc-guide.md) | `src/shared/types.ts`, `src/preload/index.ts`, `src/main/index.ts` | `tests/ipc-task-input.test.ts`, `tests/ipc-project-input.test.ts` |
| Reminder scheduling & rest rhythm | [CLAUDE.md](CLAUDE.md) §Architecture | `src/main/reminders.ts`, `src/main/scheduling/kernel.ts` | `tests/reminders.test.ts`, `tests/scheduler-kernel.test.ts` |
| Settings & sanitization | [CLAUDE.md](CLAUDE.md) §Default settings | `src/shared/types.ts`, `src/main/settings.ts` | `tests/settings-write.test.ts` |
| Renderer command layer | [CLAUDE.md](CLAUDE.md) §Command Layer, [docs/coding-guide.md](docs/coding-guide.md) | `src/renderer/src/lib/commands.ts`, `src/renderer/src/hooks/useCommand.ts` | `tests/command-layer.test.ts` |
| Window management & surfaces | [CLAUDE.md](CLAUDE.md) §Architecture | `src/main/windows.ts`, `src/main/reminderSurface.ts` | `tests/reminder-surface.test.ts` |
| Color system & design tokens | [docs/color-system.md](docs/color-system.md) | `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/theme.css` | `tests/design-system-contract.test.ts`, `tests/theme-authority.test.ts` |
| Security hardening | [docs/hardening-notes.md](docs/hardening-notes.md) | `src/main/security.ts`, `src/main/scheduling/emergencyTemplate.ts` | `tests/security.test.ts` |
| Release & acceptance | [docs/release-checklist.md](docs/release-checklist.md) | `package.json`, `.github/workflows/windows.yml` | — |
| Backup & recovery | [CLAUDE.md](CLAUDE.md) §Architecture | `src/main/backup.ts`, `src/main/taskStore.ts` | `tests/backup.test.ts` |
| Characters & collection | [CLAUDE.md](CLAUDE.md) §Generated / runtime directories | `src/shared/characters.ts`, `src/main/characterService.ts` | `tests/characters.test.ts`, `tests/character-service.test.ts` |
| Today view & planning | [CLAUDE.md](CLAUDE.md) §Architecture | `src/renderer/src/features/tasks/todaySections.ts`, `src/renderer/src/features/tasks/todayViewModel.ts` | `tests/today-sections.test.ts`, `tests/today-view-model.test.ts` |
| Project lifecycle | [CLAUDE.md](CLAUDE.md) §Architecture | `src/shared/projectPolicy.ts`, `src/renderer/src/features/tasks/ProjectWorkspace.tsx` | `tests/project-policy.test.ts` |
| Coding patterns & practical guide | [docs/coding-guide.md](docs/coding-guide.md) | — | — |

## Commands

```bash
npm install        # install from package-lock.json
npm run dev        # electron-vite dev server with hot reload
npm run typecheck  # tsc --noEmit (primary quality gate — there is no linter/formatter)
npm test           # tsx --test tests/*.test.ts  — Node built-in test runner
npm run verify:ui-contract # semantic colors, CSS ownership, accessibility and contrast
npm run build      # electron-vite build → out/
npm run start      # electron-vite preview (runs the built app)
npm run package    # build + NSIS and portable Windows x64 packages → release/
```

Before shipping, run `npm run typecheck` and `npm test`. Changes to reminder scheduling must also update `tests/reminders.test.ts`.

## Architecture

Classic Electron 3-process split, each in its own electron-vite build target:

- **`src/main/`** — Main process. Entry in `index.ts` owns the single-instance lock, dynamic tray, sender-validated IPC, power lifecycle, and startup wiring. `ReminderScheduler` uses one-shot deadline timers, frozen pause/resume semantics, action locks, and persisted `runtime-state.json`; `SettingsStore` uses domain-scoped events and atomic `settings.json` writes; all timed events (breaks, task reminders, standalone reminders, pause expiry) share one `SchedulerKernel` deadline queue with a single timer + watchdog; `AppWindows` keeps only the pet resident while creating/destroying Alert, Bubble, Workbench, and dim-overlay windows on demand (there is no separate Panel/Settings window — Settings is a Workbench section).
- **`src/preload/`** — `contextBridge` exposing `window.eyeProtect: EyeProtectApi`. The renderer must never touch Node or Electron APIs directly.
- **`src/renderer/`** — `App.tsx` is a small hash router that dynamically imports Pet, Alert, Bubble, and Workbench views; `#settings` is a compatibility route into Workbench (the old `#panel` route was removed with its window). Window-level UI lives in `views/`, reusable domain UI in `features/`, IPC-backed state hooks in `hooks/`, and common controls in `components/`. `styles/tokens.css` owns non-color foundations, `styles/theme.css` owns semantic colors, and the remaining files have explicit surface/feature ownership. `styles.css` is the legacy window stylesheet: pet/reminder/bubble surfaces plus the Workbench-embedded Settings and standalone-reminders pages (the old panel/alarm/todo CSS was removed — it belonged to deleted windows).
- **`src/shared/types.ts`** — The **cross-process contract**. Types (`ReminderKind`, `Settings`, `ActiveReminder`, `ReminderStatus`, `RuntimeInfo`, `EyeProtectApi`) plus `DEFAULT_SETTINGS` and `SETTINGS_LIMITS`. If you add data that crosses the process boundary, define it here — do not duplicate across main/preload/renderer.

**IPC convention:** request and push channels are scoped by domain, including settings, runtime, reminder, task, project, planning, focus, alarm, character, backup, and window capabilities. To add a capability: extend `EyeProtectApi` in `src/shared/types.ts`, wire it in `src/preload/index.ts`, and register the same channel in `src/main/index.ts`. All invoke handlers must keep the renderer URL trust check. Task/project payload sanitizers live in `src/main/ipcTaskInput.ts` / `src/main/ipcProjectInput.ts` — every new field (including the `baseRevision` stale-write guard) must be whitelisted there.

**Default settings:** eye interval 20 min, walk interval 60 min, snooze 5 min, natural-break threshold 5 min, guided reminders, 30-second pre-alert, system theme, comfortable density, and pet scale 1. Limits remain centralized in `SETTINGS_LIMITS`; do not duplicate them in UI code or documentation.

## Coding conventions

- Strict TypeScript. 2-space indent, single quotes, semicolons, `camelCase` vars/functions, `PascalCase` types and React components.
- Renderer must not access Node/Electron directly — only `window.eyeProtect`.
- Cross-process data lives in `src/shared/types.ts`, not triplicated.
- Window transparency/drag relies on `-webkit-app-region`; interactive elements must stay `no-drag` (`styles.css`).
- Do not add a catch-all renderer state hook: Pet, Alert, Bubble, and Workbench have intentionally separate IPC subscriptions so hidden or lightweight windows avoid unrelated data and updates. The always-resident pet window subscribes only to lightweight channels (pending-task count, care status, reminder status, character collection) — never the full task list.

## Generated / runtime directories — do not edit or commit

`data/` (created at runtime, holds `settings.json`, `runtime-state.json`, `reminder-history.json`, `eyeprotect.db`, and the rolling `reminder-trace.log`), `out/`, `release/`, `node_modules/`.

## Notes

- Windows CI runs secret scanning, typecheck, all Node tests, UI contract verification, both package targets, packaged smoke tests (running/experience/emergency/pet-failure/workbench-interactions/plan-interactions), deterministic UI captures, and scale-factor captures. Do not commit runtime data or secrets.
- The tray icon has an inline base64 PNG fallback baked into `src/main/index.ts`. `public/assets/` ships only `tray-icon.png` and `app-icon.ico`; the 965 KB `app-icon.png` source lives under `scripts/assets/` (regenerate the `.ico` with `npm run build:icon`) so it is never packaged.
- Mascots and reminder choreography are rendered as deterministic inline SVG from `src/shared/characters.ts`; only the tray icon remains a required bitmap asset.
- A more detailed Chinese-language guide exists in `AGENTS.md` — it aligns with this file.
