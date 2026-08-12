# 闹钟 & 待办事项 UI 显示修正 设计说明书

> 历史归档：本文反映 2026-07-09 的实现基线，不再描述当前 Task Core 或 Workbench。

**日期**: 2026-07-09
**状态**: 已批准 — 实作前双方共识
**触发**: 使用者回报「闹钟和待办事项的 UI 显示很错误，需要修正」，点开闹钟面板 / 待办泡泡后内容紧紧压缩、被截掉、点不进去填写。

## Context（为何而改）

EyeProtect 有一套独立于护眼/走动提醒（`ReminderScheduler`）之外的「闹钟」（闹钟）与「待办事项」（待办）功能，全部 UI 写在单一 `src/renderer/src/App.tsx`（23KB），主程序端分别由 `src/main/alarms.ts`（`AlarmClock`）与 `src/main/settings.ts`（`SettingsStore`，待办栏位放在 `Settings.todos`）支撑。资料流走 `window.eyeProtect` IPC（preload → `src/preload/index.ts`）。

探索过程由三个平行 Explore agent 完整盘点现有 `Alarm`／`TodoItem` 型别、IPC channel、`windows.broadcast*` 方法、以及两个面板的 CSS（`src/renderer/src/styles.css` 723-1130），并找出两种不同类型的缺陷：

1. **排版缺陷（本需求主诉）**：闹钟卡与待办泡泡在展开后没有内容捲动机制 → 栏位被 `overflow:hidden` 切掉、被推出视窗、点不到也填不了。
2. **资料缺陷（连带会让「显示是错的」）**：
   - `todo:changed` IPC channel 是悬空接线 — renderer 有订阅，main process 从不 emit → 新增/删除待办后画面不会即时更新。
   - 闹钟没有持久化 — `AlarmClock` 只存在记忆体，关掉程式再开全部闹钟消失。

这两类全部纳入修正。

### 根因（已透过读码确认）

- **闹钟卡截断**：`.alarm-panel-card` 是 `display:grid; overflow:hidden`，子项 `.alarm-panel-body` 虽写 `overflow-y:auto`，但 grid 子项预设 `min-height:auto` 不会收缩 → 捲动永远不会发生 → 整段「时间输入／标签／确定取消」被截掉。
- **待办泡泡外推**：`.todo-bubble` 用 `display:grid`（open 时）但三个子项全是 `grid-auto-rows:auto`，**没有 `max-height`、没有 scroll**；待办一多泡泡往下长，底部新增 `<form>` 被推到视窗外 → 完全点不进去。

## 关键选择（使用者已拍板）

| 选项 | 决定 |
|---|---|
| 待办即时更新的资料流 | **新增独立的 `todo:changed` 频道**（仿照既有 `alarm:changed` 的 `AlarmClock`→`broadcastAlarms`→`sendAll` 结构） |
| 闹钟不持久化是否修 | **修**。闹钟资料夹纯属记忆体是公认的 bug，仿 `Settings.todos` 栏位加到 `Settings.alarms`、走同一组 read/sanitize/write。 |
| 排版/资料/测试范围 | **全部一次修**（排版 + 资料 bug + 补测 (a)+(b)）。 |
| 验证方式 | 一次改完后再跑 `npm run package` 产出 `release/*.exe`，由使用者实际启动验证（浏览器 mockup 对 Electron 视窗无效）。这正是回应使用者「要先产可执行档才看得到视觉效果」。 |

## 设计

### ①② 排版修正 — CSS 唯一标准解，无替代方案并列

CSS（`src/renderer/src/styles.css`）：

```css
/* 闹钟卡：由 grid 改 flex column，让 body 真正捲动 */
.alarm-panel-card {
  display: flex;          /* 原为 grid */
  flex-direction: column;
  /* width/min-height/max-height/overflow:hidden 原值保留 */
}
.alarm-panel-body {
  flex: 1 1 auto;
  min-height: 0;          /* 允许收缩到比内容小 → 触发 overflow 捲动 */
  overflow-y: auto;       /* 原本就有，此时才真的生效 */
}

/* 待办泡泡：限制高度，标题/列表(捲)/新增列(固定) 三层网格 */
.todo-panel.is-open .todo-bubble {
  display: grid;
  gap: 6px;
  grid-template-rows: auto 1fr auto;
  max-height: min(60vh, 420px);
}
.todo-list {
  max-height: none;       /* 移除旧的最大高度，改让 grid row 控制 */
  min-height: 0;          /* 允许收缩 → 列表自己捲，不再把 form 推出去 */
  overflow-y: auto;
}
```

无替代方案并列：这是业界对「flex/grid 子项溢位排版」的标准修法。

### ③ 待办独立 `todo:changed` 频道 — 仿 `alarm:changed`

让 `SettingsStore`（已 extends `EventEmitter`）多 emit 一个 todo 专属事件，其它完全不动。

**`src/main/settings.ts`**（addTodo / removeTodo）：
- 既有的 `emit('changed', { settings, previous })` 保留不动 — 它喂 `scheduler.updateSettings`／`syncStartupShortcut`／`applySettings`／`broadcastSettings`，是其它机制依赖的。
- **加入 `this.emit('todos-changed', this.get().todos);`**，专门接 renderer 的 `onTodosChanged`。

**`src/main/index.ts`**（加一行 wiring）：
```ts
settingsStore.on('todos-changed', (todos) => windows.broadcastTodos(todos));
```

**`src/main/windows.ts`**（加一个 broadcast，仿 `broadcastAlarms`，并把 `TodoItem` 加入 line 5 的 type import）：
```ts
broadcastTodos(todos: TodoItem[]): void {
  this.sendAll('todo:changed', todos);
}
```
`windows.ts` 的 line 5 目前 import `{ Alarm, ReminderStatus, RuntimeInfo, Settings }`，**尚未** import `TodoItem`，实作时需加上。

**renderer / preload 完全不动** — `useAppState` 既有 `onTodosChanged(setTodos)`、preload line 49 既有 `onTodosChanged: (cb) => on<TodoItem[]>('todo:changed', cb)`，只是以前没有东西喂它；现在有了。一次 add/remove 即同步更新。结构与 `alarmClock`→`broadcastAlarms`→`alarm:changed` 完全对称。

### ④ 闹钟持久化 — 仿 `Settings.todos` 栏位（同一组 read/sanitize/write）

TodoItem 能留存是因为放在 `Settings.todos`、跟著 `settings.json` 走原子写入与 sanitize；闹钟现在完全没栏位，所以仿同样模式在 `Settings` 加 `alarms` 栏位。

**`src/shared/types.ts`**：
- `Settings` interface 加一行 `alarms: Alarm[]`。
- `DEFAULT_SETTINGS` 加 `alarms: []`。
- 新增 `sanitizeAlarm(value: unknown): Alarm | null` 与 `sanitizeAlarms(value: unknown): Alarm[]`，仿 `sanitizeTodo`/`sanitizeTodos` — 逐栏校验 `id`/`hour`/`minute`/`label`/`repeat`/`enabled`/`createdAt`，型别不对就 drop、回传 null/过滤。

**`src/main/settings.ts`**：
- import `Alarm`＋`sanitizeAlarms`。
- `sanitizeSettings` 回传物件加 `alarms: sanitizeAlarms(input.alarms)`。
- 新增 `persistAlarms(alarms: Alarm[]): void`：把 alarms 写入 `this.settings.alarms`、走同样的 sanitize／`this.write`（原子 write-then-rename，line 193-198）、`emit('changed', { settings, previous })` 沿用 `save` 路径，让所有视窗的 `settings.alarms` 也同步更新（依赖 `addTodo`/`removeTodo` 的 `save` 路径示意，行为一致且 idempotent）。

**`src/main/alarms.ts`**：
- **constructor 签名不动**，保留 `constructor(now: () => number = Date.now)` — 这是因既有的 `tests/alarms.test.ts` 用 `new AlarmClock(() => BASE_TS)`（把 `now` factory 放在第一个位置参数），改它会破坏既有测试。
- 新增 `hydrate(alarms: Alarm[]): void`：还原清单，把 enabled 的重新 `arm`，用 `nextFireAt(hour, minute, now()) - now()` 算下次触发延迟（今天已过 → 自动排明天，`nextFireAt` 已会 DST-safe 处理，line 14）。计时引擎与持久化解耦。

**`src/main/index.ts`**：
- 建构改成 `const alarmClock = new AlarmClock(Date.now); alarmClock.hydrate(settingsStore.get().alarms);`（建构时还原上次没响完的闹钟）。
- 既有的 `alarmClock.on('changed', (alarms) => windows.broadcastAlarms(alarms))` 保留 — 即时喂 renderer 的 `alarms` state。
- **新增一行** `alarmClock.on('changed', (alarms) => settingsStore.persistAlarms(alarms));` — 每次设/删闹钟同步写入 `settings.json`。两步各自独立（即时推播 + 持久化），互不干扰。

### ⑤ renderer 完全不动（排版已由 CSS 解）

`useAppState` 既有 `onAlarmsChanged`／`onTodosChanged` 订阅、且初始就呼叫 `getAlarms()`／`getTodos()`。③ 修好 main process emit 之后 renderer 自动即时更新；④ 之后闹钟重启也会因 `getAlarms()` 读到还原的 `settings.alarms` 而续存。`TodoPanel`、`AlarmPanel`、`EyeProtectApi` 型别全部不需要更动。

### ⑥ 档案清单

| 档案 | 改动 |
|---|---|
| `src/shared/types.ts` | `Settings` 加 `alarms`；`DEFAULT_SETTINGS` 加 `alarms:[]`；加 `sanitizeAlarm`/`sanitizeAlarms` |
| `src/main/settings.ts` | +import；`sanitizeSettings` 加 alarms 栏位；+`persistAlarms` |
| `src/main/alarms.ts` | +`hydrate`（constructor 签名不动） |
| `src/main/index.ts` | +`hydrate` 还原／+`persistAlarms` wiring（保留既有的 broadcastAlarms） |
| `src/main/windows.ts` | +`broadcastTodos` |
| `src/renderer/src/styles.css` | 闹钟卡 + 待办泡泡排版（仅 CSS） |
| renderer / preload 其它 | 不动 |

## 测试

现有测试：`tests/alarms.test.ts`（fire/once-vs-daily，`tsx --test` ＋ Node 内建 test runner，以 `now` factory 注入时间）、`tests/todos.test.ts`（`sanitizeTodos` 校验）。因为闹钟持久化与 `todo:changed` emit 都是新行为，CLAUDE.md 要求「改动 reminder 排程必须连带更新测试」。补以下两项，既有的 `new AlarmClock(() => BASE_TS)` 测试因为 constructor 没动所以继续 pass：

**(a) 闹钟持久化**（加在 `tests/alarms.test.ts`）：
- 用 writable temp `dataDir`（用 `process.env.EYEPROTECT_DATA_DIR` override，见 `getDataDir` line 108）建 `SettingsStore` → `persistAlarms([once, daily, enabled mix])` → 同目录新 `SettingsStore` 实例 `read()`→`get().alarms` 完全相同（id/hour/minute/label/repeat/enabled）。
- `new AlarmClock(now).hydrate(alarms)` 用 mock `now` 验证 enabled 如期 `emit('fired')`；模拟重启 = 用同一个 store 再 `new AlarmClock(now).hydrate(store.get().alarms)` → 仍如期 fire。涵盖「重启后还在、还是会响」。

**(b) todo:changed**（加在 `tests/todos.test.ts`）：
- 监听 `todos-changed`，呼叫 `addTodo('x')` / `removeTodo(id)` → 验证有 emit、payload 为正确 `TodoItem[]`。
- mock `BrowserWindow.getAllWindows()` 回传假 `webContents` → 验证 `AppWindows.broadcastTodos(todos)` 走 `sendAll('todo:changed', todos)` 送出。

## 验证（端到端）

一次改完、跑完 `npm run typecheck && npm test` 后，才做一次建置（建置耗时，不会每步都验证）：

1. **`npm run package`** → 产出 `release/EyeProtect-*-win-x64.exe`。
2. **使用者实际启动 `.exe` 验证**：
   - 闹钟：新增 3-4 个闹钟让列表超出面板 → 该捲得起来、确定/取消/时间输入点得到；重启 `.exe` 还在。
   - 待办：新增多笔让超出泡泡 → 列表自己捲动、底部新增 `<form>` 固定且点得到；新增 / 删除即时更新。
   - 回归：现有护眼/走动提醒流程没坏（`alarm:changed` 仍动；`settings:changed` 路径没受影响；既有 `tests/alarms.test.ts` 仍 pass）。
