# EyeProtect Runtime and Portable Packaging Fix — Implementation Plan

> Historical archive: this completed 0.5.1 plan is retained as a decision record. Current packaging targets and validation steps live in `package.json` and `docs/release-checklist.md`.

**Goal:** Ship EyeProtect 0.5.1 with visible sandboxed renderer windows, portable-local data storage, and a valid startup shortcut target.

**Architecture:** Keep every renderer sandboxed, but compile the single preload entry as a CommonJS `.cjs` bundle that Electron can execute inside the sandbox. Resolve portable storage and launch paths through small pure helpers that prefer electron-builder's `PORTABLE_EXECUTABLE_DIR` and `PORTABLE_EXECUTABLE_FILE`, then feed those helpers into the existing settings store and startup shortcut code. Make the preload contract part of every build and perform a real portable EXE smoke test before completion.

**Tech stack:** Electron 33, electron-vite 2.3, React 18, strict TypeScript, Node test runner, electron-builder portable target.

---

## Task 1: Add failing portable-path tests

**Files:**

- Create: `tests/portable-paths.test.ts`
- Modify later: `src/main/settings.ts`

- [x] Test development, packaged fallback, valid portable paths, and rejection of empty/relative portable paths.
- [x] Run the focused test and confirm it fails because the pure path helpers do not exist.

## Task 2: Add the build contract

**Files:**

- Create: `scripts/verify-build-contract.mjs`
- Modify: `package.json`
- Modify later: `electron.vite.config.ts`, `src/main/windows.ts`

- [x] Make `npm run build` verify `out/preload/index.cjs`, CommonJS Electron loading, sandboxed windows, and the absence of `index.mjs` references in the compiled main bundle.
- [x] Run the build and confirm the contract fails against the current ESM preload output.

## Task 3: Implement sandbox-compatible preload output

**Files:**

- Modify: `electron.vite.config.ts`
- Modify: `src/main/windows.ts`

- [x] Configure preload Rollup output as CommonJS with `index.cjs`.
- [x] Compute the preload path once and reuse it for every IPC-enabled window.
- [x] Keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- [x] Run `npm run build` and confirm the build contract passes.

## Task 4: Implement portable path resolution

**Files:**

- Modify: `src/main/settings.ts`
- Test: `tests/portable-paths.test.ts`

- [x] Add pure helpers for the application base directory and launch executable.
- [x] Accept only non-empty absolute portable paths.
- [x] Prefer `PORTABLE_EXECUTABLE_DIR` for `data/`.
- [x] Prefer `PORTABLE_EXECUTABLE_FILE` for startup shortcut target and working directory.
- [x] Preserve `EYEPROTECT_DATA_DIR` as the explicit test/development override.
- [x] Run the focused tests and confirm they pass.

## Task 5: Version and full automated verification

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Set the release version to 0.5.1.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.

## Task 6: Package and smoke-test the real executable

- [x] Ensure no prior EyeProtect test process is running.
- [x] Run `npm run package`.
- [x] Confirm `release/EyeProtect-0.5.1-win-x64.exe` exists.
- [x] Launch a temporary copy of the portable EXE.
- [x] Confirm the pet renderer exposes `window.eyeProtect` and renders `.pet-shell`.
- [x] Trigger the second-instance path and confirm `.settings-shell` renders.
- [x] Save a harmless setting through the real preload bridge and confirm `data/settings.json` is created beside the temporary portable EXE.
- [x] Confirm the packaged `app.asar` contains `index.cjs`, CommonJS preload code, and sandboxed window configuration.
- [x] Stop only the test instance and remove temporary smoke-test artifacts.

## Task 7: Final review and commit

- [x] Review the complete diff for unrelated changes.
- [x] Re-run any focused check affected by final cleanup.
- [ ] Commit the implementation with an imperative message.
