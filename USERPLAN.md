# USERPLAN（历史归档）

> **历史归档**：本文是早期「产品完成度 / Completion Pass」轮次的实施计划与设计决策记录。其中列出的所有 P0/P1 问题与第二批、第三批建议均已落地（CommandButton 成功反馈策略、TimeBlock 逆向拖出、todayViewModel 唯一模型、Focus 沉浸条件、计划→日程改名、TaskComposer placement、Project rename 错误保持等，均有对应代码与测试）。后续开发请以 README/AGENTS/CLAUDE 和现有测试为准，不要把本文当作待办清单。
>
> **2026-08 精简**：删除批次计划细节（第一批/第二批/第三批问题表、逐文件改动表、验收标准），仅保留仍有效的核心结论与代码注释引用的锚点速查。源码注释中的 `USERPLAN §X`、`USERPLAN 1.2 PRn/Bn/P0`、`ADR-nnn` 均指下文对应条目。

## 核心结论（仍有效的产品决策）

- **配色锁住**：保留「中性石墨 + 少量玉石青」方向，不再做大范围视觉改造；只在某个 hover/disabled/error 状态存在可读性问题时才调整具体状态色，避免顺手重新设计。
- **工作台五个主视图是维度，不是互斥文件夹**：

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

  收件箱则很特殊：**收件箱 = 还没有归入任何项目的未完成任务**（代码即 `status === open && projectId === null`）。完全可能有一件任务同时是收件箱 + 今天 + 已排日程；也可能属于项目但今天没有 TimeBlock（"今天承诺完成，但什么时候做保持灵活"）。
- **「计划」改名「日程」**：内部 ID 保持 `plan`，不改数据库、shortcut 或 domain；用户可见导航名为「日程」。
- **完成度原则**：任务管理流程必须「可理解、可逆、无意外、无小毛刺」——错误路径有可见反馈，用户输入不能因失败丢失，交互支持"放进去 / 拿出来"式的可逆操作。

## 代码引用锚点速查

> 源码注释用以下锚点引用设计决策。每条一句话，不展开实现细节。

### 章节锚点（§）

| 锚点 | 含义 |
| --- | --- |
| §一.2 | 到期前的软预提醒（pre-alert bubble） |
| §一.3 | 微休息建议；崩溃/重启后恢复的提醒子集 |
| §二 | v1.1 Task Core：任务/项目/子任务/重复规则/上下文（桌面·外出·任意）/休息时提醒/预估时长，SQLite 持久化 |
| §三 | Workbench 统一任务管理面（替代旧 panel/alarm/todo 窗口）；托盘左键打开 Today |
| §四 | Rhythm 循环：活跃时间、当前任务、away 上下文建议；任务 `reminderAt` 接入调度 |
| §四.A | 调度内核设计：deadline 队列、单定时器 + watchdog |
| §四.B | 提醒可见性兜底链（主 surface → 应急 → 系统通知）与滚动 reminder trace；主进程存活期间提醒必须可见 |
| §9 / §11 | 早期资源削减轮次：低开销可观测性（diagnostics） |
| §九 | Schema v4 规划域（计划/TimeBlock/Section/Focus） |
| §十 | 每日计划容量（overcommitment 标记）与提醒休息循环（complete/snooze/skip/pause） |
| §十一 | Today 2.1：今日承诺来自 DailyTaskPlan，而非 plannedAt/dueAt 推导 |
| §十二 | Plan 时间线：工作窗口（块可越界、不钳制）、键盘调度按快照步进 |
| §十四 | Focus 会话四层时间：本次 / 今日 / 累计 / 计划 |
| §十五 / §二十七 | Renderer Command 层 |
| §十六 | UI Contract（CommandButton 等控件契约） |
| §十七 | fail-loud 健康横幅（AppHealth banner） |
| §二十 | TimeBlock 不变式：`end_at > start_at`；约束在数据库 + store，不在 UI 代码 |
| §二十一 | 日历日算术（DST 安全） |
| §二十八 | AppHealth（主进程健康状态推送） |

### 1.2 批次锚点（PRn / Bn / P0）

| 锚点 | 含义 |
| --- | --- |
| PR0 | 主题运行时权威唯一化；拖拽必须可见并持久化；planner 不展示数据库不存在的计划事实；TaskDetail 侧栏关闭即取消编辑（P0） |
| PR1 | Schema v4：project 生命周期（删除是稀有破坏性操作）、sanitizer 集中 |
| PR2 | 增量 delta 流（`tasks-changed` 内部信号）+ `baseRevision` 乐观并发锁 |
| PR3 | 每日计划域（DailyTaskPlan / 容量 / Today 2.1） |
| PR4 | TimeBlock：一任务可拆 N 块、`scheduledTodayIds`、日程视图 |
| PR5 | 项目 Section（Board 列），独立于全局 focus 状态 |
| PR6 | Focus 会话状态机（全局单会话） |
| PR7 | 每日复盘快照 |
| B1 / B4 / B8 | 设计系统批次：CSS 所有权（theme.css 语义色 / tokens.css 基础）、真实内容宽度、对比度按实际令牌测量 |
| B5 | NOW 聚焦条（64–80px 状态行） |
| B6 | 计划内容宽度绝不为 100vw（按工作区 inline-size） |
| B7 | 页面级横向滚动为零（仅 Project Board 自身可横向滚动） |

### ADR

| 编号 | 含义 |
| --- | --- |
| ADR-001 | TimeBlock 是日程事实，不与任务 plannedAt 混用；一任务可有多块；无效区间拒绝而非钳制 |
| ADR-002 | Project Section 独立于全局 focus/active 任务；任务只能分配到本项目的 section |
| ADR-003 | 日历日键 `localDateKey` 单一来源在 `calendar.ts` |
| ADR-005 | 全局最多一个 live focus session；健康休息不中断「本次专注」语义 |
