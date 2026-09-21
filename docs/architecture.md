# EyeProtect 精简版架构

## 活跃执行链

- 主进程：`src/main/index.ts` 负责单实例、托盘、安全 IPC、窗口、系统生命周期及服务绑定。
- `ReminderScheduler` 管理护眼/走动间隔与休息动作；`SchedulerKernel` 是唯一计时队列，处理 wall/elapsed 时钟、休眠和系统时间变化。
- `PomodoroService` 管理可选关联任务的桌面计时。旧 FocusRuntime、FocusSessionService、TaskWorkTracker 和 StandaloneReminderService 不在新版启动流程中实例化。
- `TaskService`/`TaskStore` 管理主任务、步骤、清单、完成及撤销；`TaskScheduler` 仅为可写清单中的未完成主任务注册单次提醒。旧的待发送独立提醒、时间盒和步骤通知在启动时停用。
- Renderer 通过 sandboxed preload 的 `window.eyeProtect` 访问主进程；任务使用增量推送，桌宠仅订阅轻量数据。

## 界面

`WorkbenchView` 仅展示待办、完成记录和设置；导航权威为 `workbenchNavigation.ts`。顶部筛选清单，任务原地展开，一次展开一项。日程、看板、规划、独立专注、复盘和养成页不再加载。

`SimpleSettings` 只展示休息、外观、应用三组。旧资料入口只读展示旧规则和历史资料，并允许恢复归档项目/任务；完整原数据通过备份保存。

`BubbleView` 复用同一个窗口显示手选待办、番茄钟设置或计时。优先级为健康提醒 > 番茄钟 > 手选待办。遮罩健康提醒使用独立 Alert 窗口；原主界面故障时，Emergency HTML 和原生通知继续兜底。

Alert 窗口按「艺术舞台 + 阅读面板」组织：舞台显示像素动物、提醒类型与节拍文案，面板显示标题、主进程选中的微休息活动（`ActiveReminder.activityIds` 经 `breakActivities.getActivity` 解析；活动进度在 `AlertView.tsx` 内用 `restViewModel` 的 `getActivityProgress` 按 `restStartedAt` 推进。仓库中不存在独立的 `ActivityGuide.tsx`）、倒计时环、走动提醒携带的待办、开始/完成/稍后/跳过动作。文案、阶段与倒计时由 `features/reminders/restViewModel.ts` 从主进程状态派生（`tests/rest-view-model.test.ts`），渲染端不持有计时权威。

`PetView` 的时钟按钮开启自由专注；任务行可以关联主任务启动。桌宠只渲染三只内置像素动物（橘猫/小狗/白兔），外观由 `settings.petAppearance` 决定；旧的程序化/收藏角色系统已删除。

## 数据与迁移

数据库 v5 为任务新增 `due_date`，对外字段 `dueDate` 为有效 `YYYY-MM-DD` 或 null。升级前 checkpoint WAL 并复制原数据库及旁文件；新增列和日期转换在同一事务完成，5001 标记防止重复转换。迁移失败进入只读恢复模式。旧 `dueAt` 保留，日常分组不再读取它；新日期被清空后不会复活旧日期。

主任务 `parentId=null`。新步骤通过 `task:create-step` 创建，父级必须是未完成主任务。旧多层关系只在展示时按既有顺序平铺，不重写关系。清单复用 Project ID，active/onHold 可用，completed/archived 仅在旧资料和完成历史中显示。

`task:complete-tree` 接收主任务及所有待完成步骤的 revision 映射。主进程在事务中验证集合与版本、完成并记录撤销快照。事务提交前不向 renderer 发送增量事件，回滚不泄漏部分状态。撤销保留此前已经完成的步骤。

重复生成在生产 TaskService 中关闭，包括 set-status 和 update-status 两条路径；旧规则字段保留。数据库 schema 为 v5；备份格式当前为 **v8**（`src/main/backup.ts` 的 `version: 8`）。导入旧版本时转换日期；显式 null 不回退旧日期。旧规划、时间块、步骤层级、提醒和专注表继续参与导出/恢复。

## 番茄钟

`pomodoro:prepare` 进入气泡设置阶段；`pomodoro:start` 接收可空任务 ID、分钟数和替换确认。状态阶段为 idle、ready、focus、break、focus-finished、break-finished，另有 running、remainingMs 和 revision。

服务用单调时钟计算剩余时间，并向 Kernel 注册结束与 10 秒检查点。`pomodoro-state.json` 原子写入成功后才发布状态和注册新期限。renderer 仅插值显示，不能自行完成计时。锁屏/休眠/退出暂停；重启一律恢复为暂停，失效关联任务使计时结束。

健康提醒初次出现时不自动暂停专注；`reminder:begin-rest` 才启动实际休息并暂停 focus。休息结束不恢复番茄钟，必须手动继续。专注到点或短休息与健康提醒重叠时，开始健康休息会合并为一次展示，使用健康时长与短休息剩余时长的较大值；结束短休息绝不自动记录护眼或走动完成。

## 窗口、安全与测试

气泡观察卡片自然高度，通过仅限真实 Bubble WebContents 的 `window:bubble:height` 上报。桌宠用同样的发送方限制上报 SVG 可见轮廓；主进程计算上下避让与尾巴位置，每次拖动都同步更新气泡并重申固定桌宠尺寸。

Emergency preload 只提供绑定当前提醒的动作和只读倒计时状态，不暴露一般应用 API 或由页面指定提醒 ID。

`simple-experience.test.ts` 覆盖迁移、日期/DST、备份、原子完成及回滚；`pomodoro.test.ts` 覆盖时钟、暂停恢复、休息和结束阶段。保留旧存储/备份测试作为兼容验证。`smoke-simple-experience.mjs` 与 `smoke-simple-pet-failure.mjs` 是当前打包验收入口；旧 UI 专项脚本不再用于当前 CI。

## 遗留面清单

产品已收敛为待办 / 完成记录 / 设置 + 桌宠 / 气泡 / 休息遮罩 / 番茄钟，但仓库仍保留上一代工作台的代码与数据域，用于备份兼容、旧资料只读恢复，以及尚未删除的 IPC/测试面。

**文档权威**：`CLAUDE.md` 与本文描述当前产品；`AGENTS.md` 应与本文对齐。修改遗留面前先确认目标是「兼容路径」还是「活跃 UI」。

### 活跃路径（默认改动落点）

| 层 | 位置 |
| --- | --- |
| 启动装配 | `src/main/index.ts`：`ReminderScheduler`、`SchedulerKernel`、`TaskService(store, false)`、`TaskScheduler`、`PomodoroService` |
| 工作台 UI | `WorkbenchView.tsx` + `workbenchNavigation.ts`（仅 today/review/settings）+ `SimpleSettings.tsx` |
| 其它窗口 UI | `PetView.tsx`、`BubbleView.tsx`、`AlertView.tsx` |
| 样式 | `styles/simple.css`（工作台）、`styles.css` + `styles/theme.css`（桌宠/气泡/提醒） |
| CI smoke | `scripts/smoke-simple-experience.mjs`、`scripts/smoke-simple-pet-failure.mjs` |

### 处置结论（本轮）

本轮只处理**孤儿 renderer** 与**不在 CI 的 smoke/capture 脚本**；主进程兼容模块与 IPC 暂留。

| 类别 | 处置 | 目标位置 |
| --- | --- | --- |
| 孤儿 UI 组件 / 仅被孤儿组件使用的 hooks | **归档迁移** | `src/renderer/src/_legacy/` |
| 仍有单元测试的纯函数（`todaySections`、`todayViewModel`、`planLayout`、`taskRowMetadata`、`taskReorder`、`focusCompletion`） | **原地保留** | `src/renderer/src/features/tasks/` |
| 主进程 focus/plan/standalone/dailyReview 模块与存储表 | **本轮不动** | 仍由备份/IPC/测试触达 |
| 非 CI 的 `scripts/smoke-*`（除 simple 两个）与 `capture-*`、`build-reminder-preview` | **归档迁移** | `scripts/legacy/` |
| CI/npm 权威脚本 | **保留原位** | `scripts/verify-*.mjs`、`smoke-simple-experience.mjs`、`smoke-simple-pet-failure.mjs`、`build-app-icon.mjs` |

归档后同步调整：`tests/design-system-contract.test.ts`、`tests/modal-keyboard-contract.test.ts`、`scripts/verify-ui-contract.mjs` 只约束**活跃** chrome/样式路径；`scripts/legacy/README.md` 说明这些脚本不在 CI。

### 遗留 / 兼容面（不在主 UI 路径）

**主进程模块（源码仍在，生产启动不按旧产品实例化）**

- `focusRuntime.ts`、`focusSession.ts`、`taskWorkTracker.ts` — 旧专注/工时
- `standaloneReminders.ts`、`dailyReview.ts` — 旧独立提醒与日复盘
- `taskStore.ts` 中仍存在的规划 / TimeBlock / Section / FocusSession / StandaloneReminder 表与方法（备份与兼容读取）

**IPC / preload（`window.eyeProtect` 仍暴露，活跃 UI 不应新增依赖）**

- `focus:*`、`plan:*`、`timeblock:*`、`section:*`、`standalone-reminder:*`、`daily:review`、`daily:reflection:*`、`checkpoint:*`、`history:report` 等
- `data:legacy` / `task:restore-legacy` — 设置页「旧资料与恢复」仍使用

**孤儿 renderer（已归档 / 待归档至 `src/renderer/src/_legacy/`）**

- 设置：`SettingsView.tsx`（活跃设置是 `features/simple/SimpleSettings.tsx`）
- 旧任务工作台 UI：`PlanWorkspace`、`ProjectWorkspace`、`ProjectList`、`FocusSurface`、`TaskDetail`、`TaskList`、`TaskComposer`、`PetTasksView` 及对应 module CSS
- 旧规划/复盘/独立提醒 UI：`planning/DailyPlanningFlow`、`review/DailyReview`、`reminders/StandaloneReminderSection`
- 旧命令面板：`components/CommandPalette.tsx`
- 仅服务上述组件的 hooks：`useTimeBlocks`、`useDailyPlans`、`useFocusStatus`、`useWeeklyReport`、`useStandaloneReminders`、`useDailyReview`、`useTaskCheckpoints`、`useProjectSections`

**原地保留的遗留纯函数（仍有测试）**

- `features/tasks/todaySections.ts`、`todayViewModel.ts`、`planLayout.ts`、`taskRowMetadata.ts`、`taskReorder.ts`、`focusCompletion.ts`
- 工作台**不**挂载旧 Today/Focus 视图；这些模块供兼容/回归网使用

**脚本**

- **权威（package.json / CI）**：`scripts/verify-build-contract.mjs`、`verify-ui-contract.mjs`、`smoke-simple-experience.mjs`、`smoke-simple-pet-failure.mjs`、`build-app-icon.mjs`
- **已归档（不在 CI）**：`scripts/legacy/` 下历史 `smoke-*`（非 simple）、`capture-*`、`build-reminder-preview.tsx` 等；见 `scripts/legacy/README.md`

**测试仍覆盖但对应 UI 已下线**

- `tests/focus-session.test.ts`、`focus-runtime.test.ts`、`daily-planning.test.ts`、`today-sections.test.ts`、`today-view-model.test.ts`、`project-sections.test.ts`、`standalone-reminders.test.ts`、`plan-layout.test.ts` 等 — 视为**兼容/回归网**，删除遗留代码前需要先决定这些测试的去留。

### 使用约束

1. 活跃 UI **不得** import `src/renderer/src/_legacy/**`，也不得为遗留 IPC 扩展 preload 上的“新产品功能”。
2. 改 `taskStore` schema / 备份时，必须保持旧域导出与恢复路径，或同步删除对应兼容测试并更新本文。
3. 新文档与新 smoke 只描述 `package.json` 中真实存在的命令；`scripts/legacy/**` 不进 CI。
4. 删除 `_legacy` 或 `scripts/legacy` 属于后续独立变更：先改本文与契约测试/verify 脚本，再动文件。
5. UI 契约（`verify:ui-contract`、design-system/modal 测试）只约束**活跃**视图与样式路径。
