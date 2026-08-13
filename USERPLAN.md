> **历史归档**：本文是早期「产品完成度 / Completion Pass」轮次的实施计划。其中列出的所有 P0/P1 问题与第二批、第三批建议均已落地（CommandButton 成功反馈策略、TimeBlock 逆向拖出、todayViewModel 唯一模型、Focus 沉浸条件、计划→日程改名、TaskComposer placement、Project rename 错误保持等，均有对应代码与测试）。后续开发请以 README/AGENTS/CLAUDE 和现有测试为准，不要把本文当作待办清单。

## 核心结论

这一轮我建议**暂时冻结你现在满意的配色，不再做大范围视觉改造，正式进入一次“产品完成度 / Completion Pass”**。重点不是继续增加功能，而是把已经存在的任务管理流程做到“可理解、可逆、无意外、无小毛刺”。

你这次提到的 1–4 我检查后，几乎每一项都能在代码里找到明确根因；继续向外扩查后，又发现了几处同等级问题。尤其值得优先修的是：**Today 快速添加后任务可能消失、Plan 的 TimeBlock 只能进去不能直观出来、15 分钟块几何尺寸本身就有问题、同一任务实际上无法按产品宣称拆成多个块、Today/Focus 使用了两套“今天任务”定义、Focus 的壳层与真实 FocusSession 没完全对齐。**

配色这一轮建议**锁住**。你已经觉得舒服，说明大的视觉方向已经成立；除非某个 hover/disabled/error 状态存在可读性问题，否则不要再动主题色，避免“修完成度时顺手重新设计”。

另外我检查的 GitHub 远端分支目前 HEAD 仍是 `0a4d768…`。 如果你满意的最新配色还有本地未 push 的修改，那么下面方案应以你的本地颜色为准，**不要用远端旧 token 覆盖它。**

---

# 第一批：先修你已经遇到的操作问题

这些我建议作为 **P0/P1，一轮全部解决**。

| 优先级    | 问题                   | 已确认根因                                                                                                                | 应该怎么改                                                                                               |                                                        |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **P0** | 优先级切换会冒出“勾”          | `task-priority-dot` 使用 `CommandButton`，而所有 Command 成功后 `CommandButton` 默认渲染一个 `Check`，它完全不知道这是“状态切换”而不是“提交成功”        | 给 `CommandButton` 增加 `successFeedback="none"                                                        | "check"`。优先级、checkbox、Focus 子任务等“状态本身已经变化”的控件使用 `none` |
| **P0** | TimeBlock 拖进时间线后拖不出来 | `BlockView` 只支持时间线内部 `pointermove` 和 `resize`，删除只有键盘 `Delete/Backspace`，鼠标没有逆向路径                                     | 支持把 block 拖回左侧“待安排”区；drop 到左栏即删除**这个 TimeBlock**，不是删除任务；同时保留一个 hover 菜单里的“移出时间线”作为 fallback         |                                                        |
| **P0** | 一个任务不能真正拆成多个时间块      | 领域模型允许一 Task → N TimeBlocks，但左栏代码只要发现该任务当天已经有 block，就把它从 `committed/backlog` 过滤掉                                     | 任务有 block 后**仍保留在左栏**，显示“已排 1 块 · 45m”；继续拖可创建第二块、第三块                                                |                                                        |
| **P0** | 15/30 分钟任务文字遮挡       | 15 分钟在 `PIXELS_PER_MINUTE=1` 下只有 15px，但 CSS 强制 `min-height:30px`，视觉几何已经与真实时间不一致；同时仍强塞标题、时间、drag handle、resize handle | 删除假 `min-height`；按 duration 使用 `micro / compact / full` 三种布局。15m 只显示单行标题；30m 显示标题+极简时间；≥45m 才显示完整两行 |                                                        |
| **P1** | “12 今”里的“今”过小        | `.plan-strip-today` 目前明确是 `font-size:10px`                                                                           | 不再显示 `12 今`。日期格改成两层：`今天 / 12`；其他日期为 `周二 / 11`、`周三 / 12`                                             |                                                        |
| **P1** | 左右翻周后当前选中日期可能消失      | 左右按钮只改 `stripAnchor`，不改 `day`；因此当前 `day` 可以落在新的 7 日窗口之外                                                              | `shiftWeek(±7)` 同时移动 `stripAnchor` 和 `day`，保持用户选择在相同相对位置                                            |                                                        |
| **P1** | Plan 拖动中途被系统取消可能残留状态 | Pointer 流程只监听 `pointermove/pointerup`，没有 `pointercancel/lostpointercapture`                                          | 统一 cleanup handler，任何结束路径都 `setPreview(null)` 并移除 listener                                          |                                                        |

### Plan 的最终交互应该是这样的

```text
待安排                              今天时间线

完成论文修订  已排 2块 · 90m    ┌ 09:00 ───────────┐
↕ 仍然可以再次拖进去             │ 完成论文修订       │
                                └─────────────────┘

                                ┌ 14:00 ───────────┐
                                │ 完成论文修订       │
                                └─────────────────┘

把任意一个块拖回左边
              ↓
只删除那一个 TimeBlock
任务本身仍然存在
```

这才符合用户自然形成的“放进去 / 拿出来”的物理直觉。

---

# 第二批：把“今天 / 收件箱 / 日程 / 项目”真正讲清楚

你现在不理解这几个页面的区别，我认为**不是用户的问题，而是目前 UI 没把领域模型表达出来**。

EyeProtect 实际上不是四个互斥文件夹，而是几个不同维度：

```text
任务是什么？
        │
        ├── 属于哪个长期目标？ ─────→ 项目
        │
        ├── 今天承诺做吗？ ─────────→ 今天
        │
        ├── 几点到几点做？ ─────────→ 日程 / TimeBlock
        │
        └── 此刻正在做吗？ ─────────→ 专注
```

**收件箱**则很特殊：

> 收件箱 = 还没有归入任何项目的未完成任务。

代码确实就是 `status === open && projectId === null`。

所以完全可能有一件任务同时是：

```text
收件箱
+
今天
+
14:00–15:00 的日程
```

因为它今天要做、已经排了时间，但仍然没有属于任何 Project。

同样也完全可以：

```text
Research 项目
+
今天
+
没有 TimeBlock
```

意思是：

> 今天承诺完成，但什么时候做保持灵活。

### 我强烈建议把“计划”改名为“日程”

内部 ID 继续保持：

```text
plan
```

不用改数据库、shortcut 或 domain。

但用户看到的导航改为：

```text
今天
收件箱
日程
专注
项目
```

因为现在：

```text
今天 → 有“规划今天”
计划 → 又叫“计划”
```

这两个名字天然互相打架。

改成：

**今天**
今天真正承诺完成的工作。

**收件箱**
尚未归入项目的任务。

**日程**
把任务安排到具体时间段；这是可选步骤。

**专注**
此刻真正执行的一件任务。

**项目**
由多个任务组成、通常持续多天的长期目标。

这个认知成本会下降非常明显。

`workbenchNavigation.ts` 应直接增加：

```ts
description
```

例如：

```ts
today:
  今天承诺要做的事

inbox:
  尚未归入项目的任务

plan:
  把任务安排到具体时间段

focus:
  只处理当前这一件事

projects:
  按长期目标和阶段组织任务
```

然后 `NavItem` 可以把 description 作为 tooltip；页面 Header 下也显示一句极轻的 secondary copy。当前导航元数据只有 `label/icon/tier`，正适合在这里建立唯一文案来源。

### 项目页尤其需要重新设计 Overview

现在进入“项目”但不选择具体项目时，只显示：

> 从左侧选择一个项目，查看任务进度和下一步。

这几乎没有帮助用户理解“为什么需要项目”。

我建议改成：

```text
项目

把需要多步推进、持续数天或更久的目标放进项目。
一次性的小任务不需要创建项目。

Research
完成 UI 2.0
12 个未完成 · 6 个已完成
──────────── 43%

论文
完成论文投稿
8 个未完成 · 21 个已完成
──────────── 72%
```

如果没有任何 Project，则明确告诉用户：

```text
项目适合：
完成论文
上线一个产品
准备一次旅行
进行长期学习计划

“买牛奶”这样的单次任务不需要项目。
```

这样用户不需要读教程就能理解它。

---

# 第三批：我额外查出的完成度问题

这里有几个我建议你不要跳过，因为它们正属于你说的“决定用户喜不喜欢软件的小 bug”。

### 1. 在“今天”直接添加任务，任务可能立刻消失

这是目前我认为最需要修的一个。

Today 页面直接渲染：

```tsx
<TaskComposer projects={projects} />
```

但 `TaskComposer` 创建成功后只创建 `Task`，没有创建当天 `DailyTaskPlan`。

而 Today 主体已经主要依赖：

```text
DailyTaskPlan
TimeBlock
```

决定显示内容。

所以用户在：

> 今天 → 添加任务 → 回车

之后，这个任务可能立刻不在“今天”。

这个体验会让人怀疑软件是不是吞任务了。

建议把 `TaskComposer` 改为拥有明确 destination：

```ts
placement:
  | { type: 'inbox' }
  | { type: 'today'; localDate: string }
  | { type: 'project'; projectId: string }
```

Today 创建：

```text
create Task
+
upsert DailyTaskPlan(today)
```

Project 创建：

```text
create Task(projectId)
```

Inbox：

```text
create Task(projectId=null)
```

**“在哪里创建”必须决定创建后的初始语义。**

---

### 2. Today 页面现在存在两套“今天任务”的定义

正文已经使用：

```text
todaySections
→ DailyTaskPlan
→ TimeBlock
```

但：

```text
左侧 Today 数量
Focus candidates
```

依然主要使用旧的：

```text
matchesTaskView(today)
→ plannedAt
→ dueAt
→ TimeBlock
```

因此一件纯粹通过“每日规划 → 加入今天”的 Flexible Task：

```text
Today 正文：有

导航数量：可能没算
Focus 候选：可能没有
```

这应该抽出一个真正唯一的：

```ts
deriveTodayExecutionModel(...)
```

然后：

```text
Today sections
Today nav count
Focus candidate
Today empty state
```

全部消费这个模型。

---

### 3. “今日目标”和“已安排”会重复同一任务

`deriveTodaySections()`：

```ts
todaysThree
= dailyRank != null

scheduled
= 所有有 TimeBlock 的 active task
```

但是 `scheduled` 没有排除 `todaysThree`。

所以：

```text
任务 A
= 今日目标 #1
= 14:00–15:00 有 TimeBlock
```

可能显示成：

```text
今日目标
A

已安排
A
```

如果它们都是完整 Task Row，就会像重复数据。

建议 Today 区域互斥：

```text
今日重点
已安排，但不是今日重点
灵活执行
```

而“今日重点 A 已经安排到 14:00”直接在 A 的 metadata 里显示时间即可。

---

### 4. Focus 的进入条件不正确

现在 Workbench 是否进入无 Sidebar/Toolbar 的 Focus shell，是：

```ts
section === 'focus' && activeTask
```

但 FocusSurface 自己明确承认：

> activeTask 可以存在，但 FocusSession 还没有开始。

此时页面显示：

> 开始专注

所以会出现：

```text
还没开始 FocusSession
↓
Sidebar 已消失
↓
页面却让我“开始专注”
```

建议：

```text
有 activeTask，但没有 session
→ 正常 Workbench shell

FocusSession 真正 live
→ 才进入沉浸式 Focus shell
```

而且沉浸模式里必须有非常轻的：

```text
← 返回工作台
```

Esc 同样有效，并且**返回工作台不应该自动结束专注计时**。

---

### 5. “完成任务”存在跨命令一致性风险

当前：

```ts
finishTask.run(activeTask.id)
  .then(() => complete.run())
```

也就是不管第一步是否成功，都执行 `completeFocus()`。

可能发生：

```text
任务写入失败
↓
任务还是 open

但是
↓
FocusSession 已结束
```

最低限度必须：

```ts
const taskResult = await finishTask.run(...)
if (!taskResult.ok) return

const focusResult = await complete.run()
```

更理想的是主进程提供一个**原子 compound command**：

```text
complete task + complete focus session
```

一起成功或一起失败。

---

### 6. Focus 候选按钮共享同一个 command state

目前：

```ts
const start = useCommand(...)

candidates.map(task =>
  <CommandButton state={start.state}>
)
```

点击候选 A 后，所有候选按钮都收到：

```text
pending
```

理论上会一起表现成正在执行。

应该把候选抽成：

```tsx
<FocusCandidate />
```

让每行拥有自己的 command state，或者至少记录：

```ts
pendingTaskId
```

只让被点击的那个反馈。

---

### 7. Project / Section 的失败反馈还不够可靠

Project rename 当前是：

```text
开始 rename
↓
提交
↓
立即退出 editing
↓
异步 run()
```

所以失败时用户已经失去输入态。

Project Section rename 同样先：

```ts
setEditing(false)
```

然后才发 command。

甚至 section 左右移动直接调用：

```ts
commands.sections.move(...)
```

没有经过这一组件自己的 `useCommand` 状态，因此 pending/error 都没有良好的局部反馈。

统一原则应该是：

```text
用户提交
↓
保持编辑状态 / 显示 pending
↓
成功
→ 退出编辑

失败
→ 保留输入内容
→ 输入框下直接显示原因
```

绝对不要失败以后让用户重新输入一遍。

---

### 8. Task Detail 的 Project / Section 有短暂状态不一致

Task Detail 已经做了不少不错的结构改善，但目前：

```ts
projectId
```

使用本地 draft，

而：

```ts
useProjectSections(task.projectId)
value={task.sectionId}
```

仍读 persisted `task`。

因此用户刚把：

```text
Project A
→ Project B
```

时，Project Section 下拉框短时间还可能展示 A 的 sections。

建议 draft 中同时管理：

```text
projectId
sectionId
```

当 Project 改变：

```text
sectionId = null
fetch Project B sections
```

持久化时保证组合一致。

---

# 下一步具体文件

我建议你这一轮按下面范围执行，不再碰 theme 主色：

| 文件                                          | 修改内容                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `components/CommandButton.tsx`              | 增加 stateful-control 的 success feedback policy，消灭不该出现的 ✓                  |
| `features/tasks/TaskList.tsx`               | priority / completion checkbox 使用无 success-check 模式                      |
| `features/tasks/PlanWorkspace.tsx`          | TimeBlock 逆向拖出、多 block、日期 week shift、pointer cancel、duration density     |
| `features/tasks/PlanWorkspace.module.css`   | micro/compact/full 时间块；删除 30px 假高度；重做日期格                                 |
| `features/tasks/TaskComposer.tsx`           | 增加 creation placement；补 segmented `aria-pressed`                         |
| `features/tasks/todaySections.ts`           | Today sections 改互斥                                                       |
| **新增** `features/tasks/todayViewModel.ts`   | 唯一生成 Today count / Today task union / Focus candidates                   |
| `views/WorkbenchView.tsx`                   | 使用统一 Today 模型；Today quick-add placement；Focus shell 条件；Projects Overview |
| `features/workbench/workbenchNavigation.ts` | 增加 description；建议显示名 `计划 → 日程`                                           |
| `components/primitives/NavItem.tsx`         | description tooltip / accessible description                             |
| `features/tasks/FocusSurface.tsx`           | 正确进入/退出 Focus；per-row pending；完成流程正确性                                    |
| `features/tasks/ProjectList.tsx`            | rename 失败保留编辑态                                                           |
| `features/tasks/ProjectWorkspace.tsx`       | section rename/move 错误状态；Project Overview 配合                             |
| `features/tasks/TaskDetail.tsx`             | Project/Section draft 一致性                                                |
| `scripts/capture-ui-snapshots.mjs`          | 增加 15m/30m block、日期条、Today quick-add、Focus pre-session 截图                |
| `scripts/smoke-plan-interactions.mjs`       | 单独真实测试 block in/out、多 block、resize、restart persistence                   |
| `tests/today-sections.test.ts`              | Today section 互斥                                                         |
| **新增** `tests/today-view-model.test.ts`     | Today 所有消费者使用同一语义                                                        |
| `tests/workbench-navigation.test.ts`        | 新导航 copy/description contract                                            |

## 验收标准

这一次不要用“功能基本能用”作为完成标准。我建议最终必须达到：

```text
优先级切换
→ 没有多余 ✓
→ normal / important / urgent 循环正确
→ 重启后仍正确

Today 添加任务
→ 创建后仍在 Today
→ 如果没有 Project，也允许同时存在 Inbox
→ UI 明确解释为什么

Plan
→ Task → TimeBlock
→ TimeBlock → 待安排
→ 同一 Task 创建 2、3 个 Block
→ 只移除其中一个 Block
→ 重启后一致

15 / 30 / 45 / 60 分钟
→ 全部不遮文字
→ 连续短块不视觉重叠

日期
→ “今天”清晰
→ 7 天全部可读
→ 跨月可理解
→ 上/下周后选中日期不会消失

Today
→ 同一 Task 不出现两次
→ 导航数量 = Today 真实模型
→ Focus candidates = Today 真实模型

Focus
→ 只有真实 Session 才进入沉浸态
→ 有清楚返回路径
→ 完成失败不能偷偷结束 Session

错误路径
→ rename / drag / move / save 失败都有可见反馈
→ 用户输入不能因为失败而消失
```

这轮完成后，我反而建议**不要马上加新功能**，而是再做一轮专门的“鼠标乱点、连续拖拽、极短文本/极长文本、窗口缩放、125%/150% DPI、快速开关 SideSheet、操作失败、重启恢复”的破坏性体验测试。

你第 6 点提得很关键：创新决定一个应用有没有理由被尝试，**完成度决定用户会不会开始信任它、习惯它，最后愿不愿意长期留下来**。EyeProtect 现在最值得投入的已经不是再增加一个页面，而是把这些几十毫秒、十几个像素、一次错误状态、一个无法撤回的拖拽都处理到“不需要用户思考”。这会比再堆一批功能带来更大的产品质感提升。
