# UI 审美优化记录（参考站点 → 落地改动）

本轮工作的输入是一批现代前端 UI 参考站点。目标不是「把它们的组件搬进来」，而是把其中**可迁移的规则**提炼成 EyeProtect 自己的令牌与约束，落到现有样式层里。

参考站点分三类，它们对项目的作用完全不同：

| 类别     | 站点                                                                    | 对 EyeProtect 的价值           |
| ------ | --------------------------------------------------------------------- | -------------------------- |
| 动效规则   | emilkowal.ski（You Don't Need Animations）、transitions.dev、beUI、Rare UI | 决定**什么时候不该动**、进入/退出方向、时长上限 |
| 设计令牌体系 | ui.shadcn.com、coss.com/ui、reui.io、beautifului.dev                     | 语义令牌分层、焦点环、空状态、数据密度与数字对齐   |
| 体系完整性  | designsystemchecklist.com、ui-skills.com                               | 清单式自查（本文最后一节即按此逐项过）        |



---

## 一、动效：先做减法

Emil Kowalski 的核心论点是「最好的动画有时是不做动画」。据此对本项目做了三处**减**：

### 1. 键盘驱动的选中高亮改为瞬时

`primitives.css` 的 `.command-palette-list button` 原本有 140ms 的 `background/border/color` 过渡。命令面板的高亮由方向键驱动，一秒钟可能切换十几次，140ms 的淡入会让人感觉「高亮落后于按键」。

改动：`transition: none`。指针悬停（`onMouseEnter`）走同一条路径，因此也一并瞬时化——这是刻意的取舍。

### 2. 高频列表行取消悬停过渡

`workbench.css` 中 `.app-nav-item`（导航）与 `.task-row`（任务行）是产品内点击频率最高的两个目标。原本各自带 140ms 的背景/边框过渡。

改动：

- `.app-nav-item` → `transition: none`
- `.task-row` → 只保留 `opacity` 过渡。`is-done`（完成）与 `is-dragging`（拖拽）是**离散事件**，短淡出能说明「确实发生了」，值得保留；悬停与选中则瞬时落地。

### 3. 高频微交互缩短到 `--motion-instant`（90ms）

任务行的操作按钮（排序/删除）在悬停时淡入，用 90ms 而非 140ms。

---

## 二、动效：补上缺失的进入动画

原本只有侧滑面板有进入动画，对话框、遮罩、Toast 是「硬切」。参考 transitions.dev 与 beUI 的做法补齐，并遵守两条规则：**方向一致**、**时长 < 300ms**。

| 元素                    | 进入方式                                       | 依据                    |
| --------------------- | ------------------------------------------ | --------------------- |
| `.ui-dialog-backdrop` | 140ms 淡入                                   | 遮罩不需要位移               |
| `.ui-dialog`          | 220ms `translateY(6px) + scale(0.97)` → 原位 | 居中面板应「在原地展开」，而不是从某处滑入 |
| `.ui-toast`           | 220ms `translateY(8px) + scale(0.98)` → 原位 | 从它所在的右下角升起，退出方向与进入一致  |
| `.ui-side-sheet`      | 保持 `translateX(16px)`                      | 本来就与锚定边缘一致，仅把曲线换成令牌   |

新增三个 keyframes：`ui-fade-in`、`ui-dialog-enter`、`ui-toast-enter`，全部纳入 `prefers-reduced-motion` 关闭列表。

---

## 三、令牌层：新增缓动与按压反馈

### `tokens.css` 新增

```css
--motion-instant: 90ms;

--ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* 响应指针/按键的默认曲线 */
--ease-move: cubic-bezier(0.65, 0, 0.35, 1);  /* 两点之间的位移 */
--press-scale: 0.97;                          /* 按下反馈 */
```

在此之前，全项目的过渡只有时长、没有曲线，等于依赖浏览器默认的 `ease`——一条起步偏慢、收尾偏拖的曲线。现在 `src/renderer/src/**/*.css` 中所有 `transition` / `animation` 都显式引用缓动令牌，两处例外都是刻意保留：

- `linear`：`command-spin` 加载环、休息环的 `stroke-dashoffset`。连续旋转与线性进度用减速曲线反而不准。
- 桌宠的往复振荡动画（`pet-idle-sway` / `pet-idle-wobble` / `eyealarm-buzz`）原本是 `ease-in-out`，已改用 `--ease-move`。

### 按压反馈：`translateY(1px)` → `scale(0.97)`

`primitives.css` 原本用下移 1px 表示按下。改为 3% 缩放：位移会改变行内基线，缩放不会推挤任何邻居。同一反馈也补到了分段控件 `.segmented button`。

### 阴影改为双层

`theme.css` 原本是单层大模糊（`0 24px 64px`）。单层大模糊在浅色底上会读成灰色光晕；改成「紧贴的接触阴影 + 扩散的环境阴影」双层后才有真实的悬浮感。

```css
/* light */
--shadow-overlay: 0 2px 4px rgb(20 28 34 / 6%), 0 24px 64px rgb(20 28 34 / 16%);
--shadow-soft:    0 1px 2px rgb(20 28 34 / 6%), 0 8px 24px rgb(20 28 34 / 7%);
```

深色与 system 主题同步调整。

---

## 四、排版与数据可读性

来自 ui-skills 的 playbook 与 beautifului 的高密度数据呈现：

- `.page-header h1` → `text-wrap: balance`：标题不再出现「最后一行只剩两个字」的孤字。
- `.page-description` → `text-wrap: pretty`：正文避免孤行，但不强制平衡（长段落平衡会牺牲阅读节奏）。
- `.app-nav-count`、`.project-item-count`、`.rhythm-summary` → `font-variant-numeric: tabular-nums`。原本只有 Plan 的分钟数与项目分组计数是等宽的，现在所有「会变化的数字」都对齐，数字跳动时不再左右抖。

---

## 五、顺带修掉的缺陷

设计令牌审计（遍历全部 CSS 的 `var(--x)` 引用并比对声明）发现一个真实缺陷：

```
--surface-subtle  <- src/renderer/src/styles/workbench.css:588
```

`--surface-subtle` **从未在 `theme.css` 中定义过**。`.task-checkpoint-list li` 的 `background: var(--surface-subtle)` 因此一直解析失败、退化成透明。已改为与同级嵌套行一致的 `var(--bg-app)`（对齐 `.planning-triage-row` 的既有做法）。

审计其余 4 个「未声明」变量（`--project-color`、`--project-dot-color`、`--task-depth`、`--bubble-tail-x`）均由 TSX 内联注入，属于预期行为。

---

## 六、明确没有采纳的东西

| 参考做法                                       | 不采纳的原因                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| beUI / Rare UI 的 spring、布局共享动画（`layoutId`） | 需要引入 Motion 运行时；本项目只有 `react` + `lucide-react` 两个依赖，为一个动效引入框架不划算 |
| transitions.dev 的 shimmer / 数字滚动 / 粒子      | 属于营销页与仪表盘语汇，日常任务工具的重复使用场景下会变成干扰                                  |
| coss/ui 的 `backdrop-filter` 玻璃层            | 桌宠与提醒窗口本身是透明窗口，大面积模糊有渲染与性能风险                                     |
| 全盘换成 shadcn 的 `--radius` 派生体系              | 现有 `--radius-small/medium/large` 已被 6 个模块 CSS 与契约脚本依赖，收益不抵改动面    |

---

## 七、验收

```
npm run verify:ui-contract   # 语义色、命中区域、forced-colors、对比度
npm test                     # 482 passed
npm run typecheck            # 通过
npm run build                # 通过，verify:build 契约通过
```

契约脚本的两项约束在改动中被刻意保留：

- `tokens.css` 只允许非颜色基础令牌 → 新增的 `--ease-*` / `--press-scale` 同步登记进 `tests/design-system-contract.test.ts` 的白名单。
- `workbench.css` 禁止裸色值 → 所有新样式只引用语义令牌，未引入任何 `#hex` / `rgb()`。

## 八、自查清单（对照 designsystemchecklist）

- [x] 基础层：间距、圆角、动效、命中区域有单一来源（`tokens.css`）
- [x] 颜色：语义令牌唯一权威（`theme.css`），组件不写裸色值
- [x] 动效：有曲线令牌、有时长上限、`prefers-reduced-motion` 全覆盖
- [x] 可访问性：焦点环统一为实心 `--focus-ring`；对比度由脚本持续校验
- [ ] 待补：Toast 的退出动画（当前组件在卸载时不做退场，需要引入一层 presence 状态）
- [ ] 待补：分段控件的滑动指示器（需要 JS 测量，纯 CSS 做不到 origin-aware 位移）

---

## 第二轮：材质与一致性（coss 深度 + 活跃界面收尾）

第二轮的输入是同一批参考站点的组件级细节（coss.com/ui 的实体按钮、shadcn 的控件焦点环、transitions.dev 的深色控件处理），以及一个事实核查：`workbench-v2` 相关标记当前没有任何视图挂载，实际渲染的界面是 Pet / Bubble / Alert / Simple Workbench 四个表面。因此本轮把力气花在**活跃表面**和跨主题的材质令牌上。

### 1. 材质令牌（theme.css，三主题块同步）

```css
--inset-highlight: /* 浅色 rgb(255 255 255 / 24%)，深色 rgb(255 255 255 / 8%) */
--inset-press:     /* 浅色 rgb(23 30 35 / 10%)，深色 rgb(0 0 0 / 20%) */
--shadow-hairline: /* 浅色 0 1px 2px rgb(20 28 34 / 5%)，深色 0 1px 2px rgb(0 0 0 / 24%) */
```

coss 的实体控件依赖「顶部内高光」，但高光 alpha 不能跨主题复用：深色表面上 18–24% 的白高光读起来像一道划痕。这类随主题翻转的 alpha 值只能放在颜色权威 theme.css，组件层禁止自行硬编码。`--inset-press` 是按住时替换高光的下压内阴影；`--shadow-hairline` 是静止控件的一层微抬升。此前散落在 `workbench.css`（brand mark、task-composer）、`settings.css`（status-item）、`styles.css`（standalone-composer）的 `fg-inverse` 高光全部换成令牌，深色主题自动减淡。

### 2. 实体按钮（coss 深度配方）

`.ui-button--primary`、`.rest-primary`、`.bubble-actions .primary`、simple 工作台的 `button.primary` 统一为：

- 静止：`inset 0 1px 0 var(--inset-highlight)` + 品牌色着色接触投影（`--brand-strong` 26%）。
- 按住：缩放 `--press-scale` 之外，高光**换成** `--inset-press`——表面读作「被按进去」，而不只是变小。
- primitives 的禁用态从 0.48 提到 0.55：填充品牌按钮 0.48 会读成渲染 bug（与第一轮 rest-primary 禁用态同一论据）。

### 3. 控件焦点与输入

- `.ui-input` / `.ui-select` 加 `--shadow-hairline` 微抬升；`aria-invalid` 聚焦时焦点环改用 danger 40% 混色，错误边界从「只有边框变色」变成边框 + 环双重表达。
- simple 工作台的输入/select/textarea 复制 primitives 的焦点配方（brand 边框 + 22% 洗色环），此前它自成一派。

### 4. Simple Workbench 整体精修（当前唯一活跃的工作台）

- **hover 与选中解耦**：旧版 `button:hover` 与 `[aria-pressed='true']` / `[aria-current='page']` 共用同一品牌浅底，「指针经过」和「这一项是当前项」无法区分。现在 hover = 中性 surface-hover；选中 = brand-subtle + brand 边框；导航当前项 = 中性 raised pill（与侧栏导航同一语法）。
- **按钮三级层次**：`button.primary`（品牌填充 + 实体材质）用于添加/保存类主动作，`button.danger`（静默红）用于删除任务，其余保持安静表面。行内 `•••` 菜单改成连体 popover（首末按钮圆角拼接、共享投影），删除项红色。
- **表单**：输入统一 38px 高、focus 环与 primitives 一致；数字/日期输入 `tabular-nums`；`<details>` 折叠去掉原生三角。
- **结构**：header 改 sticky（滚动时保持导航可达）并补品牌标识；设置分区改为安静卡片（surface + border-subtle + radius-large）；空状态、撤销条（140ms 进入淡入，离散事件反馈）、历史行统一节奏。
- **滚动条**：6px 透明轨道 + hover 显现 thumb，消除深色界面里的原生 Windows 灰轨。
- **降级**：补 `forced-colors` 分支；`prefers-reduced-motion` 覆盖全部新动画。

### 5. Pet / Bubble / Alert

- 桌宠工具栏按钮的按压从 `translateY(1px)` 统一为 `scale(--press-scale)`（第一轮定下的按压语言），并补了 hover 表面（glass-surface-strong）。
- 气泡按钮补 `:active` 按压（transform 过渡一直在，反馈却没接上）。
- rest-primary 套用实体材质配方（见上）。

### 6. 验收

```
npm run typecheck          # 通过
npm test                   # 485 passed
npm run verify:ui-contract # 通过
npm run build              # 通过，verify:build 契约通过
```

工作台/提醒界面用静态预览（`scripts/build-reminder-preview.tsx` 与 `artifacts/build-workbench-preview.mjs`，后者为临时镜像不入库）在明暗两主题下逐屏目检：导航选中态、primary/danger 层次、行内菜单、设置卡片、玻璃卡与禁用态主按钮均符合预期。

### 7. 明确没有采纳的东西（第二轮）

| 参考做法 | 不采纳的原因 |
| --- | --- |
| coss 的 `shadow-primary/24` 大面积彩色投影 | 只保留 1×2px 接触投影；大彩影在安静纸面语境里变成装饰 |
| transitions.dev 的 stagger 列表进场、数字滚动 | 任务列表是最高频 surface，进场动画只会延迟阅读 |
| 深色输入框改 `fg-inverse 3%` 半透明底 | 会破坏「控件在 surface 之上」的既有层级语义，收益只在极端壁纸上 |
| workbench-v2 的 Toast 退场 / 分段指示器 | 对应标记当前未挂载，留给 workbench-v2 复活时一并做 |
