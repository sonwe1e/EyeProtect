# Alarm & Todo UI Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken alarm-clock and todo UI — panels that clip/overflow so controls can't be reached, todo list not updating live, and alarms lost on restart.

**Architecture:** Pure CSS layout fix (flex column + constrained grid rows so the panel bodies actually scroll) on the renderer side, plus two main-process data-flow fixes that mirror the existing `alarm:changed` pattern: a dedicated `todos-changed` event emitted by `SettingsStore` → `windows.broadcastTodos` → `sendAll('todo:changed')`, and a new persistent `Settings.alarms` field written via `SettingsStore.persistAlarms` and restored at startup via `AlarmClock.hydrate`. No renderer/preload changes — all data flow is already wired, the stops are on the emit + persistence side.

**Tech Stack:** Electron 33, React 18, TypeScript (strict, ESM), Vite 5. Tests run via `tsx --test` (Node built-in runner). NOTE: under `tsx --test`, `electron.app` / `electron.BrowserWindow` are `undefined` — electron-backed classes (`SettingsStore`, `AppWindows`) cannot be constructed directly in tests unless `EYEPROTECT_DATA_DIR` is set (which short-circuits the `app.isPackaged` access in `getDataDir`). Any test touching `SettingsStore` MUST set that env var. The `broadcastTodos`→`sendAll` dispatch cannot be unit-tested in-Node (needs `BrowserWindow.getAllWindows()`); it is verified at the `.exe` level instead.

## Global Constraints

- TypeScript **strict**; 2-space indent; single quotes; semicolons; camelCase; PascalCase types/components.
- Renderer must not touch Node/Electron — only `window.eyeProtect`. (This plan changes nothing in the renderer except CSS, so the constraint is preserved automatically.)
- Cross-process data lives ONLY in `src/shared/types.ts` — the new `Settings.alarms` field and `sanitizeAlarm`/`sanitizeAlarms` go there, not triplicated.
- `AlarmClock` constructor signature MUST stay `constructor(now: () => number = Date.now)` — existing `tests/alarms.test.ts` instantiates `new AlarmClock(() => BASE_TS)` with the factory as the first positional arg. Add a separate `hydrate` method instead of a constructor change.
- Tests: `npm test` = `tsx --test tests/*.test.ts`. typecheck: `npm run typecheck` = `tsc --noEmit`.
- A test touching `SettingsStore` sets `process.env.EYEPROTECT_DATA_DIR` to a fresh temp dir and restores it in a `finally` block.
- Verification is by BUILDING the release `.exe` (`npm run package`) and running it — browser mockups are not representative of the Electron window. Build once after all code changes, not per task.

---

## Task 1: Add `sanitizeAlarm` / `sanitizeAlarms` to the shared types

**Files:**
- Create: none
- Modify: `src/shared/types.ts` (after `sanitizeTodos`, line 128)
- Test: `tests/alarms.test.ts` (add cases at end)

**Interfaces:**
- Consumes: existing `Alarm` type (types.ts:10-18), plus `sanitizeTodo`/`sanitizeTodos` as the pattern (types.ts:108-128).
- Produces: `sanitizeAlarm(value: unknown): Alarm | null` and `sanitizeAlarms(value: unknown): Alarm[]` — imported later by `settings.ts`, tested directly here.

- [ ] **Step 1: Write the failing tests**

Add to end of `tests/alarms.test.ts`. First add a NEW import line for the sanitizers — the file currently imports nothing from `../shared/types`:

```ts
import { Alarm, sanitizeAlarm, sanitizeAlarms } from '../src/shared/types';
```

(The existing `import { AlarmClock, nextFireAt } from '../src/main/alarms';` stays.)

Then add the tests:

```ts
test('sanitizeAlarm keeps a fully-populated valid alarm', () => {
  const alarm = sanitizeAlarm({
    id: 'a1',
    hour: 7,
    minute: 30,
    label: 'wake',
    repeat: 'once',
    enabled: true,
    createdAt: 1000
  });
  assert.deepEqual(alarm, {
    id: 'a1',
    hour: 7,
    minute: 30,
    label: 'wake',
    repeat: 'once',
    enabled: true,
    createdAt: 1000
  });
});

test('sanitizeAlarm drops an alarm with an out-of-range hour or minute', () => {
  assert.equal(sanitizeAlarm({ id: 'a1', hour: 25, minute: 0, repeat: 'once', enabled: true, createdAt: 1 }), null);
  assert.equal(sanitizeAlarm({ id: 'a1', hour: 7, minute: 60, repeat: 'once', enabled: true, createdAt: 1 }), null);
  assert.equal(sanitizeAlarm({ id: 'a1', hour: 7, minute: 30, repeat: 'yearly', enabled: true, createdAt: 1 }), null);
});

test('sanitizeAlarms keeps valid entries in order and drops malformed ones', () => {
  const result = sanitizeAlarms([
    { id: 'a1', hour: 7, minute: 0, repeat: 'daily', enabled: true, createdAt: 1 },
    { id: 'a2', hour: -1, minute: 0, repeat: 'once', enabled: true, createdAt: 2 },
    'nonsense',
    { id: 'a3', hour: 23, minute: 59, repeat: 'once', enabled: false, createdAt: 3 }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'a1');
  assert.equal(result[1].id, 'a3');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/alarms.test.ts 2>&1 | tail -8`
Expected: FAIL — `sanitizeAlarm`/`sanitizeAlarms` are not exported yet (import error or "not a function").

- [ ] **Step 3: Implement the sanitizers**

Append to `src/shared/types.ts` after `sanitizeTodos` (after line 128):

```ts
export const sanitizeAlarm = (value: unknown): Alarm | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<Alarm>;
  if (typeof candidate.id !== 'string' || !candidate.id) {
    return null;
  }
  if (typeof candidate.hour !== 'number' || candidate.hour < 0 || candidate.hour > 23 || !Number.isInteger(candidate.hour)) {
    return null;
  }
  if (typeof candidate.minute !== 'number' || candidate.minute < 0 || candidate.minute > 59 || !Number.isInteger(candidate.minute)) {
    return null;
  }
  if (candidate.label !== undefined && typeof candidate.label !== 'string') {
    return null;
  }
  if (candidate.repeat !== 'once' && candidate.repeat !== 'daily') {
    return null;
  }
  if (typeof candidate.enabled !== 'boolean') {
    return null;
  }
  const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now();
  return {
    id: candidate.id,
    hour: candidate.hour,
    minute: candidate.minute,
    label: candidate.label,
    repeat: candidate.repeat,
    enabled: candidate.enabled,
    createdAt
  };
};

export const sanitizeAlarms = (value: unknown): Alarm[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => sanitizeAlarm(entry)).filter((entry): entry is Alarm => Boolean(entry));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/alarms.test.ts 2>&1 | tail -6`
Expected: all tests on this file PASS (the 7 pre-existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/alarms.test.ts
git commit -m "feat(types): add sanitizeAlarm/sanitizeAlarms for alarm persistence validation"
```

---

## Task 2: Add persistent `Settings.alarms` field and `SettingsStore.persistAlarms`

**Files:**
- Modify: `src/shared/types.ts` (`Settings` interface, `DEFAULT_SETTINGS`)
- Modify: `src/main/settings.ts` (import, `sanitizeSettings`, new method)
- Test: `tests/alarms.test.ts` (add round-trip test)

**Interfaces:**
- Consumes: `sanitizeAlarms` (types.ts, Task 1), `SettingsChangedPayload` (settings.ts:25), the existing `save()` write+emit pattern (settings.ts:140-147).
- Produces: `Settings.alarms: Alarm[]` field; `SettingsStore.persistAlarms(alarms: Alarm[]): void` — writes the alarms and emits `changed`. Later imported/wired by `index.ts` (Task 3) and the index wiring (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `tests/alarms.test.ts`. This test constructs a real `SettingsStore`, so it MUST set `EYEPROTECT_DATA_DIR` and restore it. Add the needed imports at top of file:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

(`SettingsStore` is imported at top of the file already.)

Add the test:

```ts
test('persistAlarms writes alarms and a second SettingsStore instance reads them back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-a-'));
  const original = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = dir;
  try {
    const store = new SettingsStore();
    store.persistAlarms([
      { id: 'a1', hour: 7, minute: 30, label: 'wake', repeat: 'once', enabled: true, createdAt: 1000 },
      { id: 'a2', hour: 12, minute: 0, repeat: 'daily', enabled: false, createdAt: 1001 }
    ]);

    const readback = new SettingsStore().get().alarms;
    assert.equal(readback.length, 2);
    assert.deepEqual(readback[0], {
      id: 'a1',
      hour: 7,
      minute: 30,
      label: 'wake',
      repeat: 'once',
      enabled: true,
      createdAt: 1000
    });
    assert.equal(readback[1].repeat, 'daily');
    assert.equal(readback[1].enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) {
      delete process.env.EYEPROTECT_DATA_DIR;
    } else {
      process.env.EYEPROTECT_DATA_DIR = original;
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/alarms.test.ts 2>&1 | tail -8`
Expected: FAIL — `persistAlarms` is not a function (doesn't exist yet).

- [ ] **Step 3: Add `alarms` to Settings + DEFAULT_SETTINGS**

In `src/shared/types.ts`, `Settings` interface (after line 40 `todos`), add:

```ts
  alarms: Alarm[];
```

In `DEFAULT_SETTINGS` (after line 96 `todos: []`), add:

```ts
  alarms: [],
```

- [ ] **Step 4: Implement the sanitizer + persistAlarms in settings.ts**

Extend the existing import from `'../shared/types'` in `src/main/settings.ts` (line 14-23) to add `Alarm` and `sanitizeAlarms`:

```ts
import {
  DEFAULT_SETTINGS,
  PET_SKINS,
  SETTINGS_LIMITS,
  sanitizeAlarms,
  sanitizeTodos,
  type Alarm,
  type PetPosition,
  type PetSkin,
  type Settings,
  type TodoItem
} from '../shared/types';
```

In `sanitizeSettings` (line 101-104), add `alarms` before `todos`:

```ts
    dimDesktop:
      typeof input.dimDesktop === 'boolean' ? input.dimDesktop : DEFAULT_SETTINGS.dimDesktop,
    alarms: sanitizeAlarms(input.alarms),
    todos: sanitizeTodos(input.todos)
```

Add the new public method after `removeTodo` (after line 174), mirroring `save()`'s write+emit pattern:

```ts
  persistAlarms(alarms: Alarm[]): void {
    const previous = this.get();
    const next = sanitizeSettings({ ...previous, alarms });
    this.settings = next;
    this.write(next);
    this.emit('changed', { settings: this.get(), previous } satisfies SettingsChangedPayload);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test tests/alarms.test.ts 2>&1 | tail -6`
Expected: ALL tests on this file PASS (pre-existing 7 + Task 1's 3 + this round-trip).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/settings.ts tests/alarms.test.ts
git commit -m "feat(settings): persist alarms via Settings.alarms + persistAlarms"
```

---

## Task 3: Add `AlarmClock.hydrate` to restore alarms at startup

**Files:**
- Modify: `src/main/alarms.ts` (add `hydrate` method)
- Test: `tests/alarms.test.ts` (add hydrate + restart test)

**Interfaces:**
- Consumes: `nextFireAt` (alarms.ts:14), `arm` (alarms.ts:68), `this.now` factory.
- Produces: `AlarmClock.hydrate(alarms: Alarm[]): void` — restored enabled alarms are armed and will fire. Later called by `index.ts` (Task 5) with `settingsStore.get().alarms`.

- [ ] **Step 1: Write the failing test**

Add to `tests/alarms.test.ts`:

```ts
test('hydrate re-arms enabled alarms; restarting from the persisted list fires again', async () => {
  // Fixed clock 120ms before a 10:31 trigger so the real setTimeout elapses quickly.
  const now = () => new Date(2026, 6, 8, 10, 30, 59, 880).getTime();
  const alarms: Alarm[] = [
    { id: 'once-1', hour: 10, minute: 31, repeat: 'once', enabled: true, createdAt: 100 },
    { id: 'disabled-1', hour: 10, minute: 31, repeat: 'daily', enabled: false, createdAt: 101 }
  ];

  const clock = new AlarmClock(now);
  clock.hydrate(alarms);
  const fired: string[] = [];
  clock.on('fired', (entry) => fired.push(entry.id));

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(fired, ['once-1'], 'only the enabled alarm should fire after hydrate');
  clock.cancelAlarm('once-1');

  // Simulate a restart: rebuild the clock from the SAME persisted alarm list.
  const restarted = new AlarmClock(now);
  restarted.hydrate(alarms);
  const firedAfterRestart: string[] = [];
  restarted.on('fired', (entry) => firedAfterRestart.push(entry.id));

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(firedAfterRestart, ['once-1'], 'rehydrated alarm fires again after restart');
  restarted.cancelAlarm('once-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/alarms.test.ts 2>&1 | tail -8`
Expected: FAIL — `hydrate` is not a function.

- [ ] **Step 3: Implement hydrate**

Add after `getAlarms` (after line 38) in `src/main/alarms.ts`:

```ts
  hydrate(alarms: Alarm[]): void {
    const restored = alarms.map((alarm) => ({ ...alarm }));
    for (const alarm of restored) {
      if (alarm.enabled) {
        const delay = nextFireAt(alarm.hour, alarm.minute, this.now()) - this.now();
        this.arm(alarm, delay);
      }
    }
    this.alarms = restored;
  }
```

NOTE: the constructor signature is deliberately NOT changed (stays `(now?)`) — `hydrate` is the persistence entry point, keeping the timer engine decoupled from storage and keeping the existing tests valid.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/alarms.test.ts 2>&1 | tail -6`
Expected: ALL tests on this file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/alarms.ts tests/alarms.test.ts
git commit -m "feat(alarms): add AlarmClock.hydrate to restore persisted alarms at startup"
```

---

## Task 4: Emit `todos-changed` from SettingsStore and wire `broadcastTodos`

**Files:**
- Modify: `src/main/settings.ts` (`addTodo`, `removeTodo`)
- Modify: `src/main/windows.ts` (`broadcastTodos`, import)
- Test: `tests/todos.test.ts` (add emit test)

**Interfaces:**
- Consumes: existing `addTodo`/`removeTodo` emit of `changed`.
- Produces: `addTodo`/`removeTodo` additionally emit `todos-changed` carrying `TodoItem[]`; `AppWindows.broadcastTodos(todos: TodoItem[]): void` sends `todo:changed` to all windows. The index wiring (Task 5) connects these; renderer's `onTodosChanged` already subscribes to `todo:changed` and needs NO change.

- [ ] **Step 1: Write the failing test**

Add to `tests/todos.test.ts`. The file currently imports only `sanitizeTodos` from `../shared/types` and nothing from settings. Add two import lines (node:fs/os/path needed for the temp-dir fixture):

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../src/main/settings';
import { sanitizeTodos, type TodoItem } from '../src/shared/types';
```

(The existing `import { sanitizeTodos } from '../src/shared/types';` line is replaced by the last line above — merge so there's only one import from `../src/shared/types`.)

Add the test:

```ts
test('addTodo and removeTodo emit todos-changed carrying the current list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyeprotect-t-'));
  const original = process.env.EYEPROTECT_DATA_DIR;
  process.env.EYEPROTECT_DATA_DIR = dir;
  try {
    const store = new SettingsStore();
    const events: TodoItem[][] = [];
    store.on('todos-changed', (todos) => events.push(todos));

    const created = store.addTodo('first');
    assert.equal(events.length, 1, 'addTodo emits todos-changed once');
    assert.deepEqual(events[0], created, 'payload matches the list returned by addTodo');
    assert.equal(events[0].length, 1);
    assert.equal(events[0][0].text, 'first');

    store.removeTodo(created[0].id);
    assert.equal(events.length, 2, 'removeTodo emits todos-changed once more');
    assert.deepEqual(events[1], [], 'removing the last todo yields an empty list');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) {
      delete process.env.EYEPROTECT_DATA_DIR;
    } else {
      process.env.EYEPROTECT_DATA_DIR = original;
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/todos.test.ts 2>&1 | tail -8`
Expected: FAIL — `todos-changed` never fires (length stays 0).

- [ ] **Step 3: Emit `todos-changed` in addTodo / removeTodo**

In `src/main/settings.ts`, at the end of `addTodo` (after line 160 `this.emit('changed', …)`), add:

```ts
    this.emit('todos-changed', this.get().todos);
```

At the end of `removeTodo` (after line 172 `this.emit('changed', …)`), add:

```ts
    this.emit('todos-changed', this.get().todos);
```

(Hold a local reference if preferred, but `this.get().todos` is cheap and matches the existing style.)

- [ ] **Step 4: Add `broadcastTodos` to windows.ts**

In `src/main/windows.ts`, extend the import (line 5) to include `TodoItem`:

```ts
import type { Alarm, ReminderStatus, RuntimeInfo, Settings, TodoItem } from '../shared/types';
```

Add the method right after `broadcastAlarmFired` (after line 148):

```ts
  broadcastTodos(todos: TodoItem[]): void {
    this.sendAll('todo:changed', todos);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test tests/todos.test.ts 2>&1 | tail -6`
Expected: ALL tests on this file PASS (the pre-existing 3 + this new emit test). NOTE: `broadcastTodos` itself is NOT unit-tested here — it calls `sendAll` → `BrowserWindow.getAllWindows()`, which is `undefined` under `tsx --test`. Its behaviour is verified at the `.exe` level (the add→remove→live-update flow users actually see). That's the deliberate, documented gap from the "Global Constraints" note.

- [ ] **Step 6: Commit**

```bash
git add src/main/settings.ts src/main/windows.ts tests/todos.test.ts
git commit -m "feat(ipc): emit todos-changed and broadcast it to all windows"
```

---

## Task 5: Wire persistence + hydration + broadcast at app startup

**Files:**
- Modify: `src/main/index.ts` (startup wiring)

**Interfaces:**
- Consumes: `settingsStore.persistAlarms` (Task 2), `alarmClock.hydrate` (Task 3), `windows.broadcastTodos` (Task 4), `settingsStore.on('todos-changed', …)` (Task 4).
- Produces: running app that (a) restores persisted alarms on launch, (b) re-persists on every set/cancel, (c) relays every todo add/remove to all renderers. Verified ONLY by building and running the `.exe` — these are startup-time wirings inside `app.whenReady`, which cannot run under `tsx --test`.

- [ ] **Step 1: Replace the alarmClock construction with construction + hydration**

In `src/main/index.ts` line 96, change:

```ts
  const alarmClock = new AlarmClock();
```

to:

```ts
  const alarmClock = new AlarmClock();
  alarmClock.hydrate(settingsStore.get().alarms);
```

- [ ] **Step 2: Add the persistence + broadcast wiring**

Right after the two `alarmClock.on(…)` lines (after line 115), add three lines:

```ts
  alarmClock.on('changed', (alarms) => settingsStore.persistAlarms(alarms));
  settingsStore.on('todos-changed', (todos) => windows.broadcastTodos(todos));
```

The first line makes every set/cancel write through to `settings.json` (the in-memory `changed` still broadcasts to the renderer via the untouched line 114). The second relays todo changes to all windows.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (This wiring is the integration seam that the unit tests can't reach — typecheck is the gate here.)

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): hydrate persisted alarms and wire alarms/todos persistence+broadcast"
```

---

## Task 6: Fix the panel layout clipping (CSS only)

**Files:**
- Modify: `src/renderer/src/styles.css` (`.alarm-panel-card`, `.alarm-panel-body`, `.todo-bubble`, `.todo-list`)
- Test: none for layout (CSS is verified by the `.exe` run — see Task 7).

**Interfaces:**
- Consumes: `.alarm-panel-card` (styles.css:750), `.alarm-panel-body` (styles.css:793), `.todo-bubble` (styles.css:1020, the `.is-open` rule at 1033), `.todo-list` (styles.css:1052).
- Produces: alarm card with a truly-scrolling body; todo bubble with a fixed header/scrolling list/fixed compose row and a capped height. Renderer JSX and preload untouched.

- [ ] **Step 1: Make the alarm card body actually scroll**

In `.alarm-panel-card` (styles.css:750-762), change `display: grid` → flex column:

```css
.alarm-panel-card {
  z-index: 10;
  width: min(320px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #1f2a2e;
  background: rgb(255 255 255 / 98%);
  border: 1px solid rgb(31 42 46 / 14%);
  border-radius: 10px;
  box-shadow: 0 18px 48px rgb(0 0 0 / 32%);
  -webkit-app-region: no-drag;
}
```

In `.alarm-panel-body` (styles.css:793-796), add `flex` + `min-height`:

```css
.alarm-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 10px 12px;
  overflow-y: auto;
}
```

Why: a grid child's default `min-height: auto` prevents it from shrinking below its content, so `overflow-y: auto` never engages and the card's `overflow:hidden` just clips the time-input/label/action row. Flex + `min-height: 0` lets the body shrink and scroll.

- [ ] **Step 2: Cap the todo bubble and pin the compose row**

Replace `.todo-panel.is-open .todo-bubble` (styles.css:1033-1036) with a height-capped 3-row grid (header / list / compose):

```css
.todo-panel.is-open .todo-bubble {
  display: grid;
  gap: 6px;
  grid-template-rows: auto 1fr auto;
  max-height: min(60vh, 420px);
}
```

Change `.todo-list` (styles.css:1052-1060) so the LIST scrolls inside its grid row instead of being sized against the viewport:

```css
.todo-list {
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: none;
  min-height: 0;
  overflow-y: auto;
}
```

Why: before, the bubble had no max-height and all rows were `auto`, so adding items pushed the compose `<form>` below the viewport edge and it couldn't be clicked. Now the bubble is capped, the list row shrinks (`min-height: 0`) and scrolls, the compose row stays fixed at the bottom.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (CSS isn't type-checked, but the step guards against a JSX regression while context is fresh).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "fix(ui): alarm card + todo bubble scroll instead of clipping"
```

---

## Task 7: Build the release `.exe` and verify end-to-end

**Files:** none (verification only)

**Preconditions:** Tasks 1-6 committed; `npm run typecheck` and `npm test` both green.

- [ ] **Step 1: Final typecheck + unit tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all 16 pre-existing + 6 new tests PASS.

- [ ] **Step 2: Build the portable release**

Run: `npm run package`
Expected: electron-builder produces `release/EyeProtect-0.2.0-win-x64.exe` (portable, x64) with no build error. (This runs `npm run build` first, so it also gates the production bundle.)

- [ ] **Step 3: Install + launch + verify (USER does this, with the freshly built .exe)**

Run the `.exe` from `release/`, then check:

- **Alarm scrolling:** open the pet window (hover reveals the clock icon at top-right → click it). Click "新建闹钟" 4-5 times. The alarm list + editor must scroll (not clip) so the 确定/取消 buttons stay reachable. → verifies Task 6 (alarm card body).
- **Alarm persistence:** add 2 alarms, close the `.exe`, relaunch it, reopen the闹钟 panel. Both alarms must still be there. → verifies Task 2 (persistAlarms) + Task 3 (hydrate) + Task 5 (wiring).
- **Todo scrolling + pinned compose:** open the todo panel (top-right "待办" tab). Add 6-7 todos. The list must scroll while the bottom "添加待办..." input stays fixed and clickable. → verifies Task 6 (todo bubble).
- **Todo live update:** add a todo → it appears immediately without reopening the panel. Remove one → it disappears immediately. → verifies Task 4 (emit + broadcastTodos) + Task 5 (todos-changed wiring). This is the in-Node-untestable `sendAll` path, verified here at the `.exe` level.
- **Regression:** trigger a manual eye/walk reminder (Settings → 手动测试) → the reminder overlay still appears and dismisses normally; the top-right controls still hover-reveal. → existing flow intact.

- [ ] **Step 4: Commit any final fixups**

If the `.exe` run surfaced a regression, fix it and commit. If all green, no further commit needed.

---

## Self-Review Notes (already applied during writing)

- **Spec coverage:** layout (Task 6), dead `todo:changed` (Tasks 4+5), alarm persistence (Tasks 2+3+5), tests (a) (Tasks 2,3) + (b) (Task 4). All spec requirements mapped to at least one task.
- **Placeholder scan:** no TBD/TODO/"implement later"/"similar to Task N" — every code step shows the actual code; every command shows expected output.
- **Type consistency:** `persistAlarms(alarms: Alarm[])`, `hydrate(alarms: Alarm[])`, `broadcastTodos(todos: TodoItem[])`, `sanitizeAlarm→Alarm|null`, `sanitizeAlarms→Alarm[]`, `Settings.alarms: Alarm[]` used identically across tasks. `alarmClock.hydrate(…)` / `settingsStore.persistAlarms(…)` / `windows.broadcastTodos(…)` match the names defined in their producer tasks.
- **One documented gap:** `broadcastTodos`→`sendAll` dispatch has no Node unit test (BrowserWindow undefined in-harness) — by design, verified at `.exe` level in Task 7.
