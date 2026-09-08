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

`PetView` 的时钟按钮开启自由专注；任务行可以关联主任务启动。像素动物或既有角色使用统一入口渲染，不再生成每日访客或展示养成分数。

## 数据与迁移

数据库 v5 为任务新增 `due_date`，对外字段 `dueDate` 为有效 `YYYY-MM-DD` 或 null。升级前 checkpoint WAL 并复制原数据库及旁文件；新增列和日期转换在同一事务完成，5001 标记防止重复转换。迁移失败进入只读恢复模式。旧 `dueAt` 保留，日常分组不再读取它；新日期被清空后不会复活旧日期。

主任务 `parentId=null`。新步骤通过 `task:create-step` 创建，父级必须是未完成主任务。旧多层关系只在展示时按既有顺序平铺，不重写关系。清单复用 Project ID，active/onHold 可用，completed/archived 仅在旧资料和完成历史中显示。

`task:complete-tree` 接收主任务及所有待完成步骤的 revision 映射。主进程在事务中验证集合与版本、完成并记录撤销快照。事务提交前不向 renderer 发送增量事件，回滚不泄漏部分状态。撤销保留此前已经完成的步骤。

重复生成在生产 TaskService 中关闭，包括 set-status 和 update-status 两条路径；旧规则字段保留。备份版本为 v7，导入 v1–v6 时转换旧日期，v7 显式 null 不回退。旧规划、时间块、步骤层级、提醒和专注表继续参与导出/恢复。

## 番茄钟

`pomodoro:prepare` 进入气泡设置阶段；`pomodoro:start` 接收可空任务 ID、分钟数和替换确认。状态阶段为 idle、ready、focus、break、focus-finished、break-finished，另有 running、remainingMs 和 revision。

服务用单调时钟计算剩余时间，并向 Kernel 注册结束与 10 秒检查点。`pomodoro-state.json` 原子写入成功后才发布状态和注册新期限。renderer 仅插值显示，不能自行完成计时。锁屏/休眠/退出暂停；重启一律恢复为暂停，失效关联任务使计时结束。

健康提醒初次出现时不自动暂停专注；`reminder:begin-rest` 才启动实际休息并暂停 focus。休息结束不恢复番茄钟，必须手动继续。专注到点或短休息与健康提醒重叠时，开始健康休息会合并为一次展示，使用健康时长与短休息剩余时长的较大值；结束短休息绝不自动记录护眼或走动完成。

## 窗口、安全与测试

气泡观察卡片自然高度，通过仅限真实 Bubble WebContents 的 `window:bubble:height` 上报。桌宠用同样的发送方限制上报 SVG 可见轮廓；主进程计算上下避让与尾巴位置，每次拖动都同步更新气泡并重申固定桌宠尺寸。

Emergency preload 只提供绑定当前提醒的动作和只读倒计时状态，不暴露一般应用 API 或由页面指定提醒 ID。

`simple-experience.test.ts` 覆盖迁移、日期/DST、备份、原子完成及回滚；`pomodoro.test.ts` 覆盖时钟、暂停恢复、休息和结束阶段。保留旧存储/备份测试作为兼容验证。`smoke-simple-experience.mjs` 与 `smoke-simple-pet-failure.mjs` 是当前打包验收入口；旧 UI 专项脚本不再用于当前 CI。
