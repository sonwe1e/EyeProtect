# EyeProtect 静谧编辑部视觉设计规格

## 目标

将 EyeProtect 的全套用户可见界面统一为“静谧编辑部（Quiet Editorial）”视觉语言：适合长时间阅读和工作，具有 shadcn/ui 与 coss/ui 的克制组件感，吸收 Beautiful UI、beUI、Rare UI、ReUI 的精致状态反馈与组件层级，并采用 transitions.dev 与“你不需要动画”文章所倡导的克制动效。

这次改造的重点是视觉一致性、信息层级和交互反馈，不改变应用的数据、调度或窗口行为。

## 参考提炼

- **shadcn/ui / coss/ui**：中性基础色、可组合 primitives、细边框、明确的控件层级和可访问默认值。
- **Beautiful UI / beUI / Rare UI / ReUI**：把状态、加载、完成、错误、选择和浮层当作组件的一部分；反馈短、明确、有方向，而不是用装饰覆盖信息。
- **transitions.dev**：进入/退出、尺寸变化、图标切换和状态交换使用短时、可预测的过渡；动效服务于状态理解。
- **UI Skills / Design System Checklist**：令牌集中管理、响应式和命中区先于装饰，主题、键盘、强制颜色模式和 reduced-motion 必须有完整降级。
- **Emil Kowalski 的动画原则**：静态界面不持续运动；优先使用 opacity、transform 和状态变化，避免会疲劳或分散注意力的循环动效。

## 范围与非目标

### 覆盖范围

统一以下 renderer 表面：

- Workbench 外壳、侧栏、导航、项目列表、toolbar、command palette、Today、Inbox、任务行、任务详情。
- 项目总览、项目列表/Board、Plan backlog/timeline、每日规划、Focus、Daily Review。
- Settings、Standalone Reminders、Collection。
- Pet、Alert、Bubble 和相关浮层（Dialog、SideSheet、Toast）。

### 非目标

- 不修改 `src/shared/types.ts`、IPC channel、command layer、任务/提醒调度、数据库和窗口生命周期。
- 不引入 Tailwind、Motion、Framer Motion 或新的组件库。
- 不重排产品信息架构，不新增业务字段，不替换程序化角色和提醒 artwork。
- 不将所有内容改成玻璃效果、彩色渐变或持续动画（例外：Alert 与 Bubble 两个窗口使用玻璃材质，见「玻璃材质」小节）。

## 视觉基础

### 语义令牌

继续使用现有令牌名称，令牌的唯一颜色权威仍是 `src/renderer/src/styles/theme.css`。令牌调整后的方向如下：

- 浅色主题：暖灰纸张背景、近黑主文字、低饱和鼠尾草绿品牌色；表面之间以亮度和细边框区分。
- 深色主题：墨绿色黑底、低亮度表面、柔和鼠尾草绿；避免纯黑底、纯白大面积文字和荧光色块。
- `brand` 只用于主要动作、当前状态、专注和健康语义；`warning` 只用于临近截止或需要注意；`danger` 只用于失败、逾期、删除和破坏性操作。
- 普通内容卡片只使用 `border-subtle`；只有真正浮起的 Dialog、SideSheet、Toast 使用阴影。
- 不在组件 CSS 中增加裸 `#hex`、`rgb()` 或 `rgba()` 颜色。

### 几何、排版与密度

- 以单一的小/中/大圆角尺度覆盖控件、容器和浮层；状态 chip 继续使用胶囊形。
- 标题采用紧凑字距和明确重量，正文提高行高；eyebrow 只表达日期、状态和区块上下文。
- Workbench 页面维持舒适的桌面密度；任务行和主要交互保持至少 44px 命中区。
- 间距沿用 `tokens.css` 的离散 scale，页面区块之间使用稳定的垂直节奏，不靠额外卡片制造层级。
- 图标继续使用 Lucide，图标尺寸按“导航/控件/装饰”三档统一，避免同一语义在不同表面大小漂移。

## 页面与组件设计

### 共享 primitives

`primitives.css` 是统一控件表现层：

- Primary、secondary、ghost、danger 按钮具有可预测的填充、边框、hover、disabled 和 focus 状态。
- 输入框、select、textarea 使用同一高度、边框、焦点环和错误边界；placeholder 不承担主要信息。
- StatusChip、ProjectDot、Toast、Dialog、SideSheet 和 Command Palette 使用统一 surface 与层级。
- 成功、失败、进行中状态由颜色、文本或图标共同表达，不只依赖颜色。
- 保留 forced-colors 下的可见边框和选中轮廓。

### Workbench 外壳

- 侧栏成为安静的 navigation rail：品牌区、主导航、项目区、辅助导航之间有清晰分隔，但不增加厚重背景。
- 活动导航项使用中性 selected surface 与窄品牌色指示线；hover 只抬升一个表面层级。
- Toolbar 作为轻量 command bar：搜索入口、快捷键提示、连续活跃时间和暂停/恢复提醒按重要性排列。
- workspace 使用受控阅读宽度和稳定页面顶部留白；窄 workspace 继续采用固定内边距而非页面级横向滚动。

### Today、Inbox 与任务

- 页面标题和日期作为阅读锚点，描述文字承担上下文，不增加无意义的 hero 装饰。
- `now-card` 是窄状态条，突出当前任务和继续专注动作；不扩展为大面积营销式卡片。
- TaskComposer 保持“标题 + 提交”单层快速路径；展开字段放进一个有边界的辅助面板。
- 任务列表保持无卡片堆叠的行式布局：hover、选中、完成、拖拽目标、优先级和操作控件有独立可见状态。
- 任务元数据保持低对比度但满足主动阅读对比度；逾期、重要、紧急和当前任务使用语义色。
- Task Detail 继续使用 SideSheet，以平面属性行和轻量 chip 组织信息，避免控件层层嵌套。

### Projects、Plan 与 Planning

- 项目总览卡片使用统一的 surface/border/progress 结构，进度条保持轻量。
- Project Board 的横向轨道由 Board 自己滚动；列、任务卡和操作区域使用同一套圆角和状态反馈。
- Plan 保留 backlog + timeline 双栏，在窄 workspace 堆叠；时间块、健康标记和拖拽状态通过边框、背景和文字共同表达。
- 每日规划步骤使用一致的 section shell，重点放在当前步骤、容量和动作，而不是堆叠强调色。

### Focus 与 Review

- Focus 空状态突出“选择一件事，安静地开始”；活动状态只突出任务、计时器、护眼提示和主要动作。
- 沉浸模式隐藏侧栏和 toolbar，但保留明显的返回入口、键盘 Esc 提示和状态上下文。
- Review 将统计、任务明细和检查点作为连续纵向区块；统计卡只承担数字和标签，不使用彩色装饰抢夺任务明细的注意力。
- 数字和时间使用 tabular numerals，完成率和健康状态保持语义色的一致性。

### Settings、Reminders 与 Collection

- Settings 继续使用分区结构，每个分区统一包含标题、说明和控件组；模式卡、开关、数字字段和 data actions 使用共享控件规则。
- 保存中、保存失败、恢复模式和危险操作必须有明确文字反馈，并保持与主要内容的视觉距离。
- Standalone Reminders 使用 compact composer + list；周期选择、日期、时间和添加动作保持清晰的输入顺序。
- Collection 将“今日来访”作为一个有明确舞台和文案的 featured surface，角色网格作为次级内容；不改变角色生成、收藏和切换行为。

### Pet、Alert 与 Bubble

> **修订说明（2026-09-11）**：提醒窗与气泡改用玻璃材质，这是**刻意突破**本规格原先「不将所有内容改成玻璃效果、彩色渐变或持续动画」的限制。破例只覆盖 Alert 与 Bubble 两个窗口，理由与约束见下方「玻璃材质」小节；Workbench 侧仍然禁止玻璃与彩色渐变。除此之外的原始条款继续有效。

- 桌宠继续保持透明、可拖动和低干扰；工具按钮使用小型浮层控件，hover 显示，不遮挡角色主体。
- Alert 采用「公仔坐在倒计时环内」的构图：环形本身是本次休息唯一的进度指示，倒计时读数以胶囊形式骑在环的下缘，既不与公仔争夺环心，又保证一眼可读。
- Alert 的下方依次是类型徽标、标题、说明、分步指引与动作区。分步指引只展示**当前正在进行的那个活动**，并在末尾预告下一个活动；把两个活动的全部步骤同时铺开会把面板推入不必要的滚动。
- Alert 的动作区有明确主次：主操作独占一行并占据满宽，次要动作（稍后提醒 / 跳过）降级为下一行。
- Bubble 与 Alert 共用同一套玻璃材质与强调色，是它的紧凑版：类型徽标 → 环形倒计时 + 标题 → 当前步骤 → 主操作 + 稍后/跳过。gentle 模式提醒与预提醒都在气泡内呈现。
- artwork 的既有动画仅在提醒动作语义需要时保留；静止状态不新增循环装饰。

### 玻璃材质

- 令牌集中在 `theme.css`：`--glass-panel`、`--glass-panel-floor`、`--glass-highlight`、`--glass-hairline`、`--glass-wash`、`--glass-shadow`。
- 卡底刻意接近不透明（94%）。提醒窗浮在用户桌面上，透明度再高一点，文字对比度就会随用户壁纸变化；「玻璃感」由模糊、顶部高光与卡内色晕共同构成，而不是靠透出壁纸。
- `--glass-panel-floor` 是卡底合成到纯黑 / 纯白壁纸后的最坏情况取值，`verify:ui-contract` 用它校验正文对比度，因此壁纸不再是一个不可验证的变量。
- 玻璃面上的文字只允许 `--fg-primary` 与 `--fg-secondary`。`--fg-tertiary` 在最坏情况下只有 4.30:1，不得用于半透明面板。
- 色晕（`.rest-orb`）限制在卡片的顶部舞台带内，绝不位于正文背后。
- 类型强调色（`--rest-accent-*`）保持装饰性：舞台辉光、环描边、徽标圆点、步骤标记。步骤序号用强调色描边而非填充，因为走动色对白字只有 4.39:1。
- `forced-colors` 下玻璃退化为纯色面板并关闭 `backdrop-filter`；`prefers-reduced-motion` 下关闭全部进出场动画。

## 动效规范

- 使用已有 `--motion-fast`、`--motion-standard` 和 `--motion-slow`，优先 140–240ms 的短过渡。
- 允许：浮层进入/退出、按钮 pending/success/error 状态、图标交换、列表选中和拖拽反馈、可见卡片的轻微层级变化。
- 禁止：页面加载时大范围飞入、持续背景动画、无用户触发的循环位移、会改变阅读位置的弹跳和 hover 3D 倾斜。
- `prefers-reduced-motion: reduce` 下关闭非必要动画；不依赖动画传达完成、错误或选中语义。
- 不为增加“高级感”而引入新的动画运行时或复杂状态。

## 工程与可访问性验收

实现必须保持：

- Renderer 只通过 `window.eyeProtect` 访问主进程。
- 所有 mutation 继续通过 command layer，错误不得静默吞掉。
- 主题、density、forced-colors、键盘 focus 和 reduced-motion 均有对应样式分支。
- 页面级横向滚动为零，只有 Project Board 保留自身横向滚动。
- 960×600 下 Plan 的 backlog/timeline 和 Task Detail 控件不被裁切。
- 主动阅读文本满足现有对比度基线，主要按钮和交互区域满足命中区要求。

## 验证矩阵

1. `npm run typecheck`：确认 renderer CSS class、组件 props 和现有 TypeScript 契约未被破坏。
2. `npm test`：确认任务、计划、提醒、设置、窗口和数据行为不回归。
3. `npm run verify:ui-contract`：确认颜色令牌所有权、主题、对比度、命中区、forced-colors、reduced-motion 和滚动契约。
4. `npm run build`：确认 electron-vite 三进程构建和 preload 输出仍正确。
5. 启动实际 Electron 应用并检查 Today、Inbox、Plan、Project、Focus、Review、Settings、Collection、Reminder、Bubble、Pet；至少覆盖浅色、深色、窄 workspace 和一个浮层打开状态。
6. 对上述界面进行截图对比，确认层级统一、文字未裁切、没有意外横向滚动，且动效不会遮挡内容。

## 完成标准

当共享令牌、primitives、所有列出的 renderer 表面均使用统一视觉语法，现有交互和窗口行为保持不变，验证矩阵全部通过，并完成实际 Electron 界面检查后，本规格视为实现完成。
