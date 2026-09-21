# Repository Guidelines

## 默认编码准则

**所有编码工作必须遵循 [RULES.md](RULES.md) 中的工程准则。** 这 20 条规则是默认的编码标准，涵盖理解问题、选择最简单方案、保持范围、显式优于巧妙、验证重要行为等。CLAUDE.md 提供项目特定的架构和约定；RULES.md 提供通用的工程哲学。两者冲突时，RULES.md 优先。

## 产品真相与文档优先级

当前产品是**精简版**工作台：主界面只有**待办、完成记录、设置**。桌宠、气泡、休息遮罩、番茄钟仍是活跃能力。旧的项目看板 / 每日规划 / TimeBlock / 独立专注 / 复盘 / 养成页**不在当前主流程**。

改代码前以这些文档为准（冲突时前者优先）：

1. [CLAUDE.md](CLAUDE.md)、[docs/architecture.md](docs/architecture.md) — **产品与架构真相**
2. [RULES.md](RULES.md) — 工程哲学
3. [docs/coding-guide.md](docs/coding-guide.md) — 编码模式；其中 Today/Project Workspace 等章节描述的是**遗留面**，不是当前 UI
4. [docs/color-system.md](docs/color-system.md) — 设计令牌意图；真实 CSS 以 `theme.css` / `tokens.css` 为准
5. [docs/hardening-notes.md](docs/hardening-notes.md) — 历史加固记录，不是当前产品规格
6. [docs/release-checklist.md](docs/release-checklist.md) — 发布验收

仓库中**不存在** `docs/ipc-guide.md`。IPC 约定见 CLAUDE.md、`docs/coding-guide.md` §11，以及 `src/shared/types.ts` 的 `EyeProtectApi` + `src/preload/index.ts` + `src/main/index.ts` 三处对齐。

## 文档地图

阅读或修改代码前，先按工作领域找到对应的文档和源代码。

| 工作领域 | 主要文档 | 关键源码 | 相关测试 |
| --- | --- | --- | --- |
| 项目架构与进程拆分 | [CLAUDE.md](CLAUDE.md)、[docs/architecture.md](docs/architecture.md) | `src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx` | — |
| 编码准则与工程哲学 | [RULES.md](RULES.md) | — | — |
| 任务/清单/步骤数据模型 | [CLAUDE.md](CLAUDE.md)、[docs/architecture.md](docs/architecture.md) | `src/shared/types.ts`、`src/shared/simpleTasks.ts`、`src/main/taskStore.ts` | `tests/task-store.test.ts`、`tests/schema-v4.test.ts`、`tests/simple-experience.test.ts` |
| IPC 能力扩展 | [CLAUDE.md](CLAUDE.md)、[docs/coding-guide.md](docs/coding-guide.md) | `src/shared/types.ts`、`src/preload/index.ts`、`src/main/index.ts`、`src/main/ipcTaskInput.ts` | `tests/ipc-task-input.test.ts`、`tests/ipc-project-input.test.ts`、`tests/security.test.ts` |
| 提醒调度与休息节奏 | [CLAUDE.md](CLAUDE.md)、[docs/architecture.md](docs/architecture.md) | `src/main/reminders.ts`、`src/main/scheduling/kernel.ts` | `tests/reminders.test.ts`、`tests/scheduler-kernel.test.ts` |
| 番茄钟 | [docs/architecture.md](docs/architecture.md) §番茄钟 | `src/main/pomodoro.ts` | `tests/pomodoro.test.ts` |
| 设置项与清洗 | [CLAUDE.md](CLAUDE.md) | `src/shared/types.ts`、`src/main/settings.ts`、`src/renderer/src/features/simple/SimpleSettings.tsx` | `tests/settings-write.test.ts` |
| 渲染端命令层 | [docs/coding-guide.md](docs/coding-guide.md) | `src/renderer/src/lib/commands.ts`、`src/renderer/src/hooks/useCommand.ts` | `tests/command-layer.test.ts` |
| 窗口管理与 Surface | [docs/architecture.md](docs/architecture.md) | `src/main/windows.ts`、`src/main/reminderSurface.ts` | `tests/reminder-surface.test.ts`、`tests/windowBounds.test.ts` |
| 配色与设计令牌 | [docs/color-system.md](docs/color-system.md) | `src/renderer/src/styles/tokens.css`、`src/renderer/src/styles/theme.css` | `tests/design-system-contract.test.ts`、`tests/theme-authority.test.ts` |
| 安全加固记录 | [docs/hardening-notes.md](docs/hardening-notes.md) | `src/main/security.ts` | `tests/security.test.ts` |
| 发布与验收 | [docs/release-checklist.md](docs/release-checklist.md) | `package.json`、`.github/workflows/windows.yml` | — |
| 备份与恢复 / 旧资料 | [docs/architecture.md](docs/architecture.md) | `src/main/backup.ts`、`src/main/taskStore.ts` | `tests/backup.test.ts`、`tests/schema-v4.test.ts` |
| 工作台（待办/完成/设置） | [docs/architecture.md](docs/architecture.md) §界面 | `src/renderer/src/views/WorkbenchView.tsx`、`src/renderer/src/features/workbench/workbenchNavigation.ts`、`src/renderer/src/features/simple/SimpleSettings.tsx` | `tests/workbench-navigation.test.ts`、`tests/simple-experience.test.ts` |
| 桌宠与像素动物 | [CLAUDE.md](CLAUDE.md) | `src/shared/pixelAnimals.ts`、`src/renderer/src/views/PetView.tsx`、`src/renderer/src/features/characters/PixelAnimal.tsx` | `tests/rest-view-model.test.ts` |
| 休息提醒界面 | [docs/architecture.md](docs/architecture.md) §界面 | `src/renderer/src/views/AlertView.tsx`、`src/renderer/src/features/reminders/restViewModel.ts` | `tests/rest-view-model.test.ts` |
| 遗留面（不在主流程） | [docs/architecture.md](docs/architecture.md) §遗留面清单 | 见该节清单 | 对应兼容测试仍在 `tests/` |

## 项目整体功能

EyeProtect 是 Windows 本地优先的护眼提醒与待办助手，技术栈是 Electron、electron-vite、React、严格 TypeScript。启动后常驻系统托盘，并显示可拖动的透明桌宠窗口。按设置触发护眼/走动提醒，临近时合并为一次；提醒支持完成、稍后、跳过、暂停。气泡可展示手选待办或番茄钟。工作台提供待办清单（按截止日期分组、原地展开备注/日期/单次提醒/一层步骤）、完成记录和设置。数据保存在本地，打包生成 Windows x64 NSIS 安装包与 portable exe。

## 项目结构

- `src/main/`：Electron 主进程——生命周期、托盘、窗口、IPC、提醒调度、设置读写、开机自启。`index.ts` 是装配与 IPC 入口；`reminders.ts` + `scheduling/kernel.ts` 拥有计时权威；`taskService.ts` / `taskStore.ts` 拥有任务数据。
- `src/preload/`：`contextBridge` 暴露 `window.eyeProtect`。`emergency.ts` 是紧急提醒页的最小桥。API 面与 `src/main/index.ts` 的 `handleIpc` 列表对齐；规划/专注/Section 等死通道已移除。见 [docs/architecture.md](docs/architecture.md) §主进程与 preload 收口结论。
- `src/shared/`：跨进程类型与策略（`types.ts`、`simpleTasks.ts`、`pixelAnimals.ts`、`projectPolicy.ts`、`breakActivities.ts` 等）。
- `src/renderer/`：`App.tsx` 按 URL hash 加载 `#pet`（默认）、`#bubble`、`#workbench`/`#settings`、`#alert`。活跃视图为 `views/PetView.tsx`、`BubbleView.tsx`、`WorkbenchView.tsx`、`AlertView.tsx`。工作台设置页是 `features/simple/SimpleSettings.tsx`（**不是** `views/SettingsView.tsx`）。`styles/simple.css` 服务精简工作台；`styles.css` 服务桌宠/气泡/提醒窗。
- `tests/`：Node 内置 test runner（`tsx --test tests/*.test.ts`）。覆盖调度、存储、备份、IPC 清洗、安全、rest view-model 等；部分用例保护**遗留数据兼容**路径，不代表这些功能仍在 UI 中。
- `scripts/`：当前 CI/打包验收入口只有 `verify-build-contract.mjs`、`verify-ui-contract.mjs`、`smoke-simple-experience.mjs`、`smoke-simple-pet-failure.mjs`、`build-app-icon.mjs`。历史 `smoke-*` / `capture-*` 在 `scripts/legacy/`，**未**挂进 `package.json`，也**不在** CI。
- `public/assets/`：`tray-icon.png`、`app-icon.ico`；桌宠与提醒视觉主要为内联 SVG。
- `out/`、`release/`、`node_modules/`、`data/`、`artifacts/`：生成物或本地数据，不提交。

## 功能修改位置速查

| 要修改的功能 | 主要修改文件 | 注意事项 |
| --- | --- | --- |
| 护眼/走动提醒间隔、稍后、完成、跳过、暂停、合并 | `src/main/reminders.ts` | 同步补 `tests/reminders.test.ts`；区分真实提醒与测试提醒是否重置日程。 |
| 番茄钟阶段、暂停恢复、与健康提醒合并 | `src/main/pomodoro.ts` | 计时权威在主进程 + SchedulerKernel；补 `tests/pomodoro.test.ts`。 |
| 新增/调整设置项 | `src/shared/types.ts`、`src/main/settings.ts`、`src/renderer/src/features/simple/SimpleSettings.tsx` | 类型、清洗、UI 必须一起改。**不要**改孤儿文件 `views/SettingsView.tsx`。 |
| 设置文件读写与保存目录 | `src/main/settings.ts` | 目录由 `getDataDir()` 决定；不要提交 `data/settings.json`。 |
| 开机自启 | `src/main/settings.ts` | `syncStartupShortcut()`；仅 packaged 模式写 Windows Startup。 |
| 托盘、单实例、退出、IPC 注册 | `src/main/index.ts` | 托盘菜单在 `createTray()`；IPC handler 集中在此注册，通道名须与 preload 一致。 |
| 桌宠/气泡/提醒/工作台窗口 | `src/main/windows.ts` | 设置是工作台内嵌页，无独立设置窗口；改布局时覆盖 bounds 测试。 |
| 新 IPC / `window.eyeProtect` 能力 | `src/shared/types.ts` → `src/preload/index.ts` → `src/main/index.ts` | 先扩展 `EyeProtectApi`，再 preload invoke，最后 main handle + 入参白名单。活跃路径优先复用现有命令层。 |
| IPC 入参清洗 | `src/main/ipcTaskInput.ts`、`src/main/ipcProjectInput.ts` | 所有 renderer 字段在此白名单化；含 `baseRevision` 时补对应 input 测试。 |
| 工作台待办/完成记录 UI | `src/renderer/src/views/WorkbenchView.tsx`、`src/features/simple/SimpleSettings.tsx`、`src/features/workbench/workbenchNavigation.ts` | 导航权威是 `workbenchNavigation.ts`（仅 `today`/`review`/`settings`）。任务列表 UI 目前内联在 WorkbenchView，**不要**默认挂载 `PlanWorkspace` / `FocusSurface` / `ProjectWorkspace` 等遗留组件。 |
| 提醒遮罩卡片文案与进度 | `src/renderer/src/views/AlertView.tsx`、`src/renderer/src/features/reminders/restViewModel.ts` | 进度由 `restViewModel` 从主进程状态派生；仓库中**没有** `ActivityGuide.tsx`，活动解析在 AlertView 内完成。 |
| 视觉令牌与窗口样式 | `src/renderer/src/styles/`、`src/renderer/src/styles.css` | 交互元素必须 `no-drag`；颜色用语义令牌。见 [docs/color-system.md](docs/color-system.md)。 |
| 像素动物 | `src/shared/pixelAnimals.ts`、`src/renderer/src/features/characters/PixelAnimal.tsx` | 仅内置橘猫/小狗/白兔；`PIXEL_ANIMALS` 是唯一来源。 |
| 打包与产物 | `package.json` `build`、`electron.vite.config.ts` | 默认输出 `release/`；NSIS + portable x64。 |
| 备份导入/导出与旧资料 | `src/main/backup.ts`、`src/main/taskStore.ts` | 备份格式当前为 **v8**，数据库 schema **v5**；导入前建回滚快照。旧规划/专注/独立提醒域仍参与导出与只读恢复。 |
| 遗留功能代码 | [docs/architecture.md](docs/architecture.md) §遗留面清单 | 孤儿 UI 在 `src/renderer/src/_legacy/`；历史脚本在 `scripts/legacy/`。活跃路径不要依赖它们。 |

## 构建、测试与运行命令

以 `package.json` 的 `scripts` 为唯一权威（CI 同此）：

- `npm install`：按 `package-lock.json` 安装依赖。
- `npm run dev`：Electron 开发环境。
- `npm run typecheck`：`tsc --noEmit`。
- `npm test`：`tsx --test tests/*.test.ts`。
- `npm run build`：electron-vite 构建到 `out/`，并跑 `verify:build`。
- `npm run start`：预览已构建应用。
- `npm run verify:ui-contract`：语义颜色、CSS 所有权、可访问性/命中区域等契约。
- `npm run package` / `package:nsis` / `package:portable`：生成 Windows 产物到 `release/`。
- `npm run smoke:simple`：打包应用的精简体验 smoke（CI 会以 1 / 1.25 / 1.5 缩放及 `--emergency` 调用脚本本体）。
- `npm run smoke:pet-failure`：桌宠失效时任务与休息流程仍可用。

交付前至少运行 `npm run typecheck` 与 `npm test`；改 UI 契约或打包/资源时再跑 `verify:ui-contract` / `build` / `package`。涉及休息调度时必须补 `tests/reminders.test.ts` 或 `tests/pomodoro.test.ts`；迁移/步骤/完整性补 `tests/simple-experience.test.ts`。

## 代码风格与约定

严格 TypeScript、两空格、单引号、分号；`camelCase` 变量/函数，`PascalCase` 类型与 React 组件。跨进程数据结构放在 `src/shared/types.ts`，不要在三端重复定义。Renderer 不直接访问 Node/Electron，只使用 `window.eyeProtect`。用户可见写操作优先走命令层（`useCommand` + `run`），失败要可见，不要静默吞掉。倒计时权威在主进程 `SchedulerKernel`，不要在 renderer 自建计时权威。

更完整的模式说明见 [docs/coding-guide.md](docs/coding-guide.md)（注意其中规划/专注相关章节描述遗留面）。

## 测试要求

- 新测试：`tests/*.test.ts`。
- 提醒调度/暂停/稍后/合并/测试提醒 → 必须更新 `tests/reminders.test.ts`。
- 番茄钟与休息合并 → `tests/pomodoro.test.ts`。
- 设置清洗 → 覆盖默认值、边界值、非法输入回退。
- IPC 新字段 → 更新 `tests/ipc-task-input.test.ts` 或 `tests/ipc-project-input.test.ts`。
- 交付验证：`npm run typecheck` + `npm test`；打包相关再跑 `npm run build` 或 `package`。

## 提交与 PR 建议

提交信息用简短祈使句，例如 `Fix reminder pause scheduling`、`Sync agents docs with simplified product`。PR 描述说明：用户可见变化、主要文件、实际跑过的验证命令。UI 改动附截图/录屏；打包改动说明对 `release/` 产物的影响。若改动触及文档与代码不一致处，在 PR 中写明以哪一侧为准。

## 安全与配置注意事项

不要提交本地运行数据、机器路径、密钥或个人配置。`data/settings.json` 是运行时配置，不是源码。`out/`、`release/`、`node_modules/`、`artifacts/` 视为生成物或依赖。Renderer 入口受页面白名单与 sender URL 信任约束；新增窗口或 IPC 时保持 `src/main/security.ts` 的校验路径，不要为方便绕过。

## 遗留面（摘要）

完整清单与处置见 [docs/architecture.md](docs/architecture.md) §遗留面清单 / §处置结论。

- **已归档 renderer**：`src/renderer/src/_legacy/**`（孤儿 UI 与仅服务它们的 hooks）。活跃 UI 不得 import。
- **原地保留的纯函数**：`features/tasks/` 下 `todaySections` / `planLayout` 等，仍有测试。
- **主进程**：测试专用服务模块已删（轮次 B）。`taskStore` 规划/专注/独立提醒表、backup、`data:legacy` 仍保留（轮次 C：只读兼容 + 备份往返；单条 CRUD 仅测试使用）。`history:*` renderer IPC 与 `standalone-reminder:list` 已从 preload/API 移除（轮次 D）；`ReminderHistoryStore` 仍服务调度写入与备份。
- **脚本**：权威入口在 `scripts/` 根目录；历史脚本在 `scripts/legacy/`。
