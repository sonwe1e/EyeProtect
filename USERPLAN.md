结论先给：**下一版不应该继续把重点放在“再补几个页面”，而应该正式把 UI 2.0 背后的任务管理领域模型升级。** 当前 Workbench 的外形已经明显进步，但 `Plan / Project Board / Focus` 仍大量借用 1.1 的字段来模拟成熟任务管理器的概念；如果继续在这个基础上堆功能，会形成“看起来像 Sunsama/Todoist，底层却不是同一种语义”的技术债。

我在结束审查前重新确认了分支：HEAD 仍是 `49518cfc9c5457a778a6c0014b33b6890d9f3eeb`，`Rebuild workbench UI 2.0`。 最新 Windows CI 仍然是失败状态：Typecheck、316 个测试、UI contract、Build、Windows packaging 都通过，但 packaged smoke 失败，后续 UI snapshot、DPI matrix、emergency smoke、pet failure smoke 和 installer upload 全部被跳过。 所以当前分支还不能视为下一版开发的稳定基线。

# EyeProtect 1.2：任务管理与健康工作流重构计划

## 一、当前项目真正处于什么阶段

当前 UI 2.0 已经解决了上一版相当多“产品根本不像任务管理器”的问题：

* 一级导航已经收敛成 Today / Inbox / Plan / Focus / Projects；
* Task Detail 改成 SideSheet；
* 有 Command Palette；
* Today 有 NOW；
* 有时间线式 Plan；
* 有全屏 Focus；
* Project 有 List / Board；
* mutation 已进入 Command Layer；
* Design System、theme token、UI contract 和 packaged journey 测试都已经开始建立。

这些都应该保留。当前 Workbench 的一级结构已经比旧版合理很多。

问题是：

> **UI 已经进入 2.0，Task Domain 仍基本停留在 1.1。**

SQLite 当前核心仍然只有：

```text
projects
tasks
work_sessions
task_work_state
reminder_delivery
...
```

没有：

```text
DailyPlan
DailyTaskPlan
TimeBlock
ProjectSection
FocusSession
```

因此现在三个非常重要的页面都在“借字段”。

```text
Plan
plannedAt + estimateMinutes
≈ TimeBlock

Project Board
open + global activeTask + done
≈ Kanban Columns

Focus
taskActiveMs
≈ Focus Session
```

这就是下一版必须首先解决的核心架构问题。

---

# 二、独立正确性审查：当前版本还存在什么问题

## P0：Task Detail 仍存在实际数据丢失窗口

备注使用：

```text
500ms debounce
```

保存。

effect cleanup 会：

```ts
clearTimeout(timer)
```

但当前 TaskDetail 已经没有 unmount flush。

Workbench 关闭 SideSheet 时则直接：

```text
selectedTaskId = null
→ TaskDetail unmount
```

所以一个非常简单的路径：

```text
编辑备注
↓
立即关闭任务详情
↓
< 500ms
↓
timer 被取消
↓
内容没有写入
```

这是确定性的用户数据丢失，不是理论风险。

**1.2 开发开始前必须修。**

建议：

```text
local draft
   ↓
debounced persist

blur / close / unmount
   ↓
flushLatestDraft()
   ↓
await or synchronously enqueue latest revision
```

同时引入 revision，防止旧 autosave 覆盖新内容。

---

## P1：任务列表的拖动排序目前实际上没有实现

Task Row 被设置：

```tsx
draggable={canReorder}
```

也会进入：

```tsx
onDragStart
onDragOver
onDrop
```

但 `onDrop` 只：

```tsx
setDraggingId(null)
```

根本没有调用 `onMove()`。

所以当前：

```text
鼠标可以抓住任务
↓
可以拖
↓
可以放
↓
什么也不会发生
```

这尤其值得重视，因为当前 PR #2 的说明已经把：

> functional drag and resize interactions

列为已经完成的能力。

这是“实现声明”和代码事实冲突的典型例子。

处理方式不是修改文档，而是增加 packaged pointer regression：

```text
Task A
Task B

drag B above A

DB:
B.sort_order < A.sort_order

UI:
B rendered above A

restart:
still B above A
```

三层全部通过才算完成。

---

## P1：现在的 Plan 会显示错误的时间事实

当前 Plan 固定为：

```text
07:00 – 21:00
```

Task 的：

```text
plannedAt
```

被直接解释为 timeline block 起点。

Task 的：

```text
estimateMinutes
```

被直接解释为 timeline block 高度。

然后：

```ts
baseTop = clamp(...)
baseDuration = clamp(...)
```

于是：

### 情况 A：Task 是 06:00

UI 不显示：

> 06:00

而会把它 clamp 到：

> 07:00

### 情况 B：Task 是 23:00

UI 会把它挤回时间线底部。

### 情况 C：estimateMinutes = null

代码直接：

```ts
task.estimateMinutes ?? 30
```

也就是说 UI 会把：

> 未估时

当成：

> 30 分钟

然后还纳入：

> 已计划 xxx 分钟

统计。

这不是简单的 UI approximation。

**Planner 不应该向用户展示数据库里不存在的计划事实。**

应该改成：

```text
未估时
→ block 使用最低视觉高度
→ planned workload 中显示“未估时 3 项”
→ 不加入分钟总量
```

而 07:00–21:00 之外：

```text
06:00 Task
→ 时间线扩展

或者：

“工作时间之外”
06:00 Task
```

绝对不能偷偷改成 07:00。

---

## P1：Plan 目前存在明确的 DST 错误

当前计算“明天”：

```ts
today + 86_400_000
```

计算当天 09:00：

```ts
day + 9 * 60 * 60_000
```

这在 DST 时区不是“日历运算”。

我独立按照 `America/Los_Angeles` 2026 年 DST 边界复现：

```text
2026-03-08 00:00
+ 9 real hours
=
10:00 local

不是 09:00
```

并且：

```text
2026-03-08 00:00
+ 24 real hours
=
2026-03-09 01:00
```

秋季切换则会得到相反的一小时偏移。

因此时间系统必须统一禁止：

```ts
day + 86_400_000
```

这种 calendar-day arithmetic。

建立唯一：

```text
CivilDate
CivilTime
CalendarMath
```

utility：

```text
addLocalDays()
localDateAtTime()
sameLocalDate()
startOfLocalDate()
```

Planner、Today、Upcoming、recurrence 都只能调用这一套。

---

## P1：Project Board 的“进行中”不是项目阶段

当前三列：

```text
待处理
进行中
已完成
```

看起来非常合理。

但是代码定义是：

```text
待处理
= open && task.id !== globalActiveTaskId

进行中
= open && task.id === globalActiveTaskId

已完成
= done
```

也就是说：

> Board 的“进行中”列其实是 Focus Engine 的 global active task。

整个 EyeProtect 同时只能有一个 Active Task。

所以如果有：

```text
Project Research
Project Personal
```

那么两个项目也不可能各自拥有正常意义上的：

> Doing

任务。

这与真正的 Kanban 完全不是一个概念。

Todoist 的 Board 采用的是：

> Project Section = Column

Section 可以表示阶段，任务可以在 Section 之间拖动，而且 Section 自身可以增删和排序。([Todoist][1])

EyeProtect 应该采用同样的领域分离：

```text
Project workflow state
≠
Task execution state
```

也就是：

```text
Section = Doing

task 当前处于 Doing
```

并不意味着：

```text
用户此刻正在 Focus 这个 Task
```

Active Task 应该只是在 Board Card 上显示：

```text
● 正在专注
```

而不是决定 Card 属于哪一列。

---

## P1：Focus 目前没有真正的 Focus Session

当前 Focus 页面显示：

```text
已工作 38m / 60m
```

但传入的是：

```ts
work.taskActiveMs
```

TaskWorkTracker 中：

```text
taskActiveMs
= 该任务历史累计 active time

currentSessionMs
= 当前 checkpoint 之后的 live segment
```

而 checkpoint 每 30 秒重新开始 segment。

所以：

```text
currentSessionMs
```

甚至也不是真正的 Focus Session。

数据库只有：

```text
work_sessions

started_at
ended_at
active_ms
```

这些实际上更像 checkpoint segment。

缺少：

```text
用户 14:00 开始一次 Focus
→ 工作 21m
→ Eye Break
→ 回来继续
→ 工作 19m
→ 手动结束

这一整个逻辑 Session
```

下一版必须正式加入：

```text
FocusSession
```

---

## P1：Task Detail autosave 架构会随着 Task 数量增长迅速变差

除了 Notes 之外，其余大量字段变化都使用几乎：

```text
0ms autosave
```

而每次 TaskService.updateTask 后：

```text
emit('tasks-changed', getTasks())
```

会重新读取并广播**整个 Task List**。

Renderer：

```ts
onTasksChanged(setTasks)
```

再整体替换数组。

所以标题连续输入：

```text
敲一个字符
→ IPC
→ SQLite UPDATE
→ SQLite SELECT all tasks
→ broadcast full Task[]
→ Workbench re-render

下一个字符
→ 再来一次
```

任务几十条时感觉不到。

几千条时这会成为架构问题。

下一版应改成：

```text
task:list
仅首次 hydration

task:upserted(Task)
task:removed(id)
```

Renderer 使用 normalized Map：

```text
Map<TaskId, Task>
```

增量更新。

---

## P1：Project 删除的风险级别过低

当前 Project Item 的删除按钮直接调用：

```text
commands.projects.remove()
```

没有 confirmation，也没有 Project undo。

TaskService 删除 Project 后会把它的任务脱离 Project。

也就是说误点：

```text
Research
[Delete]
```

项目组织结构立即消失。

Task 数据还在并不能代表这是安全的。

下一版应该采用：

```text
Archive Project
```

作为正常操作。

真正 Delete：

```text
Project Settings
→ Delete
→ destructive confirmation
```

---

## P1：当前 CI 本身仍然证明不了 UI 2.0 已完成

当前 UI contract 会检查：

* semantic colors；
* raw CSS color；
* emoji；
* hit targets；
* navigation 数量；
* forced colors；
* reduced motion；
* contrast。

这是很好的方向。

但是当前最新 CI 的事实是：

```text
verify:ui-contract       PASS
build                    PASS
package                  PASS

packaged smoke           FAIL
```

后续 screenshot / DPI / fallback tests 全部没有运行。

这很好地证明：

> Static UI Contract ≠ Runtime UI Correctness。

Theme 当前同时存在 CSS：

```css
color-scheme: dark;
```

和 App：

```ts
document.documentElement.style.colorScheme = ...
```

两套 authority。

不应该先猜究竟是谁错。

应该 instrumentation：

```text
settings.theme
dataset.theme
inline colorScheme
computed colorScheme
matchMedia(prefers-color-scheme)
nativeTheme.shouldUseDarkColors
BrowserWindow.backgroundColor
```

一次性输出。

然后用 packaged reproduction 决定究竟是：

```text
product bug
还是
CDP emulation/test bug
```

不投票、不猜测。

---

# 三、优秀产品应该分别借什么，而不是复制什么

## Todoist：借“组织结构”

Todoist 最值得 EyeProtect 借鉴的是：

```text
Inbox
→ Project
→ Section
→ Task / Subtask

Today / Upcoming
```

而不是它的协作体系。

目前 Todoist 的 Section 正式承担“把大项目拆成部分或阶段”的角色；Board 中 Section 直接成为列。([Todoist][1])

其 Inbox 也非常明确：

> 不知道该放哪个 Project 的内容先进入 Inbox，然后再整理。

([Todoist][2])

另外值得保留 EyeProtect 已经做对的一点：

```text
计划做的时间
≠
硬 Deadline
```

Todoist 当前同样把普通 date/time 与 deadline 区分。([Todoist][3])

### EyeProtect 应吸收

```text
Project Section
List / Board
Inbox capture
Task detail
Date ≠ Deadline
```

### 不吸收

```text
team
assignee
comments
sharing
workspace permissions
```

---

# 四、Sunsama：借“每天怎么决定做什么”

这是我认为 EyeProtect 下一版最应该重点参考的产品。

Sunsama 的 Daily Planning 不是一个 Dashboard。

它是流程：

```text
Review yesterday
↓
Add tasks to today
↓
Check predicted workload
↓
Defer excessive work
↓
Order tasks
↓
Optional timebox
↓
Start day
```

([Sunsama User Manual][4])

同时它明确区分：

```text
planned time
actual time
working session
task
```

Timebox 产生的是一个 Working Session，而不是把 Task 本身改造成日历事件。([Sunsama User Manual][5])

这正是当前 EyeProtect 最缺的领域抽象。

---

# 五、Akiflow：借“计划日期”和“时间块”的分层

Akiflow 当前 Planning 支持：

```text
Today
Tomorrow
具体时间
时间段
This Week
Next Month
```

也就是说“我要什么时候处理这件事”和“具体几点做”并不是同一个层级。([Akiflow][6])

它还明确推荐每天只确定少数高价值 Goals，典型是 2–3 件，而不是把所有 high-priority task 自动当“今日最重要”。([Akiflow][7])

当前 EyeProtect：

```ts
importantToday =
todayTasks.filter(priority !== normal)
```

所以：

```text
今天有 9 个 Important
→ UI 显示 9 个“今天最重要”
```

语义已经失效。

**Global Priority 和 Daily Commitment 必须分离。**

---

# 六、TickTick：作为“不要过度扩张”的参照

TickTick 当前同时覆盖：

* Task；
* Calendar；
* Timeline；
* Kanban；
* Focus；
* Statistics；
* Habit 等。

([TickTick][8])

EyeProtect 不应该跟它拼 feature count。

TickTick 对 EyeProtect 的价值主要是证明：

```text
Task
Calendar
Focus
```

本来就应该协同。

但 1.2 不应该因此加入：

```text
Habits
Eisenhower
Notes System
Team
多日历同步
```

---

# 七、Super Productivity：最值得关注的工程型同行

它和 EyeProtect 的定位最接近：

```text
desktop
task
time tracking
timeboxing
focus
local-first tendency
```

其近期版本持续在解决：

* Focus Mode；
* Planner；
* planned vs available time；
* single-day schedule；
* break；
* recurring task；
* project completion；
* accessibility；
* sync/data safety。

([GitHub][9])

这给 EyeProtect 一个很重要的产品启示：

> Focus / Planner / Break 不是三个菜单，它们其实是一条状态机。

---

# 八、EyeProtect 1.2 最终产品定义

我建议正式把产品定义改成：

> **EyeProtect 1.2 = Local-first Healthy Execution Planner**

核心 workflow：

```text
Capture
   ↓
Triage
   ↓
Daily Plan
   ↓
Timebox / Order
   ↓
Focus
   ↓
Healthy Break
   ↓
Resume
   ↓
Review
```

其中真正独特于 Todoist / Sunsama / Akiflow 的是：

```text
Healthy Break
+
Away Task
+
Resume Context
```

也就是说：

> EyeProtect 不只是知道你“有什么事要做”，而是知道你现在正在做哪件事、什么时候应该离开屏幕，以及回来以后应该继续哪件事。

---

# 九、1.2 数据模型：这是整个版本最重要的一次改动

## Task 不再承担 Calendar Event 的职责

保留：

```ts
Task {
  id

  title
  notes

  status

  priority

  projectId
  sectionId

  parentId
  tags
  context

  dueAt          // 真正硬 deadline

  estimateMinutes

  recurrence

  ...
}
```

`plannedAt` 不再作为 TimeBlock。

---

## 新增 DailyTaskPlan

```ts
DailyTaskPlan {
  taskId

  localDate        // YYYY-MM-DD

  plannedMinutes   // 今天准备投入多少，而非 Task 总 estimate

  dailyRank        // null | 1 | 2 | 3
  sortOrder

  createdAt
  updatedAt
}
```

这样：

```text
Task priority
```

表示长期重要性。

而：

```text
dailyRank
```

表示：

> 今天我真正承诺完成什么。

---

## 新增 TimeBlock

```ts
TimeBlock {
  id
  taskId

  startAt
  endAt

  timeZone

  source:
    manual
    planner

  createdAt
  updatedAt
}
```

关键关系：

```text
1 Task
→ N TimeBlocks
```

于是一个：

```text
240 分钟
```

的大任务可以安排：

```text
周一 10:00–12:00
周二 14:00–16:00
```

而不是现在：

```text
plannedAt = 周一 10:00
estimate = 240
```

强制变成一块四小时。

Sunsama 当前也允许一个 Task 拥有多个 working sessions，这正是成熟 Timeboxing 应有的抽象。([Sunsama User Manual][10])

---

## 新增 ProjectSection

```ts
ProjectSection {
  id
  projectId

  name
  sortOrder

  createdAt
  updatedAt
}
```

Task：

```ts
sectionId: string | null
```

Project Board：

```text
Section
=
Column
```

Focus Active State 与 Section 完全无关。

---

## Project 增加 lifecycle

```ts
Project {
  ...

  status:
    active
    onHold
    completed
    archived
}
```

真正删除项目降级为非常少用的 destructive operation。

---

## 新增 FocusSession

```ts
FocusSession {
  id
  taskId

  timeBlockId

  startedAt
  endedAt

  activeMs

  outcome:
    completed
    paused
    interrupted

  createdAt
}
```

现有：

```text
work_sessions
```

继续作为精确底层 segment。

改成：

```text
FocusSession
  ├─ WorkSegment
  ├─ WorkSegment
  ├─ Break
  └─ WorkSegment
```

于是终于可以同时显示：

```text
本次专注      24m
今日实际      62m
任务累计      138m
计划          180m
```

而不会把这些概念混在一起。

---

# 十、Daily Planning：1.2 的首要新功能

不需要照搬 Sunsama 做成很重的 ritual。

EyeProtect 可以压缩成四步。

## Step 1：昨天留下什么

```text
昨天还有 4 件未完成

修改 Figure 4
[今天] [明天] [稍后]

Benchmark
[今天] [明天] [稍后]
```

不要自动把所有 overdue 堆到 Today。

---

## Step 2：今天做什么

从：

```text
Inbox
Projects
Backlog
```

挑任务。

然后：

```text
今日目标

1. 修改论文
2. Edge Benchmark
3. 回复导师
```

**最多 3 个。**

它们不依赖 Task priority。

---

## Step 3：今天装得下吗

例如：

```text
计划投入      5h 20m
可工作容量    6h 00m
未估时        2 项

护眼节奏
预计有 4 次屏幕休息窗口
```

没有 estimate 的 Task：

> 不参与假的分钟统计。

而是明确显示：

> 2 项未估时。

Sunsama 的 predicted workload 正是在 Daily Planning 阶段用于避免过量安排。([Sunsama User Manual][4])

---

## Step 4：是否 Timebox

用户可以选择：

```text
只排序
```

或者：

```text
放进时间线
```

Sunsama 也明确把“playlist method”和 timeboxing 当作两种合理工作方式，而不是强制所有 Task 都必须进入 calendar。([Sunsama User Manual][11])

这非常适合 EyeProtect。

---

# 十一、Today 2.1

最终 Today 应只有四个真正重要的区域：

```text
NOW

TODAY'S 3

SCHEDULED

FLEXIBLE
```

然后最下面：

```text
3 件需要重新安排
```

不是：

```text
Important Task 全部自动放“最重要”
```

---

## NOW

```text
修改论文

本次 24m
今日 62m
计划 90m

下一次护眼 11m

[继续]
```

---

## Today's 3

明确来自 DailyPlan：

```text
1 修改论文
2 Benchmark
3 回复导师
```

---

## Scheduled

来自：

```text
TimeBlock
```

而不是 `plannedAt`。

---

## Flexible

已进入 Daily Plan，但没有 TimeBlock。

这意味着用户可以选择：

> 今天要做，但不想精确排时间。

---

# 十二、Plan 2.0

当前只支持：

```text
今天
明天
```

下一版改成：

```text
‹  10  11  12  13  14  15  16  ›
```

仍然保持单日 timeline。

不要现在就开发复杂 Month Calendar。

Super Productivity 最近专门增加 single-day schedule，本身也说明单日执行视角仍然非常重要。([GitHub][9])

---

## 工作时间可配置

例如：

```text
08:00–18:00
```

或者：

```text
10:00–22:00
```

不能硬编码 07–21。

---

## TimeBlock 不等于 Task

左：

```text
Today's Flexible
Backlog
```

右：

```text
Calendar Timeline
```

一个 Task 可以出现多个块。

---

## 没有估时就诚实显示

```text
未估时
```

而不是 30m。

---

## 时间线外的任务不允许偷偷 clamp

应显示：

```text
工作时间之外

06:00 送文件
22:30 夜间构建检查
```

或者动态扩展 timeline。

---

## Eye / Walk 都进入节奏层

计划页可以显示：

```text
──── 👁 护眼窗口
──── 🚶 走动窗口
```

但只能作为辅助计划信息。

不要自动移动用户的 Task。

---

# 十三、Projects 2.0

Project 页重点：

```text
Goal
Status
Sections
Next action
```

而不是精美的百分比。

当前 progress 是：

```text
done count / task count
```

对于：

* parent + subtasks；
* recurring task history；
* 不同大小任务；

这个百分比并不真的表示项目完成程度。

我的建议是：

**1.2 第一阶段甚至可以删除百分比。**

改成：

```text
7 open · 12 completed
```

等真正定义 project scope/progress 后再加。

---

## 默认 Section

可以提供模板：

```text
Backlog
Next
Doing
Waiting
```

或者：

```text
Research
Experiments
Paper
```

由用户决定。

不要把 Focus Active 变成 Doing。

---

# 十四、Focus 2.0

Focus UI：

```text
修改论文

本次专注
24:31

今日实际
62 / 90m

任务累计
138m

────────────────

✓ Figure 3
○ Figure 4
○ Discussion

────────────────

下一次护眼
11m

[暂停]          [完成任务]
```

如果来自 TimeBlock：

```text
当前计划块
14:00–15:30
```

---

# 十五、Break → Resume 才是 EyeProtect 的核心差异

用户：

```text
Focus: 修改论文
```

休息到期：

```text
休息一下眼睛
```

休息完成：

```text
刚才正在：

修改论文

本次已专注 47m

[继续修改论文]
[结束本次专注]
```

如果是 Walk Reminder：

```text
站起来走走

顺手可以：

取快递
打印论文
倒水
```

来自：

```text
context = away
```

这是 EyeProtect 自己真正值得形成壁垒的地方。

---

# 十六、Daily Shutdown / Review

这是 1.2 最后一个核心闭环。

不用做复杂 statistics dashboard。

每天结束：

```text
今天

计划        5h
实际        4h12m

完成 Today's 3
2 / 3

健康休息
4 次完成
1 次跳过

还有 3 件任务：

[明天]
[重新安排]
[Backlog]
```

这让：

```text
Review
```

成为第二天：

```text
Daily Planning
```

的输入。

---

# 十七、Quick Add 下一步怎么增强

当前：

```text
输入标题 + Enter
```

一定保留。

然后可以逐步支持：

```text
修改论文 tomorrow ~60 #Research !important
```

不需要 AI。

只需要 deterministic parser。

但是优先级排在：

```text
TimeBlock
ProjectSection
FocusSession
DailyPlan
```

之后。

---

# 十八、下一版明确不做

这是防止再次功能膨胀的关键。

EyeProtect 1.2 **不做**：

```text
Cloud Sync
Team Collaboration
Mobile Client
Habits
Eisenhower Matrix
AI Auto Scheduler
Google / Outlook 双向同步
Jira / Slack / GitHub integration
复杂 Monthly Calendar
Gantt
```

外部 Calendar Read-only busy overlay 可以考虑 1.3。

不是 1.2。

---

# 十九、工程实现顺序

我建议不要再做一个 18k-line 级的大 PR。

当前 Draft PR #2 相对 master 已经是 176 个 changed files、18k+ additions 的大型变更。

1.2 开始后严格分 PR。

### PR 0 — Stabilization

必须首先完成：

```text
当前 CI 全绿
Notes close data-loss
Task drag reorder
Plan out-of-hours correctness
DST calendar math
Theme runtime authority
Project delete safety
Task status failure rollback
```

**任何一个没完成，不进入新模型。**

---

### PR 1 — Domain Schema v4

只实现：

```text
DailyTaskPlan
TimeBlock
ProjectSection
Project lifecycle
FocusSession
CivilTime utilities
```

不改大 UI。

要求 SQLite migration / fresh DB path、transaction、FK、sanitizer、backup 全测试。

---

### PR 2 — Incremental Renderer State

修改：

```text
task:list
```

只负责 hydration。

mutation 改成：

```text
task:upsert
task:delete
project:upsert
...
```

不再每个字符广播整张 Task[]。

同时修 TaskDetail autosave：

```text
local revision
debounce
flush-on-blur
flush-on-close
stale-write rejection
```

---

### PR 3 — Daily Planning + Today

只实现：

```text
Daily Planning
Today's 3
Flexible
Scheduled
Overdue triage
Capacity
```

---

### PR 4 — TimeBlock Planner

删除：

```text
plannedAt ≈ Calendar Block
```

Plan 完全改读：

```text
DailyTaskPlan
+
TimeBlock
```

支持：

```text
date strip
drag
keyboard schedule
resize
multiple blocks
working hours
off-hours
```

---

### PR 5 — Project Sections

实现：

```text
Section CRUD
Section sort
Task section move
List grouping
Board columns
```

删除：

```text
global Active Task = Board Doing
```

---

### PR 6 — FocusSession

实现：

```text
Start
Pause
Resume
Break pause
Break resume
Complete
actual time
planned vs actual
```

---

### PR 7 — Daily Shutdown / Review

完成整个：

```text
Capture
→ Plan
→ Focus
→ Break
→ Resume
→ Review
```

闭环。

---

# 二十、数据库 invariant 必须提前写死

例如：

```text
DailyTaskPlan

(task_id, local_date) UNIQUE
daily_rank = NULL | 1 | 2 | 3
(local_date, daily_rank) UNIQUE WHERE daily_rank IS NOT NULL
```

---

```text
TimeBlock

end_at > start_at
task_id FK CASCADE
0..N blocks per task
```

---

```text
ProjectSection

project_id FK CASCADE
sort_order deterministic
```

---

```text
FocusSession

task_id FK
ended_at >= started_at
active_ms >= 0
only one live Focus Session globally
```

这些 invariant 应该首先存在于数据库/Service。

UI 只能表现它们。

不能让 UI 自己成为业务规则。

---

# 二十一、时间系统需要单独做 correctness suite

必须加入：

```text
US DST spring forward
US DST fall back
Europe DST
UTC+8
UTC
timezone change
midnight
23:59
cross-midnight block
leap day
month end
```

现有 Plan 的：

```text
+ 86_400_000
```

应该通过 lint/test 直接禁止。

---

# 二十二、Interaction regression suite

真正点击：

```text
Inbox
→ New Task
→ Enter

Task
→ open
→ edit note
→ immediately close
→ reopen
→ note exists
```

---

```text
Task A
Task B

drag B above A
→ UI order changed
→ DB order changed
→ restart
→ still changed
```

---

```text
Project
→ Add Section
→ drag task across sections
→ restart
→ section survives
```

---

```text
Plan
→ unscheduled task
→ drag 14:00
→ resize 60 → 90
→ restart
→ block remains
```

---

```text
Focus
→ start
→ break
→ complete break
→ resume same session
→ pause
→ restart
→ history correct
```

---

# 二十三、CI 应改变失败行为

当前 Pipeline 是串行：

```text
packaged smoke fails
↓
snapshot upload skipped
↓
scale-factor skipped
↓
fallback smoke skipped
```

这对于诊断反而很差。

至少：

```text
Upload UI snapshots
Upload trace
Upload renderer console
Upload reminder trace
```

应：

```yaml
if: always()
```

这样失败的时候才有证据可看。

测试可以 Fail。

**诊断 artifact 不应该跟着被 Skip。**

---

# 二十四、Final Verification Gate

1.2 发布必须同时满足：

```text
Domain unit
PASS

SQLite invariants
PASS

Migration / backup
PASS

Civil-time / DST
PASS

Command / IPC
PASS

Renderer interaction
PASS

Keyboard interaction
PASS

Packaged Windows E2E
PASS

Theme runtime audit
PASS

100 / 125 / 150 / 200% DPI
PASS

Fault injection
PASS

Crash / restart
PASS

Visual regression
PASS
```

而且：

```text
核心 gate 不允许 skipped
```

---

# 二十五、性能验收

下一版至少固定大数据 benchmark：

```text
5,000 open tasks
5,000 completed tasks
100 projects
500 time blocks
```

重点不是设一个随意的“必须 37ms”。

而是验证架构属性：

```text
编辑 1 个 Task
不能 SELECT / broadcast 10,000 Tasks

TaskList render
不能 O(n²) 反复寻找 siblings

Plan
不能一次渲染整个历史 backlog

Focus timer
不能触发整个 Workbench 高频 re-render
```

当前 TaskList 对每一个 Task 都重新：

```ts
orderedTasks.filter(...)
```

寻找 siblings。

下一版直接预建：

```text
childrenByParent
siblingsByParent
taskById
```

---

# 二十六、文档也需要重新组织

当前 `USERPLAN.md` 本身已经出现一个明显信号：

里面仍然写：

```text
当前 HEAD = ff204...
```

而实际 HEAD 已经是：

```text
49518...
```

它实际上更像一份长篇审查报告，而不是 living spec。

1.2 建议拆成：

```text
docs/1.2/product-spec.md
docs/1.2/task-domain.md
docs/1.2/planning-domain.md
docs/1.2/focus-state-machine.md
docs/1.2/interaction-contract.md
docs/1.2/release-gates.md
```

同时用 ADR 固定关键决策：

```text
ADR-001 TimeBlock separate from Task
ADR-002 Board Section separate from Active Task
ADR-003 Civil-time calendar arithmetic
ADR-004 Renderer delta events
ADR-005 FocusSession lifecycle
```

这样代码和设计不会再次漂移。

---

# 最终优先级

如果下一版只能做好四件事，我选择：

## 1

**真正的 Daily Plan + TimeBlock 模型**

这是从 Todo List 变成 Planner 的基础。

## 2

**真正的 Project Section / Board**

这是从 Project Filter 变成 Project Management 的基础。

## 3

**真正的 FocusSession + Break → Resume**

这是 EyeProtect 区别于 Todoist/TickTick 的核心。

## 4

**把整个用户旅程做成不可回归的 packaged E2E**

这是避免再次出现：

> 测试全绿，用户却根本用不了

的唯一可靠办法。

最终不要把 EyeProtect 做成：

> “功能少一点的 TickTick”

也不要做成：

> “带桌宠的 Todoist”。

应该做成：

> **Todoist 的组织能力
>
> * Sunsama/Akiflow 的日计划和 Timebox
> * Super Productivity 的桌面 Focus/Time Tracking
> * EyeProtect 自己独有的 Healthy Break / Away Task / Resume Context。**

这条产品路线有足够清晰的差异化，而且与现在已经做出来的 Scheduler、Activity Monitor、Break、Active Task、Command Layer 和 local-first SQLite 是连续的，不需要推翻项目真正有价值的部分。

本轮我没有修改仓库。最后一次复核时，分支仍停在 `49518cfc...`，最新 CI 仍为失败状态。 因此最合理的下一动作不是直接开始 Daily Planning，而是先把上面的 **PR 0 Stabilization** 做成真正全绿基线，然后再进入 schema v4；否则新领域模型会建立在一个仍有数据丢失、死拖拽和时间显示错误的 UI 基线上。

[1]: https://www.todoist.com/help/articles/360013988740-Het-boardoverzicht-gebruiken-in-Todoist "https://www.todoist.com/help/articles/360013988740-Het-boardoverzicht-gebruiken-in-Todoist"
[2]: https://www.todoist.com/help/articles/get-started-with-todoist-OgNNJR "https://www.todoist.com/help/articles/get-started-with-todoist-OgNNJR"
[3]: https://lp-regional-test.todoist.com/help/articles/does-todoist-support-start-dates-qhqlgZhk "https://lp-regional-test.todoist.com/help/articles/does-todoist-support-start-dates-qhqlgZhk"
[4]: https://help.sunsama.com/docs/usage-guides/daily-planning/ "https://help.sunsama.com/docs/usage-guides/daily-planning/"
[5]: https://help.sunsama.com/docs/usage-guides/tasks/planned-and-actual-times/ "https://help.sunsama.com/docs/usage-guides/tasks/planned-and-actual-times/"
[6]: https://product.akiflow.com/en/help/articles/8286936-task-planning "https://product.akiflow.com/en/help/articles/8286936-task-planning"
[7]: https://product.akiflow.com/help/articles/6614520-setting-goals "https://product.akiflow.com/help/articles/6614520-setting-goals"
[8]: https://ticktick.com/features?language=en_US "https://ticktick.com/features?language=en_US"
[9]: https://github.com/super-productivity/super-productivity/releases "https://github.com/super-productivity/super-productivity/releases"
[10]: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-how-to-timebox/ "https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-how-to-timebox/"
[11]: https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-concepts-and-principles/ "https://help.sunsama.com/docs/usage-guides/timeboxing/timeboxing-concepts-and-principles/"
