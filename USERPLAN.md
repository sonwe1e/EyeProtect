[![Digital Planners That Sync With Google Calendar: 2025’s Top Picks - Akiflow](https://images.openai.com/static-rsc-4/zmQecCBJvzzjPilphvtivbO1lIy34i1EMHTVkCJpeAJ_hdaPbx5ptZPuOtJVJVtN6VNbjEw3kAE88SktMbECRIIzjJDWHpw6G-_0_TpPjhbFvI8jYOItTR2WLCOoyw634ggYcpJeOQZ_wt3T-FvydWnrWM5LpMFFcLZ27od3yLQ?purpose=inline)](https://akiflow.com/blog/best-digital-planners-sync-google-calendar?utm_source=chatgpt.com)

## 核心结论

我建议 **不要继续修补现有 Workbench 的视觉样式，而是把 1.2 的 UI 层视为一次重建**。保留业务能力、Command Layer、Scheduler、SQLite 等后端成果，但重新建立 Design System、AppShell、导航、任务视图和视觉验收体系。

当前分支我重新确认到 HEAD `ff204a3fff9a19addaa2e2b49a5464dc992dac65`。这个提交已经开始解决上一轮的 silent mutation，加入了 `CommandButton / useCommand / AppHealth`，方向是对的；但它**没有解决视觉架构本身的问题**。

而且现在甚至不能把这个 HEAD 当作“可发布基线”：最新 Windows CI 中 Typecheck、Test、Build、Windows packaging 都通过，但 **Packaged application smoke 失败**，后续 emergency/pet smoke 和 artifact upload 被跳过。 当前 smoke 在打开 Collection 后只固定等 500ms 就检查 `.collection-page`，本身也带有明显竞态风险；究竟是测试竞态还是 Workbench navigation/load 的真实回归，应通过可重复实验判定，而不是直接把 delay 改大。

我建议 1.2 的视觉目标明确成：

> **Quiet Focus / Calm Productivity**
> 大面积中性表面 + 一个品牌色 + 极少量语义色；任务是主体，颜色不是主体；桌宠是唯一允许明显活泼的视觉区域。

参考成熟产品时，只吸收交互结构，不复制外观。Todoist 当前 Today 强调“今天真正要完成什么”，Task View 将任务属性集中到一个详情视图；Board 通过 section 表达项目阶段。([Todoist][1]) Sunsama 和 Akiflow 值得吸收的是 Task 与 Calendar/Timebox 的关系，以及 planned workload，而不是它们的具体皮肤。([Sunsama User Manual][2])

---

# 一、视觉根因审计：为什么现在图标颜色和整体风格会失控

这次五个独立审查视角得到的核心结论一致：**颜色异常是 Design System 架构问题，不是一个 `.svg { color }` 小 bug。**

### 1. Token 系统与真实 CSS 已经脱节

当前 `tokens.css` 很小，只定义了一部分基础颜色；深色模式主要改变文字和 surface。与此同时，Renderer 仍背着一个约 **70KB 的单体 `styles.css`**。

结果就是：

```text
理论：
Component → semantic token → theme

实际：
Component → feature CSS → #217a70 / #fff / #f7f8f4 /
                       #c0392b / #bd5176 / ...
```

这意味着换 Theme 只能改变“部分页面”。

其他地方仍然生活在 Light Theme。

---

### 2. Sidebar 图标被 CSS 全部强制刷成同一个绿色

现在有：

```css
.nav-item svg {
  color: #217a70;
}
```

而 Lucide 图标通常使用 `stroke="currentColor"`，所以父级/自身 `color` 正是它的 stroke 来源。([Lucide Studio][3])

也就是说：

```text
Today      绿色
Inbox      绿色
Upcoming   绿色
Overdue    绿色
Away       绿色
Completed  绿色
Projects   绿色
Settings   绿色
```

激活、未激活、普通、异常基本没有视觉语义区别。

正确方式应该是：

```text
Inactive Nav
icon + text = secondary foreground

Hover
icon + text = primary foreground

Selected
icon + text = brand foreground
background = brand subtle

Danger
仅危险操作使用 danger

Warning
仅异常状态使用 warning
```

**Icon 不应该自己决定颜色。Component state 才应该决定颜色。**

---

### 3. 当前主品牌绿在 Dark surface 上甚至存在实际对比度问题

当前：

```text
accent       #217a70
dark raised  #222d2a
```

按 WCAG 相对亮度公式计算，对比度约：

**2.76 : 1**

而有信息含义的 UI component / graphical object 要求至少约 3:1；W3C 还特别指出细线型图标由于抗锯齿，实际视觉对比可能比颜色数值计算更弱。([W3C][4])

因此用户说“图标颜色异常”，至少有一部分是能够从代码和对比度计算中解释的。

---

### 4. 彩色 Emoji 与 Lucide 混合是另一个明显的不协调来源

Workbench 顶部现在直接写：

```tsx
<span>👁 ...</span>
<span>🚶 ...</span>
```

而 Sidebar 和其他按钮则使用 Lucide。

这会形成：

```text
Windows 彩色系统 Emoji
+
2px monochrome Lucide
+
10px priority dot
+
Project 自定义 RGB
+
Character procedural SVG
```

五套不同的图形语言。

1.2 应规定：

**产品 Chrome 内彻底禁止 Emoji 图标。**

改为：

```tsx
<Eye />
<Footprints />
```

Emoji 可以出现在用户内容、桌宠对白等地方，但不能作为系统导航语言。

---

### 5. Native form icon 很可能正是另一类“颜色异常”

`App.tsx` 会设置：

```ts
document.documentElement.style.colorScheme = ...
```

所以 Chromium 原生的：

* `datetime-local`
* `select`
* checkbox
* date picker indicator

会按照 color-scheme 调整自身绘制。

但现有 CSS 又强制：

```css
background: #f7f8f4;
color: #1f2a2e;
```

给 datetime/select 使用。

于是 Dark Theme 很容易形成：

> Dark UA icon + Light hard-coded field
> 或者另一种 UA/theme 混搭。

1.2 应统一处理：

```css
:root[data-theme="light"] {
  color-scheme: light;
}

:root[data-theme="dark"] {
  color-scheme: dark;
}
```

同时所有 Input/Select 背景必须来自 semantic token。

不能一边要求 Chromium Dark，一边自己把 Input 画成 Light。

---

### 6. BrowserWindow 自己也不理解 Theme

Workbench 创建时仍然：

```ts
backgroundColor: '#f7f2e8'
```

用户选择 Dark Theme 后：

```text
Window native background = cream
Renderer             = dark
```

冷启动、renderer reload、窗口 resize/paint 时都可能短暂看到不一致背景。

应根据：

```text
settings.theme
+
nativeTheme.shouldUseDarkColors
```

解析真正的 Window background。

---

### 7. Collection 与 Workbench 像两个产品

Collection 当前同时存在：

* 深绿色 gradient hero；
* 24px 大圆角；
* pink favorite；
* light-red danger hover；
* 大面积 character illustration。

而 Workbench 是：

* 奶油背景；
* 白色任务卡；
* teal icon；
* dense form；
* 大量小控件。

Character 可以活泼。

**但活泼应该被限定在 illustration layer，而不是让它重新定义整个页面 UI。**

---

### 8. Project Color 目前也被当成装饰色使用

项目创建直接从：

```text
teal
orange
red
blue
purple
green
```

这一组硬编码 palette 分配颜色。

1.2 我建议借鉴一种更克制的原则：

> Project Color 只用于识别，不用于渲染整条任务。

例如仅显示：

```text
● Research
```

或者 TimeBlock 左边 3px accent rail。

这样有十个项目时，整个 Task List 不会变成彩虹。

---

# 二、UI 2.0：直接换一套视觉和信息架构

我推荐的新 Workbench 不再默认三栏。

当前永久：

```text
Sidebar + Task list + 320px Task Detail
```

会让内容区长期受压。

改为：

```text
Sidebar + Workspace

Task Detail = 按需出现的 Side Sheet
```

### 新导航

```text
┌──────────────────────┐
│ EyeProtect           │
│                      │
│  ☀  今天             │
│  ↓  收件箱       3   │
│  ▦  计划             │
│  ◎  专注             │
│  ▣  项目             │
│                      │
│ ──────────────────── │
│  🔔 独立提醒          │
│  ◇  公仔收藏          │
│  ⚙  设置             │
└──────────────────────┘
```

实际代码全部使用 Lucide，上面的字符仅是 wireframe。

**Overdue、Away、Completed 不再霸占一级导航。**

Overdue：

```text
今天
└─ 3 件需要重新安排
```

Away：

```text
Task context = away
```

Completed：

```text
Review / Project history
```

---

## Today

这是 1.2 最重要的页面。

```text
┌─────────────┬───────────────────────────────────────────────┐
│             │ 今天 · 8月10日                    👁 18m  🚶42m│
│ 今天        │                                               │
│ 收件箱   3  │ ┌───────────────────────────────────────────┐ │
│ 计划        │ │ NOW                                       │ │
│ 专注        │ │                                           │ │
│ 项目        │ │ 修改论文                                  │ │
│             │ │ 38 / 60 min                               │ │
│ Research    │ │                                           │ │
│ Personal    │ │ [继续专注]                                │ │
│             │ └───────────────────────────────────────────┘ │
│             │                                               │
│             │ 今天最重要                                    │
│             │ ○ 修改 Figure 4                       60m     │
│             │ ○ Edge Benchmark                      90m     │
│             │ ○ 回复导师                            15m     │
│             │                                               │
│             │ 之后                                          │
│             │ ○ 整理训练记录                        30m     │
│             │ ○ 购买咖啡豆        Personal          15m     │
│             │                                               │
│             │ ⚠ 2 件昨天留下的任务          [重新安排]       │
└─────────────┴───────────────────────────────────────────────┘
```

注意这里没有：

* 三个 permanent Filter；
* Status Select；
* Up / Down；
* 一堆 metadata icon；
* 永久 Task Detail。

**默认屏幕只告诉用户应该做什么。**

Todoist 当前 Today 也明确围绕“今天安排的任务”和最重要的少数任务组织，而不是默认暴露全部数据库字段。([Todoist][1])

---

## Plan

这是 EyeProtect 1.2 真正应该大幅投入的页面。

```text
┌────────────┬──────────────────────┬─────────────────────────┐
│            │ 未安排               │ 今天                    │
│            │                      │                         │
│            │ 修改论文       60m   │ 09:00                   │
│            │ Benchmark      90m   │                         │
│            │ 回邮件         20m   │ 10:00 ┌──────────────┐ │
│            │                      │       │ 修改论文 60m │ │
│            │                      │       └──────────────┘ │
│            │                      │                         │
│            │                      │ 11:10  ── 护眼预测 ──    │
│            │                      │                         │
│            │                      │ 13:30 ┌──────────────┐ │
│            │                      │       │ Benchmark    │ │
│            │                      │       └──────────────┘ │
│            │                      │                         │
│            │                      │ 计划工作 5h20m           │
│            │                      │ 可用时间  6h             │
└────────────┴──────────────────────┴─────────────────────────┘
```

Task 可以拖进时间轴。

Sunsama 当前也是用 planned time 形成每日 workload，并支持把 Task 直接 drag/drop 到 calendar 形成 timebox；Akiflow Today 也支持把当天任务直接拖入 Calendar。([Sunsama User Manual][5])

EyeProtect 的差异化是额外显示：

> **预计健康休息占用**

而不是假设人能连续工作 7 小时。

---

## Focus

点击“开始”以后应该进入真正的 Focus Surface：

```text
                    Research

                    修改论文


                     38:42
                  已工作 / 60m


                  下一次护眼 11m


              ✓ 整理实验结果
              ○ 修改 Figure 4
              ○ 完成 Conclusion


         [暂停专注]       [完成任务]


              EyeProtect · 安静工作中
```

Sidebar、Filters、统计、Collection 全部消失。

休息结束后：

```text
休息完成

刚才正在：
修改论文

已完成 48 / 60 分钟

[继续修改论文]

[选择下一项]
```

这里才能真正完成：

**Focus → Rest → Resume**

---

## Project

不要再只是“按 projectId 过滤 Task”。

默认：

```text
Research

完成插帧论文实验并投稿

██████████████░░░░  71%

[List] [Board]

Next
────────────────────────────
○ Edge device benchmark   P1
○ 修改 Figure 4
○ 写 Discussion

Experiments
────────────────────────────
✓ Baseline
✓ Loss comparison
○ Mobile benchmark

Paper
────────────────────────────
○ Figure
○ Discussion
○ Proofread
```

Board：

```text
BACKLOG        NEXT          DOING        DONE

Task           Task          Task         Task
Task           Task                       Task
```

Todoist 的 Board 也是以 Section 作为列，并允许 task 在阶段之间拖动，这是值得吸收的项目模型。([Todoist][6])

---

# 三、全新的视觉系统

我会直接删除“warm cream + teal everywhere + 彩色状态散落各处”的逻辑。

推荐初始 palette：

| Semantic token  | Light     | Dark      | 用途    |
| --------------- | --------- | --------- | ----- |
| `bg.app`        | `#F7F8F6` | `#111614` | 应用背景  |
| `bg.sidebar`    | `#F1F3F1` | `#141A17` | 导航    |
| `surface`       | `#FFFFFF` | `#171D1A` | 主表面   |
| `surface.hover` | `#F3F5F3` | `#202823` | hover |
| `fg.primary`    | `#1B211F` | `#ECF1EE` | 正文    |
| `fg.secondary`  | `#66706C` | `#A7B2AC` | 次要信息  |
| `brand`         | `#2E6F61` | `#7FC1A6` | 品牌/选择 |
| `danger`        | `#B4473D` | `#E58C84` | 危险操作  |

这里不是为了漂亮随便选色。我做了基础 contrast 校验，例如：

```text
Light primary / app     ≈ 15.35 : 1
Light secondary / app   ≈  4.81 : 1
White / Light brand     ≈  5.89 : 1

Dark primary / app      ≈ 16.00 : 1
Dark secondary / app    ≈  8.36 : 1
Dark brand / app        ≈  8.78 : 1
```

后续仍必须通过自动化 contrast gate，而不是靠肉眼。

### Icon 规范

整个产品只保留一种系统图标库：**Lucide**。Lucide 本身支持统一修改 color、size 和 stroke width。([Lucide][7])

统一规定：

```text
Navigation     18px / 1.8 stroke
Toolbar        18px
Inline meta    14px
Task action    16px
Empty state    28px
```

颜色永远：

```css
.icon {
  color: currentColor;
}
```

绝对禁止重新出现：

```css
.nav-item svg {
  color: #217a70;
}
```

颜色由父状态控制。

项目颜色只允许进入：

```text
ProjectDot
TimeBlock accent
Board column hint
```

不得修改：

```text
task title
system icon
navigation icon
body text
```

---

### 控件尺寸

W3C 2.5.8 的 AA 基线是 24×24 CSS px，增强目标为 44×44。([W3C][8])

EyeProtect Desktop 自己采用更高的内部标准：

| 控件                        |       1.2 |
| ------------------------- | --------: |
| Icon button               |     36×36 |
| 高频/关键操作                   |    ≥40×40 |
| Nav row                   |      44px |
| Task row                  |     ≥44px |
| Primary button            | 40px high |
| Checkbox visible glyph    |      18px |
| Checkbox clickable hitbox |      36px |

所以视觉上 checkbox 仍然可以很轻。

但是用户不用精准射击 18px 小圆点。

---

### Shape / Shadow / Typography

圆角只保留三个等级：

```text
6px   small control
10px  button/input/card
14px  dialog/sheet/hero
```

不再随页面出现：

```text
5 / 6 / 8 / 10 / 14 / 18 / 22 / 24...
```

普通 Task/Card **不使用阴影**，靠 surface + 1px border 分层。

只有：

* Dialog
* Popover
* Side Sheet
* Toast

允许 elevation。

字体改成：

```css
font-family:
  "Segoe UI Variable",
  "Segoe UI",
  "Microsoft YaHei UI",
  system-ui,
  sans-serif;
```

让数字、计时和 Windows chrome 更协调，中文由雅黑正常 fallback。

---

### Collection 成为“受控的活泼区域”

Collection 可以更丰富。

但形式改成：

```text
neutral UI
+
colorful character
```

而不是：

```text
colorful UI
+
colorful character
```

今日来访可以是：

```text
┌─────────────────────────────────────────┐
│                                         │
│            [ Character ]                │
│                                         │
│  今天遇到了 Momo                        │
│  喜欢偶尔提醒你看看远处                 │
│                                         │
│  [收下它]            这次先不了          │
└─────────────────────────────────────────┘
```

角色自己成为视觉焦点。

背景无需深绿色大渐变。

---

# 四、修改方案与质量验收

我会把这次工作拆成下面五个**独立验证阶段**。当前环境不能真的创建并行 subagent，所以这里对应的是五套彼此独立的审查/实施上下文；后续实际执行时也应保持这种边界。

1. **Architecture / root-cause investigation。** 第一件事不是写新 CSS，而是先修到当前 HEAD 的 packaged smoke 完全绿；目前 CI 明确卡在 packaged application smoke。 随后生成视觉债务 inventory：所有 raw hex/rgb、全局 SVG selector、emoji chrome、native form、project color、light/dark computed style。建立 `semantic tokens → primitive → feature` 三层设计体系。现有 70KB `styles.css` 不作为新 UI 的继续演进基础。

2. **Implementation。** 新增 `theme.css / primitives/`，并以 CSS Modules 拆分页面。新增 `Button、IconButton、NavItem、Field、Select、DateTimeField、StatusChip、Dialog、SideSheet、Toast、ProjectDot`。`CommandButton` 不再自己形成第二套视觉系统，而是复用统一 Button primitive，只提供 command state。重做 `WorkbenchView.tsx` 为新的 AppShell；去掉 Emoji 和六个一级 Smart View。重做 Project 创建为 Dialog；TaskDetail 改 SideSheet。`windows.ts` 改成 theme-aware BrowserWindow background。`package.json` 目前也没有 Windows 品牌 icon 配置，应同时补齐 `.ico` 和 builder 配置。

3. **Independent correctness review。** 不看实现者的“设计意图说明”，直接从构建后的页面做 computed-style 审计。必须验证每个 icon 的最终 `color/stroke/fill`、light/dark/system 三主题、Button 所有状态、错误状态、键盘焦点、禁用状态。特别检查 `datetime-local/select/checkbox`，避免 `color-scheme` 与自定义 background 再次冲突。任何重要图标的实际 contrast 不低于 3:1，并预留余量，不以刚好 3.00 为目标。([W3C][4])

4. **Regression / edge-case review。** 测试矩阵至少覆盖 Light / Dark / System、1280×720 / 1920×1080 / 2560×1440、100% / 125% / 150% / 200% scale、Windows High Contrast / `forced-colors`、keyboard-only、reduced-motion、超长中文任务/项目名、空数据、1000+ tasks、DB read-only、Notification unavailable、renderer reload。所有 drag 行为必须同时提供非 drag 的可操作路径，因为 WCAG 2.2 也要求 dragging 功能存在单指针替代方式。([W3C][9])

5. **Final verification。** CI 增加 `verify:ui-contract`、真实 UI E2E、visual snapshots 和 packaged E2E。现在 CI 虽然会启动真正的 `EyeProtect.exe`，但 smoke 仍大量直接通过 `window.eyeProtect.*` 操作后台，再检查 DOM；例如 Collection 入口就是 API 调用后固定等待再查 selector。 1.2 必须增加真实 pointer/key 路径：点击“公仔收藏”→点击“收下它”；点击“新建项目”→输入→确认；创建 Task→Plan→Focus→Break→Resume。发布条件不是“DOM 存在”，而是完整用户旅程全部成功。

建议同时加一个机器可执行的 `verify-ui-contract`，Release 直接禁止：

```text
Renderer feature CSS 中新增 raw hex/rgb
全局 svg { color: ... }
产品 chrome 使用 Emoji 代替系统 icon
低于内部 hit-target 标准
Dark theme 中出现 light-only surface
Command mutation 没有 pending/error feedback
```

并把 visual regression 截图作为 CI artifact：

```text
today-light-100.png
today-dark-100.png
today-dark-150.png
plan-light.png
plan-dark.png
focus-light.png
focus-dark.png
project-list.png
project-board.png
collection.png
settings.png
reminder.png
```

最终我会把 **1.2 UI 重构本身设为 release blocker，而不是 polish task**。当前 Command Layer 的修复值得保留，但视觉上不应该继续继承现在这套“70KB 全局 CSS + 少量 tokens + 每个 feature 自己上颜色”的结构。最优先的顺序应该是：

**先让当前 CI 基线恢复全绿 → 建立 Design System → 重建 AppShell/Today → Plan/Focus → Projects → Collection/Settings → 真正用户操作 E2E + visual regression。**

这条路线的目标不是单纯“看起来更现代”，而是让颜色、图标、交互状态、信息层级、Dark Theme 和 Windows DPI 全部成为**可机器验证的产品契约**，从工程上阻止现在这类“不协调 UI”重新长回来。

[1]: https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs?utm_source=chatgpt.com "Plan your day with the Today view"
[2]: https://help.sunsama.com/docs/usage-guides/timeboxing/?utm_source=chatgpt.com "Timeboxing — Sunsama User Manual"
[3]: https://studio.lucide.dev/edit?branch=studio%2Ffix-cog-icons&dialog=false&name=folder-cog&value=%3Cpath+d%3D%22M13.5+8h-3%22+%2F%3E%3Cpath+d%3D%22m15+2-1+2h3a2+2+0+0+1+2+2v14a2+2+0+0+1-2+2H7a2+2+0+0+1-2-2V6a2+2+0+0+1+2-2h3%22+%2F%3E%3Cpath+d%3D%22M16.899+22A5+5+0+0+0+7.1+22%22+%2F%3E%3Cpath+d%3D%22m9+2+3+6%22+%2F%3E%3Ccircle+cx%3D%2212%22+cy%3D%2215%22+r%3D%223%22+%2F%3E&utm_source=chatgpt.com "Lucide Studio"
[4]: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast?country=255&utm_source=chatgpt.com "Understanding Success Criterion 1.4.11: Non-text Contrast | WAI | W3C"
[5]: https://help.sunsama.com/docs/usage-guides/tasks/planned-and-actual-times/?utm_source=chatgpt.com "Planned and Actual Times — Sunsama User Manual"
[6]: https://www.todoist.com/help/articles/board-layout-in-todoist-nutzen-AiAVsyEI?utm_source=chatgpt.com "Use the board layout in Todoist"
[7]: https://lucide.dev/?utm_source=chatgpt.com "Lucide"
[8]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum?utm_source=chatgpt.com "Understanding Success Criterion 2.5.8: Target Size (Minimum) | WAI | W3C"
[9]: https://www.w3.org/TR/WCAG22/?utm_source=chatgpt.com "Web Content Accessibility Guidelines (WCAG) 2.2"
