# EyeProtect 1.2 产品、交互与工程重构方案

## 一、先反思：上一轮我具体做错了什么

上一轮审查有四个根本性偏差。

**第一，我把 correctness 的范围定义得太窄。**

我主要检查了 Scheduler、SQLite、休眠恢复、Notification、持久化、IPC 等后台 invariant。这些确实重要，但对于用户：

> 按钮点了没反应

本身就是一个 P0 correctness failure。

“函数调用逻辑正确”不能证明“产品正确”。

真正完整的 correctness 应该是：

```text
用户看到一个操作
    ↓
用户理解它能做什么
    ↓
能够稳定命中/点击
    ↓
操作进入 pending
    ↓
执行成功 / 明确失败
    ↓
UI 产生可理解反馈
    ↓
状态持久化
    ↓
刷新/重启后仍正确
```

我上次只认真审了中间后三段。

---

**第二，我错误地把现有 smoke tests 当成了 UX 验证。**

这是这次重新审查后非常明确的问题。

当前 `smoke-running-app.mjs` 所谓 Workbench 测试，是直接在 Renderer 里调用：

`window.eyeProtect.createTask(...)`

然后检查返回的数据和页面 DOM。它没有模拟用户去点击真正的按钮。

`smoke-reminder-experience.mjs` 也一样：

* 直接 `createTask`
* 直接 `setActiveTask`
* 直接 `saveSettings`
* 直接 `testReminder`
* 直接 `openWorkbench`

然后检查 `.task-row`、`.alert-panel` 是否出现。

所以：

```text
IPC 可调用 ✅
DOM 能渲染 ✅
组件文件存在 ✅
CI 全绿 ✅

≠

用户真的能把软件用起来
```

这是测试策略本身的错误。

---

**第三，我没有把你提到的“很多互不相关按钮一起坏”当成系统信号。**

现在重新沿着：

```text
Button
→ React handler
→ preload
→ IPC
→ main
→ TaskStore
→ renderer event
→ visible feedback
```

逐层检查后，找到了一个非常值得怀疑的系统性根因。

当前启动过程中，一旦 Task DB 进入 recovery/read-only 状态，主进程会定义：

```ts
requireWritableTaskDatabase(...)
```

之后几乎所有领域写操作都必须经过它。

其中包括：

* 收下每日公仔
* 不收每日公仔
* 改名
* 收藏
* 换材质
* 删除公仔
* 新建独立提醒
* 编辑独立提醒
* 删除独立提醒

还包括：

* 新建 Task
* 修改 Task
* 完成 Task
* 删除 Task
* 新建 Project
* 修改 Project
* 删除 Project

因此如果用户当前数据库恰好在 recovery mode：

> “收下它”“这次不收”“创建项目”“新建任务”同时失效

完全是符合当前架构的。

**我不能仅凭 GitHub 仓库证明你当前机器一定处于这个状态，但这是目前最能解释“很多不相关按钮一起死”的结构性原因。**

更糟的是 UI 对这件事的处理很差。

Settings 里写的是：

> “本次会话中的任务修改不会写回磁盘”

这句话让用户以为：

> “我还能改，只是不保存。”

实际主进程却直接 throw，根本不让写。

这是**行为和文案同时错误**。

---

**第四，我没有从成熟生产力软件的产品模型反推 EyeProtect。**

现在的 Workbench 实际更像：

> 数据库 CRUD 管理器 + 几个 smart filter。

而不是一个让人完成工作的工具。

这也是为什么即使把所有 bug 修完，它仍然会“不像样”。

---

# 二、当前 UI 为什么会让用户觉得“大量按钮都是坏的”

这不是单一 CSS 问题，而是整个 interaction architecture 有缺陷。

## 1. Mutation 基本都是 fire-and-forget

Character Collection 现在直接：

```ts
void window.eyeProtect.collectDailyCharacter()
void window.eyeProtect.discardDailyCharacter()
```

没有：

* pending
* disabled
* success feedback
* error feedback
* retry
* rollback

因此数据库拒绝写入时：

```text
点击「收下它」
↓
Promise reject
↓
界面完全不变
↓
用户结论：按钮坏了
```

这是非常合理的用户判断。

Workbench 更严重。

当前很多操作都是：

```ts
void window.eyeProtect.createProject(...)
void window.eyeProtect.updateProject(...)
void window.eyeProtect.updateTask(...)
void window.eyeProtect.setTaskStatus(...)
```

也就是说整个应用根本没有统一的：

> Action → Pending → Result → Feedback

交互契约。

---

## 2. “创建项目”本身就是一个很差的交互

当前 Project 创建过程是：

```text
点击一个很小的 +
↓
出现 inline input
↓
输入名称
↓
Enter 或失焦
↓
立即关闭 input
↓
后台异步 createProject
```

最明显的问题是：

`commitAdd()` 调用 `onCreate(name)` 后**立刻把输入框清空并关闭**。

它根本不知道项目到底有没有创建成功。

于是失败时：

> 用户输入项目名 → 输入框消失 → 项目没出现

看起来就是：

> “创建项目按钮无效。”

这不是偶发 bug，而是错误的 interaction design。

---

## 3. 很多命中目标小得离谱

当前 CSS 中：

* Project add：约 `20×20px`
* Task checkbox：约 `18×18px`
* Priority dot：约 `10×10px`

尤其把 **10px 的小圆点设计为核心 Priority 操作入口**，本身就非常不友好。

W3C WCAG 2.2 对 pointer target 的基础建议是至少能够容纳 `24×24 CSS px` 的点击目标，或者拥有足够的间距；更大的 target 还会进一步降低误操作。

对于 Windows 桌面应用，我甚至不建议只满足 24。

**EyeProtect 1.2 内部设计标准应该直接设为：**

```text
最低 hit target     32×32
主要 icon action    36×36
Primary button 高度 40
Toolbar button      36×36
Checkbox hit-area   32×32
```

视觉 icon 本身仍然可以 14–18px。

关键是**hitbox 不能只有 icon 本身那么大**。

---

## 4. Task Row 信息密度极其混乱

一条 Task 当前同时塞了：

```text
Priority Dot
Checkbox
Title
Planned time
Due time
Context
Project
Tags
Status
Up
Down
Delete
```

这造成两个问题。

第一，**几乎每个像素都可能执行不同操作**。

第二，最常见的动作：

> “我现在要做这件事”

反而没有变成 Task Row 的主要 CTA。

它只藏在右侧 Task Detail 里。

---

## 5. Task Detail 是一个“表单”，不是任务详情

现在 TaskDetail 同时维护大量 local state：

* title
* notes
* priority
* context
* project
* plannedAt
* dueAt
* reminderAt
* estimate
* tags
* recurrence
* parent
* status

然后很多字段一发生变化，就开始排异步自动保存。组件 unmount 时甚至还会再 flush 一次 draft。

这会产生一种很差的心理模型：

> 我到底什么时候保存了？

更严重的是：

> 保存失败在哪里看？

只有 Task Detail 内部一个小状态。

其他大量 mutation 连这点都没有。

---

# 三、1.2 不应该“升级 Workbench”，而应该重新定义产品

我建议彻底明确一个核心闭环：

# Capture → Plan → Focus → Rest → Resume → Review

这六个动作才是 EyeProtect 1.2 的骨架。

---

## 为什么应该这样做

Todoist 目前的 Today 是跨项目聚合今天真正需要处理的任务；Task View 把 description、date、deadline、priority、labels、subtasks、reminders 等集中在同一个任务详情界面；Project/View 又允许 List、Board、Calendar 等不同表达形式。

Sunsama 的核心价值则不是“更多 Task 字段”，而是一套明确的 Daily Planning：

```text
回顾
→ 选今天的任务
→ 看预计工作量是否超载
→ 排序 / Timebox
→ 开始工作
```

并把 planned time、actual time 和 calendar timebox 分开。

Akiflow 强化的是：

```text
Capture
→ Plan
→ Calendar Time Blocking
→ Focus
```

任务可以有 planned time、duration、recurrence，并直接拖进 calendar。

TickTick 同时把快速 Capture、Lists/Filters/Tags、Calendar、Focus/Pomodoro 放在一个执行体系里。

Super Productivity 近几个月仍然在持续重做 Focus Mode、Planner、deadline、reminder action、键盘 UX 和 idle flow，也说明真正成熟的桌面 productivity 产品，核心竞争力不是“有任务列表”，而是 execution loop 的顺畅程度。

EyeProtect 不应该完整复制任何一个。

应该抽取五者共同最有价值的部分，再加入 EyeProtect 自己真正独特的：

> **Rest / Health Rhythm。**

---

# 四、EyeProtect 1.2 的信息架构

当前的 Sidebar 太平均。

Today、Inbox、Upcoming、Overdue、Away、Completed、Projects、Collection、Reminders、Settings 全是接近同一级别。

这会导致：

> “什么都有，但没有一个主流程。”

1.2 应缩成五个 Primary Destination。

```text
┌────────────────────┐
│ EyeProtect         │
│                    │
│ ☀ Today            │
│ ⤓ Inbox            │
│ ▦ Plan             │
│ ◎ Focus            │
│ ▣ Projects         │
│                    │
│ ────────────────   │
│ 🔔 Reminders       │
│ 🐣 Collection      │
│ ⚙ Settings         │
└────────────────────┘
```

其中：

**Today = 今天怎么过**

**Inbox = 我想到什么**

**Plan = 我什么时候做**

**Focus = 我现在做什么**

**Projects = 我为什么做、做到哪了**

其他都应该降级。

---

## Overdue 不再是 Primary View

过期任务不是一个用户每天想“去逛”的空间。

它是一个异常状态。

应该出现在：

```text
Today
  ⚠ 3 件需要重新安排
```

点击进入 triage。

不是永久占一个 Sidebar Item。

---

## Away 也不再是 Primary View

这是 EyeProtect 很有价值的领域属性，但不是导航。

它应该成为一个 Smart Context：

```text
@desk
@away
@any
```

当 Walk Break 出现时：

> “既然起来了，要不要顺手完成「取快递」？”

才是它真正的价值。

---

## Completed 进入 More / Review

Completed 不是日常入口。

放在：

```text
Projects → Completed
Today → Review
Search → status:done
```

即可。

---

## Collection 降级

公仔应该是 EyeProtect 的 personality layer。

**不应该和 Today / Projects 竞争同一层用户注意力。**

Collection 放底部工具区完全可以。

甚至可以通过桌宠点击进入。

---

# 五、Workbench 2.0：Today 应成为整个软件的首页

当前 Workbench 首页只是：

```text
任务列表
+ 搜索
+ Priority filter
+ Context filter
+ Status filter
+ 右侧详情
```

这是一张数据库列表。

1.2 Today 应该是下面这样：

```text
┌──────────────┬─────────────────────────────────┬──────────────────────┐
│              │  今天 · 8 月 10 日              │  今日时间线          │
│ ☀ Today   7  │                                 │                      │
│ ⤓ Inbox   3  │  NOW                            │ 09:00  Team sync     │
│ ▦ Plan       │ ┌─────────────────────────────┐ │                      │
│ ◎ Focus      │ │ 修改论文                     │ │ 10:00 ┌──────────┐ │
│              │ │ 已专注 38m · 预计 60m        │ │       │ 修改论文 │ │
│ Projects     │ │ [继续专注]                    │ │       └──────────┘ │
│ Research     │ └─────────────────────────────┘ │                      │
│ Personal     │                                 │ 11:00  ◌ 休息预测    │
│              │  今日最重要                     │                      │
│              │  ○ 修论文                       │ 13:00 ┌──────────┐ │
│              │  ○ 完成 benchmark               │       │ Benchmark│ │
│              │  ○ 回复邮件                     │       └──────────┘ │
│              │                                 │                      │
│              │  灵活任务                       │                      │
│              │  ○ 买咖啡豆  20m               │                      │
│              │  ○ 整理文档    30m              │                      │
└──────────────┴─────────────────────────────────┴──────────────────────┘
```

重点不是这个 ASCII 长什么样。

而是页面回答四个问题：

1. **我现在应该干什么？**
2. **今天最重要什么？**
3. **我今天还有多少时间？**
4. **下一次应该什么时候休息？**

当前 Workbench 基本没有回答这些问题。

---

# 六、Today 的核心组成

## 1. NOW

当前正在执行的 Task 必须是页面视觉第一优先级之一。

不是现在顶部那个：

> 当前任务 42m

的小文字。

应该是：

```text
NOW

修改论文

38 / 60 min
─────────────────────

下一次护眼：12 min

[继续专注]   [完成]
```

如果没有 Active Task：

```text
现在还没有正在处理的任务

建议：
「Benchmark 插帧模型」  P1 · 45m

[开始]
```

---

## 2. Top 3

参考 Todoist 对 Today priority 的强调和 Akiflow 的 Daily Goals，但不要复杂化。Todoist 当前也明确鼓励用户识别当天最重要的三项任务。

EyeProtect Today：

```text
今日最重要

1  修改论文
2  Benchmark
3  回复导师
```

最多三项。

不要搞十几个 Priority 维度。

---

## 3. Scheduled

已经 Timebox 的工作。

---

## 4. Flexible

今天想做，但没有准确时间段的东西。

---

## 5. Triage

Overdue / 昨天没做完的东西。

不是自动把 30 个 overdue 塞进 Today。

而是：

```text
3 件任务需要重新安排
[处理]
```

---

# 七、Plan：这是 1.2 和当前版本最大的能力差距

现在：

`plannedAt`

只是一个字段。

真正的 Time Management 必须把：

```text
Task List
+
Calendar
```

连起来。

TickTick、Sunsama、Akiflow 都把拖任务进入时间轴作为核心规划交互；Sunsama 还明确用 planned time 汇总每日 workload，帮助用户判断当天是不是安排过量。

EyeProtect 1.2 的 Plan：

```text
┌────────────────────────┬────────────────────────────────┐
│ 未安排                  │ 周一 · 8 月 10 日             │
│                        │                                │
│ ○ 修改论文      60m    │ 09:00                          │
│ ○ Benchmark     90m    │                                │
│ ○ 邮件          20m    │ 10:00  ┌──────────────────┐   │
│                        │        │ 修改论文 · 60m    │   │
│ 明天                   │        └──────────────────┘   │
│ ○ ...                  │                                │
│                        │ 11:00  ── 护眼节奏预测 ──       │
│                        │                                │
│                        │ 13:00  ┌──────────────────┐   │
│                        │        │ Benchmark · 90m   │   │
│                        │        └──────────────────┘   │
└────────────────────────┴────────────────────────────────┘

计划工作 5h 20m
可用工作时间 6h 00m
健康休息预测 40m

█████████████████░░  合理
```

这是 EyeProtect 可以明显区别于普通 Todo App 的地方。

---

# 八、Time model 必须重新设计

既然 1.2 可以不管迁移，我建议直接放弃现在一些容易混淆的时间语义。

至少区分四件事：

```text
plannedDate
    我哪一天想做

TimeBlock
    我具体什么时候做

deadlineAt
    最晚什么时候必须完成

Reminder
    什么时候通知我
```

不要再试图用一个：

`plannedAt`

兼任“计划日期”和“具体时间安排”。

---

# 九、Focus：真正把 Task Management 和 Eye Protection 结合起来

这是 EyeProtect 最应该打磨到极致的页面。

```text
┌────────────────────────────────────────────────┐
│                                                │
│                  修改论文                      │
│                                                │
│                  38:42                         │
│               ───────────                      │
│                预计 60m                        │
│                                                │
│    Checklist                                   │
│    ✓ 整理结果                                  │
│    ○ 修改 Figure 4                             │
│    ○ 写 Conclusion                             │
│                                                │
│          👁 还有 11 分钟建议休息               │
│                                                │
│      [暂停]        [完成任务]                  │
│                                                │
└────────────────────────────────────────────────┘
```

Focus 时：

* Sidebar 自动收起；
* 不显示 Project filters；
* 不显示 Collection；
* 不显示统计 dashboard；
* 不显示几十个其他 Tasks。

就是一个 Task。

Super Productivity 最近几个版本持续在重构 Focus Mode、break handoff、task interactions，本质也是解决这个 execution UX。

---

# 十、Rest 不再是 Focus 的中断，而是 Focus Loop 的一部分

现在用户体验上更像：

```text
Task Manager
和
Reminder
是两套产品
```

1.2 应该变成：

```text
Task
  ↓
Focus Session
  ↓
Break Due
  ↓
Rest
  ↓
Resume Context
  ↓
Same Task
```

例如：

```text
休息完成 ✓

刚才你在做：

修改论文
已专注 48 分钟

[继续修改论文]

或

[选择下一项任务]
```

这比 Windows Notification：

> “休息完成 · 继续当前任务”

高级得多。

因为整个 state transition 是产品本身的一部分。

---

# 十一、Walk Break 才是 `away` Task 真正有价值的地方

例如用户正在做：

```text
修改论文
```

Walk Break 到来：

```text
起来走一走

顺便可以完成：
📦 去前台拿快递

[我去一下]

[只休息]
```

结束以后：

```text
拿到快递了吗？

[完成「拿快递」]
[稍后再说]

然后：
[继续修改论文]
```

这才是 EyeProtect 自己独有的 workflow。

而不是给 Sidebar 加一个：

> Away

列表。

---

# 十二、Projects 1.2：项目必须真的成为“项目”

当前 Project 基本只有：

```text
name
color
parent
task filter
```

UI 也基本只是点击 Sidebar 后筛任务。

1.2 Project：

```ts
Project {
  id
  name
  icon
  color

  status:
    active
    onHold
    completed

  goal
  notes

  defaultView:
    list
    board

  createdAt
  updatedAt
}
```

并新增：

```ts
ProjectSection {
  id
  projectId
  name
  sortOrder
}
```

---

## Project List View

```text
Research

目标
────
完成插帧论文实验和投稿

Progress
██████████████░░░  72%

NEXT
○ 完成 ablation               P1
○ 整理 Figure 3
○ 写 Discussion

Experiments
✓ Baseline
✓ Loss comparison
○ Edge device benchmark

Paper
○ Figures
○ Discussion
○ Proofreading
```

---

## Project Board View

Todoist 的 Board 把 Section 直接映射为列，这个模型简单、成熟，而且非常适合项目阶段。

EyeProtect 只需要：

```text
BACKLOG      NEXT        DOING        DONE
```

或者用户自定义 Sections。

不要 1.2 就做一个完整 Jira。

---

# 十三、Task Detail 2.0：不再永久占 320px

现在工作台硬性：

```css
220px sidebar
+
main
+
320px detail
```

导致最小 880px 宽的窗口中间真正可工作的区域很窄。

1.2：

**Task Detail 改成可打开的 Side Sheet。**

默认页面：

```text
Sidebar | Main
```

点击 Task：

```text
Sidebar | Main | Detail Sheet
```

Escape / 点击空白：

关闭。

Todoist 也采用点击 Task 打开集中式 Task View 的思路，将属性集中，而不是强迫每个列表永远预留一大块空间。

---

# 十四、Task Detail 字段重新分组

不要现在这样所有字段平铺。

应该变成：

```text
标题

备注

──── 执行 ────
计划日期       今天
预计时长       45m
时间安排       14:00–14:45

──── 约束 ────
Deadline       周五
Reminder       13:55
Repeat         每周一

──── 组织 ────
Project        Research
Section        Paper
Priority       P1
Tags           #paper #experiment
Context        Desk

──── Checklist ────
○ 整理 Figure
○ 写 Caption
```

Parent Task 不应该用现在这种：

> 从所有 tasks 里一个 Select 选择父任务

这种数据库味很浓的设计。

Subtask 应直接在 Task Detail 里管理。

---

# 十五、Interaction Foundation：1.2 最先写的不是漂亮 UI

这是整个 1.2 最关键的工程改造。

我要建立一个强约束：

# Renderer 中禁止 silent mutation

不要再出现：

```ts
void window.eyeProtect.createProject(...)
```

这种代码作为普通产品操作。

所有 mutation 必须经过统一 Command Layer：

```ts
type CommandState =
  | idle
  | pending
  | success
  | error

type CommandResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      code: string
      message: string
      recoverable: boolean
    }
```

例如：

```ts
await commands.projects.create(...)
```

UI 自动获得：

```text
pending
error
retry
toast
analytics/debug trace
```

---

# 十六、所有 Button 都必须具备五种状态

1.2 UI Contract：

```text
Default
Hover / Focus
Pending
Success
Disabled / Error reason
```

不是简单：

```text
onClick={() => void xxx()}
```

---

## 「收下它」

点击：

```text
[ 收下它 ]
```

变成：

```text
[ ⟳ 正在加入收藏… ]
```

成功：

```text
✓ 已加入收藏
```

角色进入 grid，并立即动画反馈。

失败：

```text
无法加入收藏

任务数据库不可写。
[查看原因] [重试]
```

用户不需要打开 DevTools 猜。

---

## 创建 Project

1.2 不使用 20px `+` + blur-to-submit。

点击：

```text
+ 新建项目
```

打开小 Popover / Dialog：

```text
新建项目

名称
[ Research                 ]

颜色
● ● ● ● ●

初始视图
○ List
○ Board

[取消]            [创建项目]
```

成功以后：

* dialog 关闭；
* 新项目高亮；
* 自动进入 Project；
* Toast：`已创建 Research`。

失败：

* dialog 保持；
* 输入内容不丢；
* inline error。

---

# 十七、数据库错误不能伪装成“按钮坏了”

1.2 不再采用现在这种：

> App 正常打开，但其实几乎全部 Mutation 都禁止

的 recovery mode。

既然允许不迁移，那么干脆让 1.2 使用全新的 DB schema。

如果 DB 无法写：

**不进入正常 Workbench。**

直接进入：

```text
EyeProtect 无法打开本地工作数据库

你的文件仍然保留。

[重试]
[打开数据目录]
[创建新的空数据库]
[退出]
```

这叫 **fail loudly**。

而不是：

> 软件看起来正常，80% 按钮其实是假的。

---

# 十八、建议直接创建全新 1.2 数据库

既然无需考虑迁移：

```text
eyeprotect-v12.db
```

重新定义 schema。

建议核心表：

```text
projects
project_sections

tasks
task_tags

time_blocks
focus_sessions

reminders
reminder_occurrences
notification_delivery

break_sessions
app_state

characters
```

删除运行时兼容负担：

```text
legacy TodoItem
legacy AlarmClock
inbox/active → open migration
1.0 tasks.json migration
read-only migration mode
Settings.todos
Settings.alarms
Settings.activeTaskId
```

1.2 代码不应该继续背 1.0 的历史。

---

# 十九、Tasks 1.2 推荐模型

```ts
Task {
  id

  title
  notes

  status:
    open
    done
    cancelled

  projectId
  sectionId
  parentId

  priority
  tags
  context

  // “这一天想做”
  plannedDate: "2026-08-10" | null

  // 真正硬截止
  deadlineAt: number | null

  estimateMinutes

  recurrence

  createdAt
  updatedAt
  completedAt
}
```

然后：

```ts
TimeBlock {
  id
  taskId

  startAt
  endAt

  locked
}
```

这比当前：

```text
plannedAt
dueAt
reminderAt
```

全部长得像 timestamp，但承担不同心理含义的设计更清楚。

---

# 二十、Focus Session 单独成为领域对象

```ts
FocusSession {
  id
  taskId

  startedAt
  endedAt

  activeMs

  mode:
    free
    countdown
    flowtime

  outcome:
    completed
    paused
    interrupted
}
```

不要再让：

> 当前 Task 的时间

只是某几张 work_sessions 表的副作用。

Focus 是 EyeProtect 的一级能力。

---

# 二十一、Daily Planning：1.2 应增加一个非常轻量的仪式

Sunsama 的 Daily Planning 很值得参考，因为它不是增加更多管理字段，而是减少每天开始工作的决策成本。

EyeProtect 可以做成 3 步，不需要复制它全部功能。

### Step 1

昨天没做完什么？

```text
修改论文         → 今天
Benchmark        → 明天
回复邮件         → 今天
```

### Step 2

今天最重要的三件？

```text
1 修改论文
2 Benchmark
3 回复导师
```

### Step 3

今天装得下吗？

```text
工作时间      6h 30m
会议          1h 00m
任务预计      5h 50m
休息预测      35m

剩余          -55m

今天安排过多。

建议把：
「整理实验脚本」移动到明天

[接受]
```

这就是 EyeProtect 可以比普通 Task Manager 更聪明的地方。

甚至不需要 AI。

就是简单可靠的 capacity planning。

---

# 二十二、Keyboard-first，但不能牺牲 Mouse UX

生产力工具适合快捷键。

但当前应用的问题已经证明：

> 不能因为程序员喜欢快捷键，就忽略普通点击。

建议：

```text
Ctrl+K     Command Palette

N          New Task

P          Plan selected task

F          Focus selected task

E          Edit

Space      Complete

Esc        Close sheet/dialog

Ctrl+Shift+P
           Daily Planning
```

但任何 keyboard action 都必须有可发现的 UI 等价入口。

---

# 二十三、Interaction target 标准

内部直接制定比最低标准更高的规范：

| 控件                            | EyeProtect 1.2 |
| ----------------------------- | -------------: |
| 普通 icon hitbox                |        ≥ 36×36 |
| Checkbox hitbox               |        ≥ 32×32 |
| Sidebar row                   |    ≥ 40px high |
| Primary button                |    ≥ 40px high |
| Task row                      |         ≥ 44px |
| destructive icon              |        ≥ 36×36 |
| gap between unrelated actions |          ≥ 8px |

W3C 的 24×24 是最低基线，不应该是我们的设计目标。

并继续保留当前已经存在的 `:focus-visible` 思路；键盘用户必须一直能看到当前焦点。

---

# 二十四、什么应该向哪些产品学习

| 产品                 | EyeProtect 应吸收                                           | 不应该复制                              |
| ------------------ | -------------------------------------------------------- | ---------------------------------- |
| Todoist            | Sidebar IA、Today、Task Detail、Project Sections、List/Board | 团队协作、复杂生态                          |
| TickTick           | Calendar + Task、Focus、快速 capture                         | Habit/Eisenhower/大量 feature tabs   |
| Sunsama            | Daily Planning、workload、planned/actual time              | 重型 SaaS / calendar integration 复杂度 |
| Akiflow            | Time Blocking、执行导向、Command workflow                      | 大量 integrations、AI assistant       |
| Super Productivity | Local-first、Active Task、Focus/Break integration          | 大量设置项和 plugin complexity           |

## 这些方向分别可从 Todoist 当前 Task/View/Project 设计、TickTick 功能体系、Sunsama Daily Planning/Timeboxing、Akiflow Time Blocking，以及 Super Productivity 最近的 Focus/Planner 重构中看到。

# 二十五、1.2 明确不做什么

为了避免再次变成 feature pile：

* 不做 Team / Collaboration；
* 不做账号体系；
* 不做 Cloud Sync；
* 不做手机端；
* 不做 Habits；
* 不做 Eisenhower Matrix；
* 不做 Gantt；
* 不做 Jira/Slack/GitHub integrations；
* 不做 AI 自动安排；
* 不做旧数据迁移；
* 不无限增加提醒模式。

1.2 就做：

> **一个人每天真的能用的工作系统。**

---

# 二十六、工程架构建议

建议 Renderer 重构成：

```text
AppShell
│
├── Navigation
│
├── CommandPalette
│
├── GlobalStatus
│
│
├── Today
├── Inbox
├── Plan
├── Focus
├── Projects
│
├── ReminderCenter
├── Collection
└── Settings
```

Renderer 内：

```text
UI Components
      │
      ▼
Command Layer
      │
      ▼
Client Domain Store
      │
      ▼
Typed IPC
      │
      ▼
Main Domain Services
      │
      ▼
SQLite
```

**React Component 不再直接把 IPC 当数据库 SDK 使用。**

---

# 二十七、Command Layer 示例

```text
TaskCommands
  create
  complete
  schedule
  startFocus
  move
  delete

ProjectCommands
  create
  rename
  changeView
  addSection
  archive

CharacterCommands
  collect
  discard
  equip

ReminderCommands
  create
  snooze
  complete
```

统一拥有：

```text
validation
pending state
error translation
logging
optimistic update
rollback
toast
retry
```

这样以后不可能再出现：

> 20 个页面各自 `void window.eyeProtect.xxx()`。

---

# 二十八、用户状态必须是一级状态

全局要存在：

```ts
AppHealth {
  database:
    healthy
    degraded
    unavailable

  scheduler:
    healthy
    degraded

  notification:
    available
    unavailable
}
```

例如 Notification 被 Windows 禁掉：

页面应该明确显示：

```text
系统通知当前不可用

任务提醒仍会显示在 EyeProtect 内。
[查看设置]
```

不是后台重试四次以后悄悄 failed。

---

# 二十九、必须重写测试体系

这是 1.2 的 Release Blocker。

当前 Smoke 最大的问题是：

> **测试代码扮演了程序员，而不是用户。**

1.2 必须有四层。

### Domain tests

继续保留：

* recurrence
* scheduler
* SQLite
* reminder delivery
* recovery
* task invariants

---

### IPC contract tests

确保：

```text
Command
→ Main
→ DB
→ Event
→ Result
```

---

### Component interaction tests

必须真的：

```text
click("收下它")
expect(button).pending
expect(success)

click("+ 新建项目")
type("Research")
click("创建项目")
expect(sidebar).contains("Research")
```

---

### Packaged Windows E2E

这是最关键的。

真正启动：

```text
EyeProtect.exe
```

然后用真实 pointer / keyboard：

```text
点击 Collection
点击 收下它

点击 Projects
点击 新建项目
输入 Research
提交

创建 Task
打开 Task
安排今天
开始 Focus

触发 Break
完成 Break
继续 Task
完成 Task
```

**这些路径禁止通过 `window.eyeProtect.createTask()` 绕过 UI。**

API 可以用于 test setup。

但验证用户行为时必须点击真正的界面。

---

# 三十、还必须加 Visual / DPI Regression

至少：

```text
1280×720 @ 100%
1920×1080 @ 100%
2560×1440 @ 125%
3840×2160 @ 150%
```

截图比较：

```text
Today
Inbox
Plan
Focus
Project List
Project Board
Task Detail
Reminder
Collection
Settings
```

因为这是 Windows desktop app。

“DOM 存在”远远不够。

---

# 三十一、1.2 实施阶段

## Phase 0 — Stop the bleeding

在任何新 feature 前：

```text
删除 silent mutation
统一 CommandResult
全局 AppHealth
真实 Button E2E
扩大 hit target
修复所有 current dead actions
```

**Definition of Done：**

当前应用里任何可见 Button：

> 点击以后必须产生状态变化或者明确解释为什么不能操作。

---

## Phase 1 — Fresh 1.2 Core

建立：

```text
新 SQLite schema
新 Task model
ProjectSection
TimeBlock
FocusSession
Command layer
AppHealth
```

删除 migration burden。

---

## Phase 2 — Workbench Shell 2.0

完成：

```text
Today
Inbox
Projects
Command Palette
Task Side Sheet
```

先不要做 Calendar。

确保基础任务体验真的优质。

---

## Phase 3 — Planning

实现：

```text
Daily Planning
Plan page
Day timeline
TimeBlock
drag scheduling
capacity meter
```

---

## Phase 4 — Focus + Rhythm

实现整个差异化闭环：

```text
Start Task
→ Focus
→ Break
→ Rest
→ Resume Task
```

---

## Phase 5 — Project Management

实现：

```text
Project goal
Sections
Progress
List
Board
Project completion
```

---

## Phase 6 — Pet / Collection polish

让公仔真正服务于健康习惯：

```text
健康休息
→ character reaction

完成一天规划
→ reaction

完成 Focus block
→ reaction
```

但不使用：

> 连续签到焦虑

或强迫式 streak。

---

## Phase 7 — Quality Gate

发布必须同时满足：

```text
Domain tests       PASS
IPC tests          PASS
Component UX       PASS
Packaged E2E       PASS
Fault injection    PASS
Visual regression  PASS
Keyboard audit     PASS
DPI audit          PASS
```

不是：

> `npm test` 全绿就发布。

---

# 三十二、我建议为 1.2 制定十二条硬性验收标准

1. 所有 Primary user mutation **0 个 silent Promise rejection**。

2. Renderer 业务代码中禁止普通 mutation 使用：

```ts
void window.eyeProtect.xxx()
```

3. 所有 interactive target 至少达到内部规定 hitbox。

4. 数据库不可写时，不得进入“看似正常但按钮失效”的 Workbench。

5. 项目创建必须具有明确 Create / Cancel / Error / Pending。

6. Task 创建必须在用户完成一次最常见路径时只需要：

```text
输入标题 + Enter
```

7. Today 首屏必须能在不使用 Filter 的情况下回答：

> “我现在应该做什么？”

8. Sidebar Primary destination ≤ 5。

9. 项目不再只是一个 Task Filter，必须具有 goal / section / progress / view。

10. Focus 必须能完成：

```text
Task → Break → Same Task
```

的完整上下文恢复。

11. Packaged E2E 必须真的点击所有 P0 Button。

12. 一个功能只有在：

```text
成功路径
+
失败路径
+
loading 路径
+
keyboard 路径
+
packaged Windows 路径
```

都验证以后，才叫“完成”。

---

# 最终判断

我不建议再把现有 Workbench 作为 1.2 的基础继续加功能。

**保留的应该是：**

```text
Electron shell
SQLite 思路
SchedulerKernel
Break domain
Notification reliability 的部分机制
Pet / procedural character
```

**应该大幅重做的是：**

```text
整个 Renderer interaction architecture
Workbench information architecture
Task time semantics
Project domain
Focus workflow
Mutation feedback
App error/recovery UX
E2E testing philosophy
```

产品方向也应该从：

> 护眼工具 + Todo 管理器

变成：

> **Capture → Plan → Focus → Rest → Resume → Review**

这条工作节奏链。

真正的差异化不是“Todoist + 桌宠”。

而是：

> **一个知道你正在做什么、知道你什么时候该离开屏幕，也知道你回来以后应该继续做什么的个人工作系统。**
