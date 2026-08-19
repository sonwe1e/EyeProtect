我把 `codex/eyeprotect-runtime-hardening` 这条分支按桌宠、任务/项目、Focus、状态同步和现有 smoke/test 分开核查了一遍。结论是：**现在不应该重构整个项目。** 你感受到的“不顺手”，主要不是功能缺失，而是几个已经存在的模型没有在 UI 和运行时上对齐。

其中最严重的不是项目 UI，而是 **FocusSession 和 TaskWorkTracker 两套状态机没有完整协调**。这会直接造成“开始专注却不计时”“暂停后后台仍可能继续计时”等正确性问题，应该最先修。

## 1. 你列出的 6 个问题，我建议这样处理

| 问题              | 我确认到的根因                                                                                                                               | 建议方案                                                                                                                                      | 优先级    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 待办气泡一直显示        | `refreshBubble()` 只要存在 pending task 就显示；没有用户偏好。Bubble 本身也没有关闭待办预览的逻辑。                                                                 | 新增持久设置 `todoBubbleEnabled=true`；待办 Bubble 增加 `×`，点击后关闭并持久化；设置页可以重新开启。**护眼提醒、走动提醒、pre-alert 不受这个开关影响。**                                    | P0/P1  |
| 桌宠只能拖底部 bar     | `.pet-shell` 原本是 draggable，但 `.pet-character` `inset:0` 覆盖全窗口并设成 `no-drag`，为了保留单击/双击，因此实际只剩底部 handle。                                 | 不直接把 character 改成 native drag，否则会破坏点击。改成“指针移动超过阈值后进入拖动”的手动 drag，整只桌宠都可拖；单击互动、双击工作台、右键收藏继续保留。底部 bar 第一版保留作 fallback。                       | P1     |
| 70% 以下不能缩放      | `SETTINGS_LIMITS.petScale.min` 明确就是 `0.7`，不是 Electron 的限制。                                                                            | `<70%` 进入 compact pet mode，隐藏“待办/闹钟/设置”三按钮。第一轮把 50% 当**验证下限**，不是拍脑袋认定最终下限；实际对 50/60/69/70/100% 做截图和交互验收，不合格就回退最小值。                        | P1     |
| 项目 CRUD 麻烦/部分失效 | Project 数据模型其实已经支持 `active/onHold/completed/archived`，但 UI 基本没有暴露生命周期；创建藏在侧栏 `+`；重命名依赖双击；再次点当前项目还会跳回项目总览。                             | 不重写 Project。给项目页增加显式“新建项目”和 `…` 操作菜单，提供重命名、暂存、完成、归档、删除；默认侧栏只强调 active；Completed/Archived 分组管理。                                            | P1     |
| 专注时间不增加         | **确认存在运行时协调缺陷。** `FocusSessionService.start()` 直接修改 Store 的 active task，而 `TaskWorkTracker` 主要依赖另一条 active-task 事件链；两者独立测试，所以没覆盖组合错误。 | 增加很薄的 focus runtime coordination：Focus 状态转换前 flush 当前 work segment，转换后同步 tracker taskId。然后 renderer 再做本地 1 秒插值，**不每秒写 SQLite，也不每秒走 IPC**。 | **P0** |
| 收件箱与项目割裂        | Inbox 实际已经只是 `task.status === open && projectId === null` 的过滤视图。                                                                      | **删除的是“收件箱一级导航”，不是数据模型。** 项目区最上面增加固定的“未归类”入口，内部继续复用 `inbox` view。零 DB migration、零任务搬迁，最安全。                                                | P1     |

对于第 5 点，我尤其不建议创建一个真正名叫“收件箱”的 Project。那样以后会产生“能不能改名、能不能删除、归档后未分类任务去哪”等一系列假的领域问题。现在的数据结构其实已经是对的，只是信息架构摆错了位置。

## 2. 我额外筛出的几个值得一起修的问题

* **“当前任务”和“专注会话”在 UI 上被混为一谈。** 项目看板的“专注”按钮实际上执行的是 `tasks.setActive()`，卡片甚至会因为只是 active task 就显示“正在专注”，并没有真正 `focus.start()`。 TaskDetail 的“开始任务”也是另一条 active-task 路径。应明确规定：叫“开始专注”的按钮必须创建 FocusSession；如果要保留单纯 active tracking，就叫“设为当前任务”，不能混用。

* **Focus 的健康休息存在两个控制者。** Focus 页面在 `session.onBreak` 时提供“恢复专注”，但真正的 `TaskWorkTracker` 暂停/恢复又由 reminder lifecycle 控制。 这两个入口可能把 FocusSession 标为 resumed，而 tracker 仍处于暂停。建议健康休息期间只显示状态，真正恢复由“完成/跳过休息提醒”统一驱动。

* **项目生命周期已经做了数据层，却基本成了死功能。** Project 有 4 种状态，但项目总览直接 `projects.map()` 全部平铺，没有状态区分。 这是典型的“后端能力存在，用户却感觉 CRUD 缺失”。

* **“查项目”实际上没有。** 当前全局搜索只查 task title / notes / tags，Command Palette 也只有“前往项目”，不会搜索具体项目。 项目数量一多就只能扫侧栏。

* **新建任务快捷键不尊重当前上下文。** `N` 当前无论用户在哪，都会跳到 Inbox。 收件箱并入项目后，更合理的是：在某项目里按 `N` 就给当前项目新增；其他位置才进入“未归类”。

还有一个测试层的问题值得强调：项目的拖拽、Plan 等已有 packaged smoke，UI contract 也覆盖 hit target、contrast、responsive 等，但目前缺少 **FocusSession × TaskWorkTracker 集成、待办 Bubble opt-out、桌宠 petScale/拖动** 三类交互测试。现有测试基础其实不错，只是刚好漏掉了你实际踩到的这些跨模块 UX。

## 3. 我建议按这个顺序实施

| 阶段                          | 修改范围                                                                             | 验收标准                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **PR0：Focus correctness**   | `taskWorkTracker.ts`、Focus runtime wiring、`FocusSurface.tsx`                     | 从完全没有 active task 开始专注，2～3 秒后时间已经增长；暂停后不再增长；A→B 切换无串时间；完成/暂停前最后不足 30 秒的尾段也被保存；健康休息时间不计入 |
| **PR1：Pet interaction**     | `Settings`、`windows.ts`、`BubbleView`、`PetView`、pet CSS/preload                   | 关闭待办气泡后重启仍关闭，但 gentle/pre-alert 正常出现；整只桌宠可拖且不破坏单击/双击/右键；<70% 隐藏三按钮；70% 恢复               |
| **PR2：Projects / Inbox IA** | `workbenchNavigation`、`ProjectList`、`ProjectWorkspace`、Workbench overview/search | Inbox 不再占一级导航；项目区有“未归类”；项目创建/改名/状态/归档/删除都有显式入口；点击当前项目不会莫名返回 overview；可按名称查项目            |
| **PR3：交互收口**                | Board/TaskDetail 文案与动作、快捷键、smoke                                                 | “专注”全部走 FocusSession；“当前任务”与“专注”语义不再混淆；`N` 尊重当前项目；新增 focus/pet/bubble smoke             |

其中 Focus 我不会用“把 checkpoint 从 30 秒改成 1 秒”这种看似简单但错误的办法。当前 tracker 本来就是以 30 秒做持久化 checkpoint，真正需要的是：

`实时显示 ≠ 实时落库`

主进程继续低频持久化；renderer 拿到最近一次 snapshot 后，本地每秒更新显示即可。现在 `FocusSurface` 虽然注释写着 `liveSegmentMs` 用于 “second-smooth”，但 `useTaskWork()` 本身只在 IPC push 时更新，没有本地时钟，因此这个目标实际上没有实现。

对于桌宠缩放，我也不会直接宣布“最低就改成 50%”。当前窗口大小本身只是 `160 * petScale`，从实现上继续缩小没有结构性阻碍。 但 50% 时已经只剩约 80×80 DIP，因此应该新增专门的 `capture:pet-scale`，分别验证 **50 / 60 / 69 / 70 / 100%**；现有 `capture:ui-scale` 测的是设备 DPI，并不是桌宠自己的 scale，两者不能混为一个测试。

最终我会把这轮目标控制在一个很明确的范围：**不换数据库、不重做任务模型、不重构整个 Workbench；修复 Focus 状态协调，重新组织 Inbox/Project 的信息架构，再把桌宠从“能用”打磨成“随手就能操作”。**

另外，你消息最后的 `VideoQualityEvaluation/compare/ugly_folder` 是另一个仓库，我没有把它混入这次 EyeProtect 的判断中。当前分析全部针对你指定的 `codex/eyeprotect-runtime-hardening` 分支。
