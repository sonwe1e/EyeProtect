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

- **`src/main/`** — Main process. Entry in `index.ts` (single-instance lock, tray, IPC registration, scheduler start). Core classes: `ReminderScheduler` (`reminders.ts`, 1s tick, tracks `nextEyeAt`/`nextWalkAt`, eye+walk merged within `COMBINE_WINDOW_MS`; test reminders do **not** reset real schedules), `SettingsStore` (`settings.ts`, atomic write-then-rename persistence, `sanitizeSettings()`, runtime `data/` dir, Startup-folder autostart), `AppWindows` (`windows.ts`, pet + settings BrowserWindows, debounced position persistence), `getAlertBounds` (`windowBounds.ts`, centers reminder artwork at aspect 1448/1086 inside min(workarea)).
- **`src/preload/`** — `contextBridge` exposing `window.eyeProtect: EyeProtectApi`. The renderer must never touch Node or Electron APIs directly.
- **`src/renderer/`** — Single `App.tsx` routed by URL hash (`#pet` / `#settings`): `PetView` (pet + reminder alert card), `SettingsView` (interval/skin/autostart controls + manual test buttons), `NumberField`. `styles.css` holds all UI. CSS pet is the default; optional `character.riv` Rive integration (`@rive-app/react-canvas`) falls back gracefully.
- **`src/shared/types.ts`** — The **cross-process contract**. Types (`ReminderKind`, `Settings`, `ActiveReminder`, `ReminderStatus`, `RuntimeInfo`, `EyeProtectApi`) plus `DEFAULT_SETTINGS` and `SETTINGS_LIMITS`. If you add data that crosses the process boundary, define it here — do not duplicate across main/preload/renderer.

**IPC convention:** request channels `settings:get`/`settings:save`, `runtime:get`; push channels `settings:changed`, `reminder:changed`; action channels `reminder:status`, `reminder:action`, `reminder:test`, `reminder:pause`; window `window:settings:open`/`window:settings:change`. To add a new capability: extend `EyeProtectApi` in `src/shared/types.ts`, wire the IPC call in `src/preload/index.ts`, register the handler in `src/main/index.ts` — keep the channel name identical across all three.

**Default settings:** eye interval 20 min, walk interval 60 min, snooze 5 min, pet scale 1, skin `stable`. Limits: intervals 1–240 min, snooze 1–60 min, pet scale 0.7–1.8. Skins: `stable` | `eye` | `fu` | `sleep`.

## Coding conventions

- Strict TypeScript. 2-space indent, single quotes, semicolons, `camelCase` vars/functions, `PascalCase` types and React components.
- Renderer must not access Node/Electron directly — only `window.eyeProtect`.
- Cross-process data lives in `src/shared/types.ts`, not triplicated.
- Window transparency/drag relies on `-webkit-app-region`; interactive elements must stay `no-drag` (`styles.css`).

## Generated / runtime directories — do not edit or commit

`data/` (created at runtime, holds `settings.json`), `out/`, `release/`, `node_modules/`.

## Notes

- Not a git repository; no CI. No `.env`.
- The tray icon has an inline base64 PNG fallback baked into `src/main/index.ts`.
- `scripts/strip_pet_bg.py` (numpy + PIL, ROOT hardcoded to this project dir) converts `Pics/statu_*.png` → RGBA `public/assets/pet/pet-*.png`; run only when source artwork changes.
- A more detailed Chinese-language guide exists in `AGENTS.md` — it aligns with this file.
