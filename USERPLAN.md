## 核心结论

我按仓库当前已经发布 **1.0.0** 的事实，把你说的“第一点一个版本”理解为 **EyeProtect v1.1.0** 来规划。当前版本已经不是一个简单 demo：Electron 主进程中已经有 deadline-driven 提醒调度、休眠/唤醒恢复、运行状态落盘、三种提醒模式、场景感知、历史统计、桌宠、多显示器和一套测试。

但我认为现在确实到了一个需要“重新定产品边界”的节点。**v1.1 不应该继续在现有 344×496 小面板里堆功能，也不应该推翻现有提醒系统重写。最优路线是保留已经验证过的调度基础，重构出三个真正独立的产品层：**

> **EyeProtect v1.1 = Rhythm Engine（可靠提醒内核） + Task Core（完整个人任务系统） + Workbench（正式桌面工作台）**

最终定位不是“护眼桌宠 + Todo List”，而是：

> **一个 local-first 的个人工作节奏助手：管理“我要做什么”，也管理“我什么时候应该离开电脑”。**

这也是 EyeProtect 最有机会形成辨识度的地方。Super Productivity 已证明“本地任务 + 工作节奏 + break reminder”这个组合成立，它已经将项目、子任务、标签、timeboxing 和休息提醒放在同一工作循环里；但 EyeProtect 不需要复制它庞大的时间追踪和第三方集成，而应把“健康节奏”做得更强。([GitHub][1])

---

# 一、我对当前 1.0 的审查：真正应该先解决什么

你现在觉得“提醒不够稳定、UI 不够漂亮、任务列表太简单”，这三个感觉背后并不是三个孤立问题，而分别对应 **系统可靠性、信息架构、领域模型** 三个根因。

### 1. 提醒系统基础不错，但还没有达到“提醒绝不能丢”的级别

现在的 `ReminderScheduler` 有几个设计是对的：主进程持有 deadline，不依赖 Renderer；使用单个最近截止时间的 `setTimeout`，而不是每秒轮询；暂停保存剩余时间；休眠和解锁通过 `powerMonitor` 做重新协调；状态会写到 `runtime-state.json`。

因此我**不建议重写这一部分**。

但我找到几个 v1.1 必须列为 P0 的问题。

| 问题                                 | 当前行为                               |   风险等级 | v1.1 处理                    |
| ---------------------------------- | ---------------------------------- | -----: | -------------------------- |
| Alert Renderer 创建失败                | `ensureAlertWindow()` 只记录错误并返回     | **P0** | Emergency Surface fallback |
| Renderer 运行中崩溃                     | 没有提醒窗口自动恢复链路                       | **P0** | `render-process-gone` 恢复   |
| Alarm 和护眼是两套调度器                    | `AlarmClock` 自己持有 timers           | **P0** | 共用 SchedulerKernel         |
| Alarm 不参与 suspend/resume reconcile | powerMonitor 只调用 ReminderScheduler | **P0** | 所有 deadline 统一 reconcile   |
| Active Reminder 不落盘                | Snapshot 只保存 nextAt/pause/snooze 等 | **P1** | 持久化 active reminder        |
| 系统时间突然改变                           | 主要依赖已经 arm 的 setTimeout            | **P1** | monotonic clock + watchdog |
| packaged diagnostics 太弱            | 主要是 5 分钟 CPU/内存统计，而且正式版默认关闭        | **P1** | reminder event trace       |

其中第一个问题尤其严重。

在 guided/focused 模式下，代码会先隐藏桌宠，然后创建 AlertWindow；但如果 `loadRenderer()` 失败，当前实现只是 console error、销毁窗口并退出创建流程，而 Scheduler 里的 `activeReminder` 仍然存在。结果就是理论上可能出现：

**提醒已经进入 active → 桌宠隐藏 → AlertWindow 没出来 → 用户实际上什么都看不到。**

这类问题就是“功能看起来都实现了，但用户偶尔会觉得提醒没弹”的典型根因。

### 2. Alarm 现在不应该继续作为另一套 Scheduler

现在护眼/走动由 `ReminderScheduler` 管，而闹钟由 `AlarmClock` 各自创建 `setTimeout`。`powerMonitor.resume`、`unlock-screen` 等生命周期协调却只处理前者。

这一点在现在只有简单闹钟时还能接受。

但一旦 v1.1 加：

* Task due reminder
* recurring task
* scheduled task
* standalone alarm
* eye reminder
* walk reminder
* pause expiration

继续六七套逻辑会迅速失控。

所以 v1.1 必须抽出：

```text
SchedulerKernel
    │
    ├── BreakService
    │     ├── Eye Cycle
    │     └── Walk Cycle
    │
    ├── TaskReminderService
    │
    ├── StandaloneReminderService
    │
    └── Pause / Resume
```

**Kernel 只解决“什么时候应该醒”和“醒来后哪些事件到期”；业务服务决定“这个事件到期以后应该怎么办”。**

这是 v1.1 最大的一次底层改造。

### 3. Runtime persistence 还没有覆盖“正在发生的提醒”

当前 `ReminderSnapshot` 只有：

`nextEyeAt / nextWalkAt / pausedUntil / snoozeCount / frozenEyeMs / frozenWalkMs`。

正在展示的 `ActiveReminder`、当前 activity、`unlockAt`、scene deferral 等并没有恢复。

因此如果程序正处于 focused 30 秒休息阶段时崩溃，重启以后不是严格恢复这个 Reminder Session，而是根据旧 deadline 重新推断。

v1.1 应持久化：

```ts
interface PersistedBreakSession {
  id: string
  kind: ReminderKind
  scheduledAt: number
  startedAt: number
  unlockAt: number
  snoozeAllowedAt: number
  mode: ReminderMode
  activityIds: string[]
  snoozeCount: number
}
```

重启后：

```text
仍然有效
  → 恢复原 session

已经过去太久
  → 根据 idle / elapsed 做 reconcile

检测到长时间离开
  → natural-break，不再补弹
```

而不是重新开始倒计时。

---

# 二、任务系统需要从 Todo List 升级成真正的 Task Core

这里是目前差距最大的一块。

现在的 `TodoItem` 实际只有：

`text + completed + priority + context + remindOnBreak`。

UI 支持添加、完成、双击编辑、点优先级圆点循环、删除，以及“下次走动时提醒”。

这作为桌宠旁边的小 Todo 很合适，但无法承担长期任务管理。

Todoist 的成熟任务详情模型已经把 `date`、`deadline`、priority、labels、subtasks、description、reminders 等看成不同字段，而不是全部压进一个字符串。特别值得 EyeProtect 学的是 **“什么时候准备做”和“真正截止时间”是两个概念**。([Todoist][2])

### v1.1 推荐的数据模型

我建议任务至少升级为：

```ts
interface Task {
  id: string

  title: string
  notes: string | null

  status: 'inbox' | 'active' | 'done' | 'archived'
  priority: 'normal' | 'important' | 'urgent'

  projectId: string | null
  parentId: string | null
  tags: string[]

  // 计划何时处理
  plannedAt: number | null

  // 真正的硬截止时间
  dueAt: number | null

  reminderAt: number | null

  recurrence: RecurrenceRule | null

  context: 'desk' | 'away' | 'any'
  remindOnBreak: boolean

  estimateMinutes: number | null
  sortOrder: number

  createdAt: number
  updatedAt: number
  completedAt: number | null
}
```

其中有四个字段我认为非常重要。

**`plannedAt !== dueAt`**

例如：

> 周五交论文
> 周三晚上准备写

那么：

```text
plannedAt = 周三
dueAt     = 周五
```

如果把它们混成一个时间字段，Today、Upcoming、Overdue 很快都会出现语义混乱。

**`parentId`**

没有子任务的话，“写论文”下面的：

* 整理实验结果
* 补图
* 校对
* 提交

只能变成四条毫无关系的任务。

**`recurrence`**

v1.1 不需要一开始支持完整自然语言 RRULE，但必须支持：

```ts
type RecurrenceRule =
  | { type: 'daily'; interval: number }
  | { type: 'weekly'; interval: number; weekdays: number[] }
  | { type: 'monthly'; interval: number; day: number }
  | { type: 'after-completion'; days: number }
```

而且“固定星期一”与“完成后七天再提醒”必须分开。成熟任务系统对 recurring task 的处理已经证明这里有大量边界条件，例如重复父任务完成以后子任务是否重新出现，都需要明确语义。([Todoist][3])

**`context`**

这是 EyeProtect 不应该丢掉、反而应该强化的独有字段。

例如：

```text
desk
  写文档
  回邮件

away
  接水
  拿快递
  打印文件
  找同事

any
  打电话
```

然后 Walk Reminder 就能从 `away` 中主动选一件：

> 该站起来走动了。
> 顺便把「去前台拿快递」做掉？

这比单纯复制 Todoist 更有产品价值。

---

# 三、UI 不应该继续以“桌宠浮窗”作为整个应用的容器

这一点我认为是当前视觉体验的最大结构性问题。

现在任务/闹钟面板固定为 **344×496**，frameless、always-on-top，并在失焦后根据 dirty 状态决定是否自动关闭。

这种设计是一个优秀的 **Quick Panel**。

但绝对不是一个好的 Task Manager。

所以不要再把：

* 日历
* 项目
* 标签
* 子任务
* 日期
* 重复任务

继续往这个窗口里面塞。

### v1.1 应形成四层 UI

| 层级        | 用途                               | 窗口形态              |
| --------- | -------------------------------- | ----------------- |
| Ambient   | 桌宠、身体状态、下一次休息                    | 当前 PetWindow      |
| Quick     | 快速添加、今日前三项、下一次休息                 | 当前 PanelWindow 改造 |
| Workbench | 正式管理 Tasks / Projects / Upcoming | **新 MainWindow**  |
| Attention | 护眼/走动提醒                          | Alert/Bubble      |

其中真正改变体验的是第三层。

我建议新增约 **1080×720 起步、可缩放、正常进入任务栏的 Workbench Window**：

```text
┌──────────────┬─────────────────────────────┬─────────────────┐
│ Today        │ 今天 · 8 月 9 日             │ Task Details    │
│ Inbox    4   │                             │                 │
│ Upcoming     │ ○ 修改论文                  │ 修改论文         │
│              │   今天 20:00       P1       │                 │
│ Projects     │                             │ Notes           │
│  ├ Research  │ ○ 回复邮件                  │ Planned         │
│  ├ Personal  │                             │ Deadline        │
│              │ ○ 买咖啡豆                  │ Repeat          │
│ Completed    │                             │ Tags            │
│              │                             │ Context         │
├──────────────┴─────────────────────────────┴─────────────────┤
│ 👁 12 min    ·    🚶 34 min    ·    当前节奏：正常           │
└──────────────────────────────────────────────────────────────┘
```

核心视图只做五个：

**Inbox / Today / Upcoming / Projects / Completed。**

先把这五个做透，不要第一版就做 Calendar、Kanban、Eisenhower、Habit、Gantt。

Super Productivity 值得借鉴的是 Projects/Subtasks/Tags 与 break reminder 在同一个工作流中；Todoist 值得借鉴的是 Task Detail 的信息层级。([GitHub][1]) ([Todoist][2])

### 视觉上也应该正式建立 Design System

你现在已经有 `tokens.css`，但 token 很少；与此同时主 `styles.css` 已经接近 40KB，并存在大量直接写死的颜色、尺寸、透明度和动画。

不建议为了“好看”突然换成一个巨大 UI 框架。

我更推荐：

```text
CSS Variables
      +
CSS Modules / feature-scoped CSS
      +
Lucide
      +
少量 headless primitives
```

建立：

```text
color
typography
spacing
radius
shadow
motion
z-index
focus
disabled
danger
success
priority
eye
walk
```

等完整 semantic token。

主工作台使用 Windows 上的 `Segoe UI Variable / Microsoft YaHei UI`；桌宠和提醒保持当前偏柔和、亲和的风格。

视觉语言建议定义为：

> **温和的桌面生产力工具，而不是儿童化桌宠，也不是企业 SaaS Dashboard。**

---

# 四、v1.1 最关键的技术路线

## A. 先做 SchedulerKernel，而不是先画新 UI

目标结构：

```text
src/main/
  scheduling/
    SchedulerKernel.ts
    EventQueue.ts
    Clock.ts
    Reconciler.ts

  breaks/
    BreakService.ts
    BreakPolicy.ts

  tasks/
    TaskService.ts
    TaskScheduler.ts
    RecurrenceEngine.ts

  notifications/
    ReminderSurfaceManager.ts

  persistence/
    database.ts
    migrations/
```

SchedulerKernel 用 **一个最小堆/priority queue** 管理所有 deadline：

```ts
interface ScheduledEvent {
  id: string
  owner: 'break' | 'task' | 'alarm' | 'system'
  type: string

  fireAt: number
  revision: number
}
```

仍然沿用当前优秀的模式：

> 最近 deadline → 一个 `setTimeout`

但再加一个低频 watchdog，例如 30 秒一次：

```text
exact timer
    +
wall clock / monotonic clock drift detection
    +
powerMonitor resume/unlock
    +
startup reconcile
```

这样平时还是近乎零成本，但如果 Windows 修改时间、时区同步、系统卡顿或 timer 异常，最多一个 watchdog 周期就会重新校准。

Electron 本身提供 suspend/resume 等 `powerMonitor` 生命周期事件，所以继续把这些系统事件集中在主进程处理是正确方向。([Electron][4])

而且建议把 Electron 33 升级到届时受支持的稳定线再发布 v1.1；Electron 在 2026 年仍然修过 Windows `PowerMonitor` 的底层生命周期问题，长期停留在 33 对“提醒稳定性优先”的程序并不理想。 ([Electron Releases][5])

---

## B. 引入真正的 Reminder Surface fallback

我建议所有提醒显示都变成：

```text
Scheduler
   ↓
ReminderSurfaceManager
   ↓
Primary Surface
   ↓ fail
Emergency Window
   ↓ fail
Native Notification
   ↓
Tray state
```

也就是说：

**即使漂亮的 React AlertWindow 崩了，提醒也不能跟着消失。**

Emergency Window 不需要图片、动画甚至复杂 CSS，只需要：

```text
EyeProtect

该休息一下了

[完成] [稍后] [跳过]
```

这才叫可靠性。

与此同时监听：

```ts
webContents.on('render-process-gone', ...)
app.on('child-process-gone', ...)
```

如果当前 Alert 的 Renderer 崩溃，立即切换 emergency surface。

当前的资源诊断主要统计 CPU、memory 和窗口数，正式版默认也不开；v1.1 应新增一个滚动的本地 `reminder-trace.log`，记录“计划 → gate → window create → shown → action → reschedule”。

以后用户再报告：

> “昨天下午护眼提醒似乎没弹。”

就能真正回答是：

```text
14:20 scheduled
14:20:00 due
14:20:00 scene-check
14:20:02 foreground=PowerPoint
14:20:02 deferred
14:25:02 reminder-created
14:25:02 renderer-ready
14:25:03 shown
```

而不是猜。

---

## C. Tasks 从 settings.json 迁移到 SQLite

当前 Todo 和 Alarm 都混在 `Settings` 中，每次 Todo mutation 最终都会重新写 `settings.json`。

十几个 Todo 没问题。

但加入：

* Projects
* recurring tasks
* subtasks
* tags
* order
* reminders
* history

以后继续 JSON 会越来越不适合。

因此 v1.1 我会直接切：

```text
settings.json
    → 只保存 preference

runtime-state.json
    → break runtime / recovery

eyeprotect.db
    → task/project/tag/reminder
```

SQLite 只允许 **Main Process** 访问，Renderer 继续通过 typed IPC。

推荐 schema：

```text
tasks
projects
tags
task_tags
task_reminders
scheduled_events
```

第一启动自动 migration：

```text
检测 settings.todos
      ↓
事务导入 SQLite
      ↓
校验数量/内容
      ↓
保留 legacy backup
      ↓
写 migration version
```

不要一次升级就删除旧数据字段，至少保留一个版本的 rollback 能力。

---

## D. 把 Alarm 迁入统一 Scheduler

现在 Alarm 的数据模型只有：

```text
hour
minute
once | daily
```

所以 `once` 实际也是“下一次出现这个时刻时响一次”，而不是现代任务软件里的完整 date/time reminder。

v1.1 建议将它改名为：

**Standalone Reminder**

支持：

```text
date + time
daily
weekly
weekdays
custom
```

而 Task 本身有自己的 `TaskReminder`。

两者最终都注册到同一个 SchedulerKernel。

这样：

```text
护眼
走动
Task reminder
Standalone reminder
Pause expiration
```

就拥有完全一致的 suspend/resume/restart/time-change 可靠性。

---

# 五、护眼部分具体应该向哪些成熟产品学习

我认为真正值得参考的不是它们长什么样，而是“提醒政策”。

| 产品                 | EyeProtect 应吸收的东西                                                       | 不应该照搬                           |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------- |
| Stretchly          | idle 自动暂停、长短休息区分、strict/manual finish、tray-first、成熟的多屏/休息行为             | 大量高级配置暴露给普通用户                   |
| Safe Eyes          | pre/post notification、smart pause、break exercise、多显示器、可扩展 break content | Linux-specific plugin 架构        |
| Super Productivity | Task 与 Break 在同一工作循环里，Projects/Subtasks/Tags，本地优先                       | time tracking、Jira/GitHub 等重型集成 |
| Todoist            | Inbox/Today/Upcoming、任务 Detail、date/deadline/reminder/subtask 清晰分离      | 账号、团队、协作、云平台                    |

Stretchly 已经把 idle detection、DND、manual finish、Strict 行为、多屏显示等做成成熟的 break policy；Safe Eyes 同样把智能暂停、break 前后通知和多屏作为核心功能。([GitHub][6])

因此 EyeProtect 最不应该做的是继续增加：

> “强制模式 4、强制模式 5、再多三个数字设置框”。

更值得做的是把规则变得自然：

```text
用户持续工作
      ↓
预提醒
      ↓
允许收尾
      ↓
正式休息
      ↓
检测真的离开电脑
      ↓
自动认为完成
      ↓
回来继续工作
```

它应当逐渐“消失在工作流里”，而不是一直要求用户操作这个软件。

---

# 六、任务和护眼真正融合的方式

这一块才是我最看好 EyeProtect 的产品差异。

例如用户今天有：

```text
P1  修改论文                 desk
P1  回复导师邮件             desk
P2  去打印室打印材料         away
P2  接一杯水                 away
```

当前正在做：

> 修改论文

工作 40 分钟以后：

```text
EyeProtect

已经持续工作一段时间了。
建议离开屏幕 2 分钟。

这次走动可以顺便：
「去打印室打印材料」

[开始休息]
```

休息回来：

```text
✓ 已休息 2 分钟
✓ 打印材料

继续：
修改论文
```

于是形成一个完整闭环：

> **Task → Work → Break → Away Task → Return → Task**

Super Productivity 已经证明 task 与 break timer 集成具有实际价值，但 EyeProtect 可以进一步把 break 与 `desk / away` 场景结合起来，这是当前代码里 `remindOnBreak` 已经萌芽出来的特色。([GitHub][1])

这是我认为 v1.1 最值得保留并强化的设计。

---

# 七、v1.1 实施顺序

我建议严格按下面顺序开发，而不是 UI 和功能一起乱改。

### Phase 1 — Reliability Foundation

首先冻结新功能。

完成：

1. SchedulerKernel。
2. Alarm 迁移统一 queue。
3. active reminder persistence。
4. renderer crash recovery。
5. Emergency Reminder Surface。
6. time-drift watchdog。
7. reminder event trace。
8. suspend/resume/time-change stress tests。

这一阶段结束后要做到一个很强的验收标准：

> **只要主进程还活着，就不存在“deadline 已到但没有任何用户可见提醒 surface”的状态。**

### Phase 2 — Task Core

然后再做：

1. SQLite migration。
2. 新 Task/Project model。
3. planned / deadline。
4. reminder。
5. recurring task。
6. subtasks。
7. tags。
8. manual ordering。
9. desk / away context。

旧 Todo 自动迁移。

### Phase 3 — Workbench

再建立 MainWindow：

```text
Inbox
Today
Upcoming
Projects
Completed
```

任务单击打开 Detail Panel。

旧 PanelWindow 收缩为：

```text
Today Top Tasks
Quick Add
Next Break
Pause
```

不再承担完整编辑。

Tray 左键也应该从当前“打开设置”改成：

> **打开 Today Workbench**

设置移动到 Workbench 的 Settings 页面。

### Phase 4 — Rhythm Integration

最后把两边真正连接：

```text
active task
away task suggestion
task reminder arbitration
break completion
natural break
care score
weekly rhythm summary
```

Task Reminder 与 Break 同时发生时，不应该两个窗口互相抢焦点。

建议统一策略：

```text
Break Alert 正在展示
    ↓
Task Reminder 到期
    ↓
普通任务 → native notification / queue
away task   → 可折叠进 Walk Reminder
    ↓
Break 完成后再恢复 Task surface
```

---

# 八、发布工程也应该随 v1.1 升级

当前只构建 Windows x64 **portable exe**。

对于早期工具没问题，但如果目标变成长期常驻、开机启动、可靠提醒，我建议 v1.1：

> **NSIS Installer 作为主发行版，portable 作为第二发行版。**

electron-builder 官方目前也把 NSIS 定位为 Windows 消费级应用的常见安装方式，并且支持 `electron-updater`；portable 明确属于 no-install/manual-update 场景。([Electron Builder][7])

这样获得：

```text
稳定安装路径
可靠开机启动
版本升级
卸载
未来代码签名
```

portable 继续保留给真正需要便携的人。

同时仓库目前已经有相当数量的 scheduler/todo/power/security tests，但从当前仓库树看不到 GitHub Actions workflow。

v1.1 应加 Windows CI：

```text
npm ci
→ typecheck
→ unit tests
→ build
→ NSIS package
→ packaged smoke test
```

而 Scheduler 最重要的是加一套 state-machine / scenario regression：

```text
deadline 前 1 秒休眠
deadline 后 1 秒唤醒
休眠 5 分钟
休眠 2 小时
锁屏
解锁
提醒过程中退出
提醒过程中 crash
系统时间 +2h
系统时间 -2h
eye + walk 同时到
task + walk 同时到
renderer crash
database migration failure
DST + recurrence
```

这些测试的价值远高于继续写普通组件 snapshot test。

---

# 最终的 v1.1 产品定义

如果让我直接定版，我会把 **EyeProtect 1.1.0** 的 Release Goal 写成：

> **将 EyeProtect 从“桌宠提醒工具”升级为可靠的本地工作节奏管理器。**
>
> 护眼与走动提醒具备可恢复、可观测、失败降级的可靠调度内核；任务系统支持 Inbox、Today、Upcoming、Projects、计划日期、截止日期、提醒、重复任务、子任务和标签；桌宠保留为 Ambient UI，快速面板用于 Capture，新 Workbench 用于完整任务管理；Task 与 Break 通过 desk/away context 和当前任务形成闭环。

其中优先级必须是：

**Reminder Reliability > Task Core > Workbench UX > 智能化/养成。**

当前的自适应、桌宠情绪、周报已经够用了。
v1.1 再继续增加“智能功能”反而不是最优投资。

另外，旧 `USERPLAN.md` 里曾明确写过“不建议完整任务/项目管理，以免失焦”，但你现在的产品目标已经发生改变，而且代码中的旧三阶段计划实际上也已经全部完成。 **因此 v1.1 最好直接重写 USERPLAN，而不是在旧路线图后面继续追加 P3/P4。**

还有一个说明：我这次完成了仓库源码级静态审查，也尝试把仓库拉到执行环境运行 `typecheck/test`，但执行容器无法解析 GitHub 网络地址，所以这里没有把现有测试“实际运行通过”作为结论。上述 P0 问题是从当前 `master` 源码控制流直接分析出来的，而不是假定测试失败。

**如果下一步进入实现，我建议直接从 Phase 1 开始：先设计 `SchedulerKernel + ReminderSurfaceManager + v1.1 数据迁移`，然后再动 UI。**这三个基础一旦定错，后面的任务系统越丰富，返工成本越高。

[1]: https://github.com/super-productivity/super-productivity?utm_source=chatgpt.com "GitHub - super-productivity/super-productivity: Super Productivity is an advanced todo list app with integrated Timeboxing and time tracking capabilities. It also comes with integrations for Jira, GitLab, GitHub and Open Project. · GitHub"
[2]: https://www.todoist.com/help/articles/use-the-task-view-to-manage-tasks-in-todoist-eDeRDO0C?utm_source=chatgpt.com "Use the task view to manage tasks in Todoist"
[3]: https://www.todoist.com/help/articles/complete-a-task-with-a-recurring-date-dmI6SVqdP?utm_source=chatgpt.com "Complete a task with a recurring date"
[4]: https://www.electronjs.org/docs/latest/api/power-monitor/?utm_source=chatgpt.com "powerMonitor | Electron"
[5]: https://releases.electronjs.org/pr/50045?utm_source=chatgpt.com "PR #50045 | Electron Releases"
[6]: https://github.com/hovancik/stretchly?utm_source=chatgpt.com "GitHub - hovancik/stretchly: The break time reminder app · GitHub"
[7]: https://www.electron.build/docs/targets/?utm_source=chatgpt.com "Target Selection Guide | electron-builder"
