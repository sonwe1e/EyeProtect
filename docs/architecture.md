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

### 冗余清理轮次（死代码与半死 IPC）

对全仓做过一次引用盘点后，删除了以下**生产 0 引用**的面（删除时三端/契约同步）：

| 删除对象 | 原因 |
| --- | --- |
| `src/shared/dailyPlanning.ts`（+ 测试） | 每日规划域纯函数，仅测试存活；保留名单外 |
| `src/shared/projectSections.ts`（+ 测试） | 仅测试存活；`project_sections` 写 CRUD 生产 0 调用 |
| `src/renderer/src/features/tasks/taskWorkInterpolation.ts`（+ 测试） | 仅测试存活，不属保留名单 |
| `src/renderer/src/components/primitives/`（6 文件） | 上代组件框架残留，barrel 无 importers |
| `src/renderer/src/styles/workbench.css`、`styles/settings.css`、`base.css` 的 `.visually-hidden`、`styles.css` 的 `.workbench-v2 *` | 旧工作台样式；唯二引用来自已删的 NavItem |
| `getTask` / `getProject` / `getActiveTaskId` / `onActiveTaskChanged` / `getPendingTaskCount` / `onPendingTaskCountChanged`（types + preload + `handleIpc` + `windows` 广播） | renderer 0 调用；待办计数实际由 `useTasks()` 全量订阅派生 |

同步调整：`scripts/verify-ui-contract.mjs` 移除针对上述死 CSS 的断言（`.app-nav-item` 命中区、`.workbench-v2 .task-row`、container-query 契约），forced-colors 断言改指 `simple.css`；`tests/design-system-contract.test.ts` 移除死选择器断言。`taskStore` 的 legacy 写 CRUD 与 `features/tasks/` 其余 6 个纯函数仍按保留名单原地保留（备份 v8 / `data:legacy` 只读兼容）。

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

**Packaged smoke 与改版休息卡对齐**：`2827ae3` 改版后环标签为「剩余时长 / 已到时间」，进行中主按钮为「完成休息（还剩 N 秒）」，完成按钮为「完成休息打卡」；`AlertView` 每次提醒随机 follow/breathe/pet，breathe 会把环文案改成「余 mm:ss」。`smoke-simple-experience.mjs` 在断言前固定「视线光球」模式，并按上述现行文案断言。master 在该对齐合入前，`verify-and-package` 会因旧 smoke 文案红。

### 主进程与 preload 收口结论（本轮）

盘点事实（v1.6 精简产品）：

| 事实 | 含义 |
| --- | --- |
| `src/main/index.ts` **未注册** `plan:*` / `timeblock:*` / `focus:*` / `section:*` / `checkpoint:*` / `daily:*` / standalone 的写通道 | preload 若仍暴露这些方法，调用必然失败（死 API） |
| `focusRuntime` / `focusSession` / `taskWorkTracker` / `standaloneReminders` / `sceneAwareness` **无生产 import** | 仅 `tests/` 直接引用（PR #7 时点） |
| `buildDailyReview` **无**生产调用 | `data:legacy` 直接读 `taskStore`；`dailyReview.ts` 在轮次 B 删除 |
| 备份 `data:backup:*` 仍导出/恢复规划、专注、独立提醒域 | **存储层**兼容保留；不等于需要活跃 IPC 写入口 |
| 活跃 UI 的 `window.eyeProtect` 调用集中在 settings/reminder/pomodoro/task/project/pet/bubble/workbench/delivery/backup/legacy | preload 应以这些通道为准 |

**处置：**

1. **类型**：`EyeProtectApi` 只描述主进程真实注册 + 活跃/兼容路径需要的方法；删除无 handler 的死 API 声明。
2. **preload**：与 `EyeProtectApi` 对齐，移除无 handler 的 invoke/on 封装。
3. **commands.ts**：只保留活跃路径命令组（`run` + tasks/projects/reminder/settings/data/app）；旧 plans/sections/focus/timeBlocks 组删除。
4. **主进程模块（轮次 B）**：无生产 import 的测试专用服务模块 **删除**；存储/备份/`data:legacy` 仍触达的域 **只读兼容保留**。
5. **`_legacy` / `scripts/legacy`**：**已删除**（产品边界轮次）。纯函数回归网仍在 `features/tasks/` 与 `tests/`。
6. **存储与备份表**：本轮不动 `taskStore` 中的规划/专注/独立提醒表与 backup 导出/恢复。
7. **commands.ts**：仅保留 tasks/projects/deliveries/reminders/settings/data/system。

### 轮次 B：主进程测试专用模块处置

盘点（v1.6 精简产品，PR #7 合入后）：

| 模块 | 生产 import | 直接测试 | 存储 / 备份 / IPC | 处置 |
| --- | --- | --- | --- | --- |
| `sceneAwareness.ts` | 无 | `scene-awareness.test.ts` | 无表；调度策略未装配 | **删除**模块+测试 |
| `focusRuntime.ts` | 无 | `focus-runtime.test.ts` | 依赖 focusSession/tracker 服务 | **删除**模块+测试 |
| `taskWorkTracker.ts` | 无 | `task-work-tracker.test.ts` | 无独立表 | **删除**模块+测试 |
| `focusSession.ts`（`FocusSessionService`） | 无 | `focus-session.test.ts` | `taskStore` FocusSession 表 + backup + `data:legacy`（直接读 store，不经 service） | **删除服务模块+服务测试**；**存储方法保留**（`schema-v4.test.ts` 仍覆盖） |
| `standaloneReminders.ts`（`StandaloneReminderService`） | 无 | `standalone-reminders.test.ts`（含 shared 纯函数） | `taskStore` 表 + backup + `standalone-reminder:list` + `data:legacy` | **删除服务模块**；测试**只保留** `shared/types` 的 schedule sanitizer / `nextStandaloneReminderFireAt` |
| `dailyReview.ts` | **盘点更正**：`data:legacy` 已直接读 store，**不再**调用 `buildDailyReview` | `daily-review.test.ts` | 无生产调用方 | **删除**模块+测试（import 已死） |

同步清理：

- `index.ts` 中未再注册写通道、也无调用方的 `asStandaloneReminderInput` / `asStandaloneReminderUpdate` **删除**。
- ~~preload `getStandaloneReminders`~~ → **轮次 C+D 移除**（见下节）。
- ~~`windows.broadcastStandaloneReminders`~~ → **轮次 C+D 移除**；backup 导出路径**不动**。

### 轮次 C+D：taskStore 兼容域边界 + history/standalone IPC

**C — 存储域读写矩阵（v1.6）**

| 域 | 生产读 | 生产写 | 保留原因 |
| --- | --- | --- | --- |
| Task / Project / todo settings | workbench / pet / bubble / backup | 活跃命令层 | 当前产品 |
| Reminder history（`ReminderHistoryStore`） | scheduler `onEvent` 记录；backup 导出/恢复 | scheduler 写事件；backup `replaceEvents`；retention | **产品行为**仍在用（历史留痕 + 备份）；renderer **不再**读 weekly/care |
| StandaloneReminder 表 | backup 导出；`data:legacy` | backup 导入 `replaceAll`；`data:reset` 清空 | 只读兼容 + 备份往返 |
| DailyTaskPlan / TimeBlock / FocusSession / TaskCheckpoint / DailyReflection | backup 导出；`data:legacy`（plans/sessions） | backup 导入 `replaceAll*`；`data:reset` 清空 reflections（并补齐 plans/timeblocks/sessions/checkpoints） | 只读兼容 + 备份往返 |
| `taskStore` 上的 create/update/delete 单条规划/专注/独立提醒方法 | **无生产调用** | 仅测试构造 schema 不变量 | **方法保留**供 `schema-v4` 等兼容测试；活跃路径禁止再接 IPC 写 |

**D — IPC / preload 处置**

| 通道 / API | 活跃 UI | 处置 |
| --- | --- | --- |
| `history:report` / `history:care` / `history:clear` / `history:export` + preload weekly/care 方法 | 无（仅 `_legacy` hooks） | **移除** handler + `EyeProtectApi` + preload；`historyStore` 内部 record/backup **保留** |
| `standalone-reminder:list` + `getStandaloneReminders` | 无 | **移除** handler + API + preload |
| `history:changed` / `care:changed` / `standalone-reminder:changed` / `standalone-reminder:fired` broadcast | 无活跃监听 | **移除** `windows.broadcast*` 与 publish 调用 |
| `data:legacy` / `task:restore-legacy` | 设置页「旧资料与恢复」 | **保留** |
| workbench section 联合类型 `reminders`/`pet-tasks` | 导航只有 today/review/settings | **收成** `today \| review \| settings` |

`ReminderHistoryStore` 仍由 ReminderScheduler `onEvent` 写入并参与备份，只是不再对 renderer 暴露 weekly/care API。

### 遗留 / 兼容面（不在主 UI 路径）

**主进程模块**

- **已删除（轮次 B）**：`focusRuntime.ts`、`focusSession.ts`、`taskWorkTracker.ts`、`standaloneReminders.ts`、`sceneAwareness.ts`、`dailyReview.ts` 及仅服务它们的测试。盘点更正：`data:legacy` **不再**调用 `buildDailyReview`，改为直接读 store 列旧资料。
- `taskStore.ts` 中仍存在的规划 / TimeBlock / Section / FocusSession / StandaloneReminder 表与方法（备份、`data:legacy` 与兼容读取；本轮未删表）。

**IPC / preload**

- PR #7 移除无 handler 的死 API；**轮次 C+D** 再移除 `history:*` renderer 面与 `standalone-reminder:list`。
- **仍在**：`data:legacy` / `task:restore-legacy`（设置页旧资料）；reminder/pomodoro/task/project/backup 等活跃通道。
- 主进程 `ReminderHistoryStore` **不**因移除 history IPC 而删除。

**孤儿 renderer**

- **已删除**：旧 Settings/Plan/Project/Focus/TaskDetail 等 UI 与仅服务它们的 hooks（曾位于 `src/renderer/src/_legacy/`）。
- 活跃工作台仍是 `WorkbenchView` + `workbenchNavigation`（today/review/settings）+ `SimpleSettings`。


**原地保留的遗留纯函数（仍有测试）**

- `features/tasks/todaySections.ts`、`todayViewModel.ts`、`planLayout.ts`、`taskRowMetadata.ts`、`taskReorder.ts`、`focusCompletion.ts`
- 工作台**不**挂载旧 Today/Focus 视图；这些模块供兼容/回归网使用

**脚本**

- **权威（package.json / CI）**：`scripts/verify-build-contract.mjs`、`verify-ui-contract.mjs`、`smoke-simple-experience.mjs`、`smoke-simple-pet-failure.mjs`、`build-app-icon.mjs`
- **已删除**：历史 `scripts/legacy/**`（smoke/capture 等，从未进 CI）

**测试仍覆盖但对应 UI 已下线**

- **已随轮次 B 删除**：`focus-session.test.ts`、`focus-runtime.test.ts`、`task-work-tracker.test.ts`、`scene-awareness.test.ts`、`daily-review.test.ts`；`standalone-reminders.test.ts` 缩为 shared 纯函数网。
- **仍在（存储/纯函数/遗留规划面）**：`schema-v4.test.ts`（FocusSession/StandaloneReminder 表）、`daily-planning.test.ts`、`today-sections.test.ts`、`today-view-model.test.ts`、`project-sections.test.ts`、`plan-layout.test.ts`、`focus-completion.test.ts` 等。

#### 产品边界 lint + 命令层 + 遗留面删除

| 项 | 处置 |
| --- | --- |
| `src/renderer/src/_legacy/**` | **删除**（活跃 UI 无 import；typecheck 早已 exclude） |
| `scripts/legacy/**` | **删除**（不在 package.json / CI） |
| 命令层 | 用户可见**写操作**必须经 `run` / `useCommand`（`action.run` 等）；读操作与窗口几何/导航 IPC 可直调 |
| lint | `scripts/verify-product-boundary.mjs`（`npm run verify:product`）：遗留目录不存在、活跃源码不引用遗留路径、写操作须包在 `run` 中 |

`npm run lint` = `verify:product` + `verify:ui-contract`。CI 在 typecheck/test 之后跑 `verify:product` 与 `verify:ui-contract`。

**写操作（须命令层）**：任务/项目/投递/提醒/番茄/设置/备份/恢复/自定义桌宠打开等会改状态或弹系统对话框的调用。  
**直调允许**：`get*` / `on*` 监听、`openWorkbench` / `showPetContextMenu`、`movePetWindow` / `reportPetArtworkBounds` / `reportBubbleHeight`（窗口几何与导航）。

### IPC 契约扫描（轮次）

活跃面以三方对齐为准，由 `tests/ipc-contract.test.ts` 在 `npm test` 中强制：

| 对齐 | 规则 |
| --- | --- |
| preload `ipcRenderer.invoke('ch')` ↔ main `handleIpc('ch')` | 双向一一对应；任一侧多出通道即失败 |
| preload `on<T>('ch')` ↔ main `sendTo` / `webContents.send('ch')` | preload 监听的事件通道必须有 main 发送方 |
| `EyeProtectApi` 方法名 ↔ preload `api` 对象键 | 双向一致 |
| 活跃 renderer（排除 `_legacy`）调用的 `window.eyeProtect.m` | 必须在 `EyeProtectApi` 上 |

`src/preload/emergency.ts` 是紧急页最小桥，**不在**本契约范围。

新增 IPC 时：先扩展 `EyeProtectApi` → preload invoke/on → main `handleIpc` / broadcast，再让本测试变绿。

## 使用约束

1. 活跃 UI **不得**依赖已删除的遗留 renderer/脚本路径；用户可见写操作须走命令层 `run`。
2. 改 `taskStore` schema / 备份时，必须保持旧域导出与恢复路径，或同步删除对应兼容测试并更新本文。
3. 新文档与新 smoke 只描述 `package.json` 中真实存在的命令；`scripts/legacy/**` 不进 CI。
4. 新增用户可见写 IPC 时：扩展 API/preload/handleIpc，并在活跃 UI 用 `run`/`useCommand` 包装；`verify:product` 与 `ipc-contract` 测试会拦截漂移。
5. UI 契约（`verify:ui-contract`、design-system/modal 测试）只约束**活跃**视图与样式路径。
