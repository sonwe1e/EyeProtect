## 核心结论

我建议下一步不要继续“大改功能”，也不要引入 MUI、Ant Design、Tailwind/Shadcn 之类新的 UI 体系，而是做一个边界非常明确的 **UI-H1：Workbench Visual Hardening**：**保持现有任务领域模型、Command Layer、SideSheet、Plan、Project List/Board 不动，集中重构 CSS 所有权、视觉层级、信息密度和真实 UI 验收链路。**

参考方向以 **Linear 为主，Notion 为辅，Asana 只借项目视图组织方式**。Linear 的关键并不是某个颜色，而是“列表/看板共享同一数据、每个 View 决定显示哪些属性、详情按需展开”；Notion 同样允许不同视图独立控制属性可见性；Asana 强项则是同一项目在 List / Board / Timeline 等视图间切换。EyeProtect 现在其实已经具备这些结构，因此应该**借设计原则，不重新造产品架构**。([Linear][1])

我检查了 `codex/eyeprotect-runtime-hardening` 当前代码和最新 Windows CI。现在的 Workbench 已经有 Sidebar、Toolbar、Today、Plan、Project List/Board、Task SideSheet、Command Palette，方向没有问题。 真正需要优先解决的是两个基础问题：

**第一，CSS 仍有两个权威来源。** `main.tsx` 同时加载旧的 `styles.css` 和新的 `primitives.css/workbench.css`；而旧 `styles.css` 里至今还存在 `.task-row`、`.project-item`、`.detail-card` 等工作台样式，并且含硬编码颜色。  这会导致现在看起来“基本正常”，以后某次改样式却突然被旧规则覆盖。**这是这次整改首先要消灭的根因。**

**第二，当前 UI 自动验收本身不稳定。** 最新 HEAD `0a4d768…` 上，Typecheck、410 个测试、UI Contract、Build 和 Windows 打包全部通过，但 packaged smoke 在 UI journey 阶段失败，因此 DPI/scale matrix 被跳过。 我进一步检查日志后确认：第一次 Plan pointer drag 没提交，fallback 后 resize 又没有得到预期 75 分钟；第二次重试复用了第一次已经被修改的数据，因此待拖动任务直接不存在了。换句话说，**当前截图脚本不是完全幂等的**。不先解决它，后面很难对“UI 无误”给出高置信度结论。

我还下载并检查了最新 CI 实际产出的 6 张 Workbench 截图。当前画面最明显的问题不是“丑”，而是**卡片化太重、任务属性同时暴露过多、Task Detail 太像设置表单、Plan 在约 960px 窗口下时间线掉到首屏以下，并且日期区域出现横向滚动条**。这些正是这一轮应该处理的内容。

[当前 CI 的 6 张 UI 基线截图](sandbox:/mnt/data/EyeProtect-UI-snapshots.zip)

---

## 这一轮界面最终应该变成什么

整体目标不是“做成另一个 Linear”，而是形成 **Linear 的克制信息密度 + Notion 的内容优先 + EyeProtect 自己的低压力健康节奏**。

色彩不需要推翻当前绿色品牌。现在的 `#2e6f61` 本身没有明显问题，问题在于绿色同时出现在选中背景、边框、按钮、分段控件、表单聚焦等过多区域。 新版本应该让 **90% 的界面是中性石墨灰，绿色只表示“当前、执行、成功、健康状态”**。

可以直接以这组候选色作为第一轮：

```css
/* Light */
--bg-app:       #F7F7F5;
--bg-sidebar:   #F2F3F1;
--surface:      #FFFFFF;
--fg-primary:   #1D211F;
--fg-secondary: #5F6864;
--brand:        #2D6E5D;

/* Dark */
--bg-app:       #111412;
--bg-sidebar:   #0F1210;
--surface:      #171A18;
--fg-primary:   #F1F3F2;
--fg-secondary: #A8B0AC;
--brand:        #79B89E;
```

其中正文与次级文字的候选对比度已经足够，最后仍由现有 `verify-ui-contract.mjs` 根据真实 token 再做机器验证；这个脚本现在已经能够检查 light/dark contrast、raw color、hit target、forced-colors 和 reduced-motion，因此应该扩展它，而不是绕过它。

具体视觉上，我希望一轮结束以后出现以下变化：

| 区域          | 当前主要问题                                         | 这一轮目标                                          |
| ----------- | ---------------------------------------------- | ---------------------------------------------- |
| Sidebar     | 选中项绿色面积偏大；品牌区和导航都比较“组件化”                       | 208px 左右的安静侧栏；中性选中底色，只让 icon/小标识使用品牌色          |
| Toolbar     | 58px 偏高，搜索、连续活跃、暂停按钮争抢注意力                      | 约 52px；搜索为主，健康状态降为二级信息                         |
| Today       | Header + 三个状态按钮 + NOW 卡 + Composer 占掉大量首屏      | Header 压缩；NOW 变成扁平状态条；列表更快进入首屏                 |
| Task Row    | 优先级、checkbox、时间、context、project、tags、排序、删除同时出现 | 一行只保留 2–3 个与当前 View 真正相关的信息，操作 hover/focus 才出现 |
| Task Detail | 当前几乎是连续的绿色边框表单                                 | “标题/备注 → 核心属性 → 时间 → 重复/高级”的属性面板               |
| Plan        | 960px 下左右布局塌成上下布局，时间线首屏不可见；日期条有滚动条             | 960px 仍尽量保留 `待安排 + 时间线` 双栏，日期固定网格，无可见横滚        |
| Project     | Board column + card + control 多层容器             | List 内容优先；Board 只保留 Card，自身 Column 尽量透明、扁平     |

这里尤其不要把 Task Detail 换成 Modal。Linear 本身就大量使用无需离开列表即可预览详情的 Peek 思路，所以 EyeProtect 已经采用的 SideSheet 是正确方向；需要改的是**里面的信息结构，而不是详情交互模型**。([Linear][2])

---

## 文件级实施方案

这一轮建议控制在下面五组改动。**除 CI/测试工具外，不碰 `src/main`、`src/preload`、SQLite schema、TaskService、FocusSession、TimeBlock 数据模型。**

| 阶段                    | 文件                                                                                                                                                                         | 具体改动                                                                                                                         | 解决的问题 / 预期结果                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **P0 验收基线**           | `scripts/capture-ui-snapshots.mjs`；新增 `scripts/smoke-plan-interactions.mjs`；`package.json`；`.github/workflows/windows.yml`                                                 | 将“截图”和“会修改数据库的 Plan drag/resize”拆开；每次运行重置测试 fixture；capture 可以重复运行；Plan pointer/keyboard interaction 单独验收                    | 解决当前 CI 重试后任务消失的问题。目标是连续运行 3 次得到相同结果，CI 可以继续执行 DPI matrix |
| **P1 CSS 所有权**        | `styles.css`；`styles/tokens.css`；`styles/theme.css`；`styles/primitives.css`；`styles/workbench.css`；`tests/design-system-contract.test.ts`；`scripts/verify-ui-contract.mjs` | 从旧 `styles.css` 移走 `.task-row/.project-item/.detail-*` 等 Workbench 规则；加入 deny-list 防止以后重新写回；统一颜色、radius、spacing、layout token | 消除双重 CSS authority。任何 Workbench 样式以后都能找到唯一文件              |
| **P2 Shell + Today**  | `WorkbenchSidebar.tsx`；`WorkbenchToolbar.tsx`；`WorkbenchView.tsx`；`TaskList.tsx`                                                                                           | Sidebar 208px；Toolbar 52px；Header 收紧；NOW 扁平化；任务按 View 决定 metadata；排序/删除 hover/focus 才展示                                      | 首屏信息密度明显提升，同时不减少 44px 可点击目标                               |
| **P3 Task Detail**    | `TaskDetail.tsx`；**新增** `TaskDetail.module.css`；`primitives.css`                                                                                                           | 不改 revision/autosave 逻辑，只重新组织 JSX；标题/备注最突出，properties 改属性行；时间一组；重复与高级属性折叠；SideSheet 可扩至约 520px                               | 从“设置表单”变成真正的任务详情。当前 autosave/revision 防冲突逻辑保留不动           |
| **P4 Plan + Project** | `PlanWorkspace.tsx/.module.css`；`ProjectWorkspace.tsx/.module.css`                                                                                                         | Plan backlog 从卡片改紧凑 rows；日期使用 7 格网格；排期统计移出日期条；双栏最小宽度重新计算；Project Goal 变成 header secondary text；Board column 降低容器感            | 960px 首屏同时看见待安排和时间线；Project 不再“卡片套卡片”                     |

几个尺寸我建议直接先固定，而不是边写边猜：

```text
sidebar              224 → 208 px
toolbar               58 → 52 px
page top              42 → 30~32 px
section gap           28 → 22~24 px
radius medium         10 → 8 px
radius large          14 → 12 px

comfortable task row  保持 52 px
compact task row      保持 44 px
```

这里我**不建议为了像 Linear 把 task row 压到 36px**。EyeProtect 已经明确建立了 44px hit-target contract，而且舒适/紧凑密度模式也已经存在。 对 Windows 桌面应用来说，保留这个可点击性约束，比盲目追求极致密度更可靠。

Plan 是这轮最需要单独处理的页面。现在 CSS 的两栏最低需求接近 `250 + 440 + 20 = 710px`，再扣除页面 inset 后，960px 整窗很容易触发 stack。 我建议改成类似：

```css
grid-template-columns:
  minmax(210px, 0.65fr)
  minmax(430px, 1.35fr);

gap: 14px;
```

并把真正 stack 的 container breakpoint 下移到大约 `680–700px` workspace。这样 960px 总窗口、约 208px Sidebar 后，Planner 仍有机会双栏显示。**这会比单纯重新配色更显著地提升“专业任务管理软件”的感觉。**

Task Row 则使用“按 View 展示属性”的办法：Today 主要显示时间/项目；Project 页面不再重复 Project 名；Away 页面不再重复“外出”；普通 context 默认隐藏；tags 最多保留一个，其余进入详情。Linear 与 Notion 都允许按照当前视图控制属性显示，而不是让每一行永久背负所有属性，这一点非常值得直接借。([Linear][1])

---

## 怎么执行，以及什么条件才算完成

实施时不要一次把十几个文件全改完再看效果。按下面顺序做，每一阶段都留下可运行状态：

1. **先修 P0 验收脚本。** 当前 `capture:ui` 必须变成可重复运行；Planner drag/resize 单独进入 `smoke:plan-interactions`。只有这个阶段通过以后，才开始视觉修改。

2. **建立 before baseline。** 当前项目已经提供 `typecheck/test/build/capture` 等脚本。 Windows 上建议直接复用 CI 的 packaged 流程：

   ```powershell
   npm ci
   npm run typecheck
   npm test
   npm run verify:ui-contract
   npm run package

   $env:EYEPROTECT_DATA_DIR="$pwd\.tmp\ui-h1-baseline"
   $env:EYEPROTECT_SMOKE="1"

   $p = Start-Process `
     -FilePath ".\release\win-unpacked\EyeProtect.exe" `
     -ArgumentList "--remote-debugging-port=9333" `
     -PassThru

   npm run smoke:running -- 9333
   npm run smoke:experience -- 9333
   npm run capture:ui -- 9333 artifacts/ui-h1-before

   Stop-Process -Id $p.Id -Force
   ```

3. **只做 P1，清理 CSS authority。** 暂时不要改 React 结构。改完以后再次跑 `typecheck → test → verify:ui-contract → build`，同时确认当前截图**视觉上基本不变**。如果清理 legacy CSS 就导致界面明显变化，说明我们找到了过去隐藏的 cascade dependency，要先明确迁移哪条规则，而不是继续往上覆盖。

4. **做 P2 + P3。** 先把 Sidebar/Toolbar/Today/Task Row 做成最终密度，再改 Task Detail。TaskDetail 这一轮只允许改 JSX 组织和 CSS，不重构保存队列、revision guard、command 调用。这样可以把 UI 风险和数据一致性风险完全隔开。

5. **最后做 Plan + Project。** Planner 每一次 CSS 改动后都运行真实 packaged interaction smoke，因为它有 drag、resize、container query，最容易出现“截图正常但交互坐标错了”的情况。Project 则同时验 List、Board、横向 Board scroll 和 section drag。

6. **最终验收不要只看一张 1440px 截图。** `capture-ui-snapshots.mjs` 应扩成至少覆盖：960×600、1280×720、1440×900；Light/Dark；Comfortable/Compact；Today、Task Detail、Command Palette、Plan、Project List、Project Board。Windows scale-factor 的 100%/125%/150% 也必须重新进入 CI，而不能再因为前序 snapshot failure 被跳过。现有截图脚本已经具备 viewport、layout overflow、theme contrast、focus 和真实 CDP screenshot 基础，可以直接扩展。

最终 Gate 我会定得比较硬：

**页面级横向滚动必须为 0，只有 Project Board 自己允许横滚；Plan 日期条不能再出现可见 scrollbar；960px 下 Planner 首屏应该同时看到待安排区和时间线；SideSheet 不能裁切控件；hover 隐藏的操作必须能通过 keyboard focus 显示；Light/Dark 的 primary/secondary 文本继续满足 contrast contract；forced-colors 和 reduced-motion 继续通过；所有现有 410 个测试必须零回归。**

完成这一轮后，我预期 EyeProtect 的变化不会是“突然变得花哨”，而是更接近成熟生产力软件：**背景更中性、绿色更稀缺、容器更少、任务更像任务而不是卡片、详情更像属性面板而不是设置页、Planner 在正常桌面尺寸下真正有专业时间规划工具的空间结构。** 更重要的是，我们是在保留当前已经稳定下来的任务领域模型和 runtime hardening 的前提下完成这些变化，后续即使再继续做搜索、过滤、更多 Project View，也不需要重新推倒这一层。

[1]: https://linear.app/docs/display-options "https://linear.app/docs/display-options"
[2]: https://linear.app/docs/peek "https://linear.app/docs/peek"
