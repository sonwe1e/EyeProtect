# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EyeProtect — a Windows desktop eye-care reminder ("护眼桌宠提醒工具"). Runs in the system tray with a transparent, draggable pet window. On a schedule it scales up, pins on top, and plays animations to remind the user to rest their eyes or get up and walk; eye + walk reminders close in time are merged into one. Settings are persisted locally; ships as a Windows x64 portable `.exe`.

**Stack:** Electron 33 + electron-vite 2.3 + React 18 + Vite 5, TypeScript (strict), ESM throughout.

## Commands

```bash
npm install        # install from package-lock.json
npm run dev        # electron-vite dev server with hot reload
npm run typecheck  # tsc --noEmit (primary quality gate — there is no linter/formatter)
npm test           # tsx --test tests/*.test.ts  — Node built-in test runner
npm run build      # electron-vite build → out/
npm run start      # electron-vite preview (runs the built app)
npm run package    # build + electron-builder --win portable --x64 → release/
```

Before shipping, run `npm run typecheck` and `npm test`. Changes to reminder scheduling must also update `tests/reminders.test.ts`.

## Architecture

Classic Electron 3-process split, each in its own electron-vite build target:

- **`src/main/`** — Main process. Entry in `index.ts` owns the single-instance lock, dynamic tray, sender-validated IPC, power lifecycle, and startup wiring. `ReminderScheduler` uses one-shot deadline timers, frozen pause/resume semantics, action locks, and persisted `runtime-state.json`; `SettingsStore` uses domain-scoped events and atomic `settings.json` writes; `AlarmClock` removes fired one-shot alarms; `AppWindows` keeps only the pet resident while creating/destroying Alert, Bubble, Panel, Settings, and overlay windows on demand.
- **`src/preload/`** — `contextBridge` exposing `window.eyeProtect: EyeProtectApi`. The renderer must never touch Node or Electron APIs directly.
- **`src/renderer/`** — `App.tsx` is a small hash router that dynamically imports `#pet`, `#alert`, `#bubble`, `#panel`, and `#settings` views. Window-level UI lives in `views/`, reusable domain UI in `features/`, IPC-backed state hooks in `hooks/`, and common controls in `components/`. Each view subscribes only to the data it consumes. `styles/tokens.css` and `styles/base.css` hold shared foundations; `styles.css` holds the current view rules.
- **`src/shared/types.ts`** — The **cross-process contract**. Types (`ReminderKind`, `Settings`, `ActiveReminder`, `ReminderStatus`, `RuntimeInfo`, `EyeProtectApi`) plus `DEFAULT_SETTINGS` and `SETTINGS_LIMITS`. If you add data that crosses the process boundary, define it here — do not duplicate across main/preload/renderer.

**IPC convention:** request channels include `settings:*`, `runtime:get`, `reminder:*`, `alarm:*`, `todo:*`, and `window:*`; push channels are scoped to their consumer domain (`settings:changed`, `reminder:changed`, `alarm:*`, `todo:changed`, `panel:*`). To add a capability: extend `EyeProtectApi` in `src/shared/types.ts`, wire it in `src/preload/index.ts`, and register the same channel in `src/main/index.ts`. All invoke handlers must keep the renderer URL trust check.

**Default settings:** eye interval 20 min, walk interval 60 min, snooze 5 min, pet scale 1, skin `stable`. Limits: intervals 1–240 min, snooze 1–60 min, pet scale 0.7–1.8. Skins: `stable` | `eye` | `fu` | `sleep`.

## Coding conventions

- Strict TypeScript. 2-space indent, single quotes, semicolons, `camelCase` vars/functions, `PascalCase` types and React components.
- Renderer must not access Node/Electron directly — only `window.eyeProtect`.
- Cross-process data lives in `src/shared/types.ts`, not triplicated.
- Window transparency/drag relies on `-webkit-app-region`; interactive elements must stay `no-drag` (`styles.css`).
- Do not add a catch-all renderer state hook: Pet, Alert, Bubble, Panel, and Settings have intentionally separate IPC subscriptions so hidden or lightweight windows avoid unrelated data and updates.

## Generated / runtime directories — do not edit or commit

`data/` (created at runtime, holds `settings.json` and `runtime-state.json`), `out/`, `release/`, `node_modules/`.

## Notes

- The repository has Git history but no CI workflow. Do not commit runtime data or secrets.
- The tray icon has an inline base64 PNG fallback baked into `src/main/index.ts`.
- Mascots and reminder choreography are rendered as deterministic inline SVG from `src/shared/characters.ts`; only the tray icon remains a required bitmap asset.
- A more detailed Chinese-language guide exists in `AGENTS.md` — it aligns with this file.
