# EyeProtect 2.0 架构

2.0 的主程序为 Tauri 2 + Rust：`src-tauri/src/lib.rs` 装配应用，`state.rs` 拥有共享状态与心跳，`scheduler.rs`、`task_reminders.rs`、`tasks.rs`、`pomodoro.rs` 和 `hydration.rs` 分别负责休息、待办提醒、任务、番茄钟和喝水。`windows.rs` 管理窗口，`commands.rs` 和 `src/renderer/src/lib/tauriBridge.ts` 连接复用的 React 工作台。当前数据格式、已知差异和验证入口见 [Tauri 架构与迁移记录](tauri-migration.md)。

Electron 1.x 不再维护。下面保留的是 1.x 设计与兼容资料；其中主进程、IPC、调度、数据迁移、打包和应急兜底描述不代表 2.0 实现。产品仍以待办、完成记录、设置、桌宠、休息与番茄钟为主。

## Electron 1.x 历史资料

## 活跃执行链

- 主进程：`src/main/index.ts` 负责单实例、托盘、安全 IPC、窗口、系统生命周期及服务绑定。
- `ReminderScheduler` 管理护眼/走动间隔与休息动作；`SchedulerKernel` 是唯一计时队列，处理 wall/elapsed 时钟、休眠和系统时间变化。
- `PomodoroService` 管理可选关联任务的桌面计时。旧 FocusRuntime、FocusSessionService、TaskWorkTracker 和 StandaloneReminderService 不在新版启动流程中实例化。
- `TaskService`/`TaskStore` 管理主任务、步骤、清单、完成及撤销；`TaskScheduler` 仅为可写清单中的未完成主任务注册单次提醒。旧的待发送独立提醒、时间盒和步骤通知在启动时停用。
- Renderer 通过 sandboxed preload 的 `window.eyeProtect` 访问主进程；任务使用增量推送，桌宠仅订阅轻量数据。

## 界面

`WorkbenchView` 仅展示待办、完成记录和设置；导航权威为 `workbenchNavigation.ts`。顶部筛选清单，任务原地展开，一次展开一项。日程、看板、规划、独立专注、复盘和养成页不再加载。

完成记录顶部的 `RestCompanionCard` 展示本周完成休息次数、周一到周日的小图和一句鼓励。`ReminderHistoryStore.getRestCompanion` → `reminder:companion` / `reminder:companion-changed` 是精简只读接口，不暴露分数、完成率、跳过次数或周际比较。测试提醒不进入个人记录；关闭记录停止新增，已有记录仍参与备份。跨日/跨周通过页面日期变化及重新聚焦刷新。

`SimpleSettings` 只展示休息、外观、应用三组。旧资料入口只读展示旧规则和历史资料，并允许恢复归档项目/任务；完整原数据通过备份保存。恢复走 `task:restore-legacy` → `TaskService.restoreTask`：这是唯一允许把任务迁出 completed/archived 清单的限定权限事务（步骤随根任务一起迁回默认清单），普通编辑的只读保护不受影响。

`BubbleView` 复用同一个窗口显示手选待办、番茄钟设置或计时。优先级为健康提醒 > 番茄钟 > 手选待办。遮罩健康提醒使用独立 Alert 窗口；原主界面故障时，Emergency HTML 和原生通知继续兜底。

当前主流程统一使用休息遮罩（主进程 effective mode 为 focused），设置页没有放松模式或提醒方式三选。`reminderModes.ts` 的 gentle/guided 映射保留供兼容纯函数使用，不代表当前 UI。

Alert 窗口采用一眼读完的离屏引导：一条稳定的大字建议、当班伙伴、较弱的倒计时，以及稍后/跳过出口。建议由主进程选择并保存在 activityIds，避开近期重复；没有光球追踪或放松模式选择。真正显示 primary/emergency 后主进程 beginRest 开始计时并暂停专注，SchedulerKernel 在 unlockAt 后保留 2.5 秒结束反馈，再自动记录完成与收起。notification/none 不启动看不见的休息；测试提醒不进入休息记录。文案阶段与美术步骤从 restViewModel 派生，renderer 不掌握倒计时。

桌宠右键菜单开启自由专注；任务行可以关联主任务启动。petCompanions.ts 是伙伴身份与文案的唯一来源：fighter（用户原作火力奋斗猫 GIF）、otter（水獭）、penguin（企鹅）、pixel（旧像素猫）与 custom（用户自定义）。原作四个 GIF 保存在 public/assets/pets/fighter，随包分发；不依赖 data/custom-pet。自定义文件夹有素材时才显示选择卡片。

像素猫仍提供 classic/coffee/explorer/stargazer 四套免费装扮，选择 pixel 后显示衣橱。其他伙伴使用独立轮廓、画风和动作，不通过像素猫换色生成。CompanionArtwork 统一桌面、休息界面与陪伴卡片的角色；IllustratedPet 使用平滑 SVG，GIF 保留原文件。新装不再用像素猫兜底替代用户原作。

`useAnimalFrame` 只推进矢量/像素美术帧，不参与业务计时。pet:reaction 只向桌宠推送一次性事件，完成任务、专注、休息预告有回应。动画关闭、页面隐藏或系统减少动态效果时停止美术帧；PetImage 对 GIF 也采取静态快照。提醒 bounds 基于 Electron 已完成 DPI 换算的 workArea，默认随屏幕增长，极小屏不越界。restReadingScale 清洗在 0.9–1.5，扩大提醒 bounds 与字号，并用工作台局部 CSS zoom 调整阅读大小；不使用同源传播的 Electron 页面 zoom，以免改变桌宠和气泡几何。桌宠原作/插画基准 200 DIP、像素版 160 DIP，再乘 petScale。

## 自启与提醒时机

Windows 自启通过 `syncStartupShortcut` 写入当前用户 Startup 目录的 `EyeProtect.lnk`，安装版指向实际 exe，portable 指向外层启动 exe，不需要 `setLoginItemSettings`。只在 packaged 模式生效，默认关闭。保存自启偏好前先检查快捷方式操作，失败不提交设置；设置写盘失败时恢复此前的自启选择。启动时同步失败会写诊断并提示，休息服务继续工作；smoke 不触碰真实 Startup 目录。

`ReminderContextMonitor` 接入 `ReminderScheduler.beforeReminder`，定时勿扰使用本地时间；全屏勿扰与“智能选择提醒时机”分别控制。智能检测默认关闭，开启后检测前台 Zoom / Teams / 腾讯会议 / Webex、已有本机白名单、摄像头/麦克风使用标记，以及最近 5 秒至少 6 次键入的输入高峰。输入等到约 3 秒停顿（每 2 秒复查），会议/设备/全屏每 10 秒复查，定时勿扰每 30 秒复查；这些保护持续到场景解除，不在三次延后后强弹。手动立即休息和测试提醒绕过自动检测，预告同样尊重保护。

Windows 检测使用一个隐藏 PowerShell/C# 子进程：`GetForegroundWindow`、窗口与显示器边界、`GetAsyncKeyState` 的按下状态和当前用户 ConsentStore。只保留内存中的按键总数/停顿时长、进程名和布尔状态，不收集文字、窗口标题、音视频内容。单独开启全屏勿扰不采集键入或设备状态。ConsentStore 不是稳定公开的设备占用 API，可能漏检浏览器会议、权限受限应用或新 Windows 版本；前台会议应用规则也可能涵盖聊天界面。关闭相关开关、锁屏、休眠与退出时停止检测；故障写日志、丢弃过期采样并回退原提醒节奏，最多每分钟重试。

## 数据与迁移

数据库 v5 为任务新增 `due_date`，对外字段 `dueDate` 为有效 `YYYY-MM-DD` 或 null。升级前 checkpoint WAL 并复制原数据库及旁文件；新增列和日期转换在同一事务完成，5001 标记防止重复转换。迁移失败进入只读恢复模式。旧 `dueAt` 保留，日常分组不再读取它；新日期被清空后不会复活旧日期。旧 `dueAt` / `plannedAt` 只作兼容留存：活跃工作台不读取它们分组，也不展示；界面可编辑的只有 `dueDate` 与 `reminderAt`。

主任务 `parentId=null`。新步骤通过 `task:create-step` 创建，父级必须是未完成主任务。旧多层关系只在展示时按既有顺序平铺，不重写关系。清单复用 Project ID，active/onHold 可用，completed/archived 仅在旧资料和完成历史中显示。

`task:complete-tree` 接收主任务及所有待完成步骤的 revision 映射。主进程在事务中验证集合与版本、完成并记录撤销快照。事务提交前不向 renderer 发送增量事件，回滚不泄漏部分状态。撤销保留此前已经完成的步骤。

重复生成在生产 TaskService 中关闭，包括 set-status 和 update-status 两条路径；旧规则字段保留。数据库 schema 为 v5；备份格式当前为 **v8**（`src/main/backup.ts` 的 `version: 8`）。导入旧版本时转换日期；显式 null 不回退旧日期。旧规划、时间块、步骤层级、提醒和专注表继续参与导出/恢复。

## 番茄钟

`pomodoro:prepare` 进入气泡设置阶段；`pomodoro:start` 接收可空任务 ID、分钟数和替换确认。状态阶段为 idle、ready、focus、break、focus-finished、break-finished，另有 running、remainingMs 和 revision。

服务不自行持有第二套倒计时：运行中的剩余时间由 `SchedulerKernel` 的阶段结束期限推导（`kernel.remainingMs('pomodoro', 'pomodoro-end')`），与 Kernel 用同一条 elapsed 时钟。键入闲置会冻结 Kernel 的 elapsed 时钟，番茄钟随之继承该语义——闲置期间倒计时停走，恢复输入后按真实活跃时间继续；只有 elapsed 期限享受冻结，wall 期限不受影响。`pomodoro-state.json` 原子写入成功后才发布状态和注册新期限。renderer 仅插值显示，不能自行完成计时。锁屏/休眠/退出暂停；重启一律恢复为暂停，失效关联任务使计时结束。

健康提醒在可操作窗口真正显示后自动开始并暂停专注；休息结束不恢复番茄钟，必须手动继续。专注到点或短休息与健康提醒重叠时，开始健康休息合并为一次展示，采用较长的剩余休息时长。单独短休息不会记录健康完成；自动完成只属于确实开始的健康休息。

## 喝水

喝水**不是**第四种提醒：`ReminderKind` 仍是 eye/walk/combined，`HydrationService` 不注册 Kernel 期限、不打开 Alert、不写休息记录，只读复用 `ReminderContextMonitor.decision()`，所以不可能改动或重置护眼/走动日程。节拍是派生的：`interval = clamp(floor((workEnd-workStart)/goal), 30, 120)` 分钟，slot 为 `workStart + k*interval` 且不晚于 `workEnd`，因此设置项只有开关与每日目标（默认开启、8 杯）。首个 slot 不早于「工作开始 + 一个间隔」。**取 floor 而不是 round**：取整向上会让 slot 数少于目标（840min 窗口下 13/16/18/19/20 杯曾经永远到不了），floor 保证 1–20 每个目标都排得出 ≥ 目标数的 slot（AC-16）。间隔以「上一次提示所属的 slot」为基准，回应提示所得的杯记在该 slot 时刻（B4），所以用户晚几秒点「记一杯」不会把节拍往后推、更不会吃掉下一个 slot。chip 分母与「够了」一律用配置目标本身，不引入「有效目标」。

状态在 `hydration-state.json`（`.tmp` + rename 原子写，不进备份）：`localDate`、`cups`、`lastCupAt`、`lastPromptAt`。跨天读取时惰性清零。计时权威在主进程：`sipping` 2.6s → `strip` 8s 由服务自己收起，renderer 只按 `endsAt` 画进度；`petMotion` 关闭时跳过 `sipping` 直接出条，记录路径完全一致。`tick()` 的每个分支（关闭、已达标、刚记过、`gate` 延后、界面被占用）都会写入 `lastPromptAt` 再重排——间隔被消费而不是排队，所以唤醒或解除勿扰后不会补发。`tick(now, slotAt)` 区分「这个 slot 计划在什么时候」与「回调实际跑到什么时候」：`lastPromptAt` 的记账、`recordCup` 的归属、以及「刚记过」的比较全部按 `slotAt`，定时器迟到 3s 不会把 slot 网格往后推（真实 `setTimeout` 从不准时，按 `now` 记账会让后一个 slot 与上一杯只差 `interval - 迟到`，于是每两个 slot 被吃掉一个，默认 8 杯实际只能记 4 杯）；重复触发的判据是 `slotAt <= lastPromptAt || now <= lastPromptAt`，后一项同时兜住时钟回拨。休眠/锁屏清定时器，恢复只 `arm()` 不 `tick()`；`recordCup` 上限为目标杯数并立即收起，`dismissHydrationPrompt` 只收起不记杯。`hydration:get` / `hydration:record` / `hydration:dismiss`，广播 `hydration:changed` 到桌宠、气泡与工作台；杯子动作沿用 `pet:reaction`（值 `sip`），不新增通道。气泡与桌宠两处显示共用 `src/shared/bubbleSurface.ts` 的 `resolveBubbleSurface`（`prealert > gentle > pomodoro > hydration > todo`，只有 `strip` 阶段占用气泡），主进程据此决定窗口尺寸、渲染端据此决定挂哪个组件，避免两套优先级各自漂移。条子保留 `.bubble-card` 以让高度上报继续生效，尺寸只是默认值。桌宠窗口不因杯数 chip 变大：chip 在窗口内底部、`pointer-events:none`，点击仍落在拖拽面上；`prompt != null` 期间单击桌宠等于「记一杯」（被更高优先级表面挤走时也不会丢失记录路径）。像素猫画出玻璃杯并按帧降三级水位（`sipWaterLevel`，12 帧 × 216ms ≈ 2.6s），`petMotion` 关闭时为静态举杯；GIF 与自定义动图无杯可画，降级为一次通用反应，条子文案、`记一杯`、计数与跨天重置不受影响。`hydration.test.ts` 用注入的 `now` 与假定时器覆盖派生间隔、slot 边界、跨天/勿扰/达标/刚记过、只 arm 不 tick 与损坏状态回退；`bubble-surface.test.ts` 覆盖五级优先级与 key 变化；`sipWaterLevel` 与 `fighterArtwork('sip')` 在 `pet-companions` / `pet-themes` 中断言。

## 窗口、安全与测试

气泡观察卡片自然高度，通过仅限真实 Bubble WebContents 的 `window:bubble:height` 上报。桌宠用同样的发送方限制上报 SVG 可见轮廓；主进程计算上下避让与尾巴位置，每次拖动都同步更新气泡并重申固定桌宠尺寸。

Emergency preload 只提供绑定当前提醒的动作和只读倒计时状态，不暴露一般应用 API 或由页面指定提醒 ID。

`simple-experience.test.ts` 覆盖迁移、日期/DST、备份、原子完成及回滚；`pomodoro.test.ts` 覆盖时钟、暂停恢复、休息和结束阶段。保留旧存储/备份测试作为兼容验证。当前打包验收使用 `smoke-simple-experience.mjs`、`smoke-simple-pet-failure.mjs`、`smoke-pet-ui.mjs` 与 `smoke-companion-experience.mjs`，分别覆盖工作流程、桌宠失败、像素衣橱与多角色/阅读大小。

## 遗留面清单

产品已收敛为待办 / 完成记录 / 设置 + 桌宠 / 气泡 / 休息遮罩 / 番茄钟。上一代工作台的 renderer 代码（旧设置视图、`NumberField`、`SideSheet`、`lib/time.ts`、`styles/settings.css` 及其孤儿 CSS）已全部删除；仍在的是主进程数据域（规划 / 时间块 / 专注 / 检查点表）与 `data:legacy` / 备份 v8 的只读兼容面，以及尚未删除的 IPC/测试面。

**文档权威**：`CLAUDE.md` 与本文描述当前产品；`AGENTS.md` 应与本文对齐。修改遗留面前先确认目标是「兼容路径」还是「活跃 UI」。

### 活跃路径（默认改动落点）

| 层 | 位置 |
| --- | --- |
| 启动装配 | `src/main/index.ts`：`ReminderScheduler`、`SchedulerKernel`、`TaskService(store, false)`、`TaskScheduler`、`PomodoroService` |
| 工作台 UI | `WorkbenchView.tsx` + `workbenchNavigation.ts`（仅 today/review/settings）+ `SimpleSettings.tsx` |
| 其它窗口 UI | `PetView.tsx`、`BubbleView.tsx`、`AlertView.tsx` |
| 样式 | `styles/simple.css`（工作台）、`styles.css` + `styles/theme.css`（桌宠/气泡/提醒） |
| CI smoke | `scripts/smoke-simple-experience.mjs`、`scripts/smoke-simple-pet-failure.mjs`、`scripts/smoke-pet-ui.mjs`、`scripts/smoke-companion-experience.mjs` |

### 冗余清理轮次（死代码与半死 IPC）

对全仓做过一次引用盘点后，删除了以下**生产 0 引用**的面（删除时三端/契约同步）：

| 删除对象 | 原因 |
| --- | --- |
| `src/shared/dailyPlanning.ts`（+ 测试） | 每日规划域纯函数，仅测试存活；保留名单外 |
| `src/shared/projectSections.ts`（+ 测试） | 仅测试存活；`project_sections` 写 CRUD 生产 0 调用 |
| `src/renderer/src/features/tasks/taskWorkInterpolation.ts`（+ 测试） | 仅测试存活，不属保留名单 |
| `src/renderer/src/components/primitives/`（6 文件） | 上代组件框架残留，barrel 无 importers |
| `src/renderer/src/styles/workbench.css`、`base.css` 的 `.visually-hidden`、`styles.css` 的 `.workbench-v2 *` | 旧工作台样式；唯二引用来自已删的 NavItem |
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

**历史休息卡验收**：`2827ae3` 曾对齐视线光球、环标签与手动打卡流程。1.9 的离屏休息已取代该交互；当前 packaged smoke 验证无点击开始、稳定的大字建议、自动结束及休息记录，不再选择模式或手动打卡。

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
| Reminder history（`ReminderHistoryStore`） | 完成记录的轻量本周小卡；backup 导出/恢复 | scheduler 写事件；backup `replaceEvents`；retention | 活跃留痕与正向反馈；不开放完整 weekly/care 报表或评分 |
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

- **权威（package.json / CI）**：`scripts/verify-build-contract.mjs`、`verify-ui-contract.mjs`、`smoke-simple-experience.mjs`、`smoke-simple-pet-failure.mjs`、`smoke-pet-ui.mjs`、`smoke-companion-experience.mjs`、`build-app-icon.mjs`
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

### 项目审计修复轮（2026-09-22，`artifacts/project-audit-2026-09-22/report.md`）

按报告顺序修完可验证问题，每项先补复现测试再改实现：

| 项 | 修复 | 回归 |
| --- | --- | --- |
| F01 撤销恢复顺序 | `undoOperation` 改两阶段关系写入（先插全部行、再按父先子后重连 `parent_id`，与 `replaceAll` 一致）；快照顺序不再决定成败 | `tests/task-undo-restore.test.ts` |
| F03 撤销丢从属资料 | `deleteTaskTreeWithSnapshot` 在删除的同一事务内、级联发生前捕获 `work_sessions` / `daily_task_plans` / `time_blocks` / `focus_sessions` / `task_checkpoints` / `task_work_state`，撤销按依赖顺序恢复（任务 → 时间块 → 专注会话 → 检查点） | 同上 |
| F04 恢复迁不出只读清单 | `task:restore-legacy` 改调 `TaskService.restoreTask`：一个限定权限的事务，是唯一允许把任务迁出 completed/archived 清单的位置；步骤随根任务一起迁。普通 `updateTask` / `setTaskStatus` 的只读保护不变 | 同上 |
| F02 番茄钟与 Kernel 时间基准 | `SchedulerKernel.registered()` 在 elapsed 冻结期把新期限锚定到冻结时刻（而非实时单调钟），`resumeElapsed()` 统一平移；`PomodoroService.getState()` 改为从 Kernel 的阶段结束期限推导剩余时间，冻结期不再双基准漂移。产品语义：**番茄钟继承输入的闲置冻结** | `tests/pomodoro.test.ts`、`tests/scheduler-kernel.test.ts` |
| F05 双击提交丢结果 | `useCommand` 仅在有新意图（参数不同）时推进 generation；同参数加入在途请求不再让首个调用作废自己的结果 | `tests/use-command-hook.test.ts`（转译真实 Hook + 最小 Hook 运行时） |
| F06 提醒方式 | 三种模式均为真实策略，收敛到 `src/shared/reminderModes.ts`（`reminderSurfaceForMode` / `reminderDimsDesktopForMode` / `reminderEnforcesRestWait`），`windows.ts` 与 `reminders.ts` 只消费该模块；设置页三选项保留 | `tests/reminder-modes.test.ts` |
| F07 时钟跳变吃掉休息 | `handleWallClockDrift` 同步平移活跃提醒的 `restStartedAt`，休息窗口（`unlockAt - restStartedAt`）与活动进度不被跳变放大 | `tests/reminders.test.ts` |
| F08 冗余写入与空广播 | `updateTask` 只在清单**真的变化**时同步步骤，且只写 projectId 确实不同的步骤；`TaskService` 删除无消费者的 `tasks-changed` 全量推送（生产只消费 `task-upserted` / `task-removed` / `tasks-replaced` 增量与 bulk 通道） | `tests/task-service.test.ts` |

**死代码清理（0 引用 + 专属契约同步删）**：`components/NumberField.tsx`、`components/SideSheet.tsx`、`lib/time.ts`、`styles/settings.css`，以及 `styles.css` 的旧设置页选择器（`.settings-shell` / `.status-item` / `.number-*` / `.switch-row` / `.mode-card*` / `.custom-pause` / `.meeting-end-pause` / `.test-actions` / `.settings-footer`）和 `primitives.css` 的 `.ui-side-sheet*` / `@keyframes ui-sheet-enter`；`modal-keyboard-contract` / `workbench-navigation` / `verify-ui-contract` / `smoke-simple-experience` 中针对上述文件的断言一并移除。

**事件契约**：任务写入后 renderer 的刷新只来自增量事件（单条 `task-upserted` / `task-removed`）与 bulk 事件（撤销、备份导入、旧资料迁移的 `tasks-replaced`）；恢复模式启动时 `publishApplicationState` 仍做一次全量广播。`windows.broadcastTasks` 发送 IPC `task:changed`（`preload.onTasksChanged` → `useTasks` 全量 hydrate），仅服务 bulk 场景。

## 使用约束

1. 活跃 UI **不得**依赖已删除的遗留 renderer/脚本路径；用户可见写操作须走命令层 `run`。
2. 改 `taskStore` schema / 备份时，必须保持旧域导出与恢复路径，或同步删除对应兼容测试并更新本文。
3. 新文档与新 smoke 只描述 `package.json` 中真实存在的命令；`scripts/legacy/**` 不进 CI。
4. 新增用户可见写 IPC 时：扩展 API/preload/handleIpc，并在活跃 UI 用 `run`/`useCommand` 包装；`verify:product` 与 `ipc-contract` 测试会拦截漂移。
5. UI 契约（`verify:ui-contract`、design-system/modal 测试）只约束**活跃**视图与样式路径。
