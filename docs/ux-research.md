# 体验设计研究：桌宠 · 休息卡 · 计划

> 目的：回答「怎么把 EyeProtect 的界面、交互和动画做到让用户真正喜欢」。
> 方法：收集业界被广泛认可的参考产品与规范 → 提炼可迁移的设计原则 → 落成逐界面的改造提案与优先级。
> 基线：当前简化版体验（Pet / Bubble / Alert / 简化工作台），对应分支 `codex/simple-experience-split` 的方向。
> 配套 Demo：[docs/demo/experience-demo.html](../docs/demo/experience-demo.html)（双击在浏览器打开，无需构建）。文中以（Demo 区块 A/B/C）标注提案与演示的对应关系。

---

## 一、素材收集

### A. 休息提醒类应用

| 参考 | 核心做法 | 对 EyeProtect 的可借鉴点 |
| --- | --- | --- |
| [Stretchly](https://github.com/hovancik/stretchly)（开源 Electron 休息提醒，公认标杆，收录于 awesome-humane-tech） | ① 每次休息附带一个「休息建议」（远望、喝水、伸展），休息有内容而不是空白倒计时；② 休息开始前 10–30 秒预告，让用户收尾；③「推迟 → 跳过」两段式出口，推迟一次后解锁跳过；④ 微休息/长休息用不同主色 + 不同声音区分类型；⑤ **Break Health Mode**：跳过/推迟时屏幕边缘晕影渐深、自然完成时消退——用视觉化鼓励坚持而非惩罚；⑥ 超时后可切换「人工收尾」显示已用时长；⑦ 默认值遵循 20-20-20 人机工学 | 我们已有 ①②③（步骤、pre-alert、推迟/跳过）和按类型的 `--rest-accent-*`。值得补的是「步骤与动画同步」「完成时刻的仪式感」；Break Health Mode 的思路可弱化为回顾页里的坚持记录（见 B4，避免惩罚感） |
| [Apple Watch Breathe](https://support.apple.com/en-gb/guide/watch/apd371dfe3d7/watchos) / Headspace 呼吸引导 | 动画节奏与生理节奏同步：吸气时花瓣/圆环放大、呼气时收缩，用户跟着动画调节呼吸 | 护眼休息的「缓慢眨眼」「深呼吸」步骤可以配一个 4 秒周期的呼吸脉动环；宠物在休息期间同步「呼吸」，而不是冻住 |
| [CSS-Tricks：复刻 Apple Watch Breathe 动画](https://css-tricks.com/recreating-apple-watch-breathe-app-animation/) | 用 CSS 伪元素 + 缩放实现同款花瓣呼吸动画，纯 CSS、无 JS 帧循环 | 呼吸脉动环的最低成本实现参考 |

### B. 桌宠 / 虚拟陪伴类

| 参考 | 核心做法 | 对 EyeProtect 的可借鉴点 |
| --- | --- | --- |
| [vscode-pets](https://tonybaloney.github.io/vscode-pets/pets/)（数百万安装）与 [VS Code 官方 chat pet](https://code.visualstudio.com/docs/agents/reference/chat-pet) | 宠物对**真实事件**做反应：丢球会追、agent 开始工作会切换姿态；反应是事件驱动而非定时随机 | 宠物应挂在产品事件上：完成待办 → 小跳庆祝；番茄专注开始 → 进入姿态；久坐提醒前 → 伸懒腰「预告」 |
| [Finch 自我关怀宠物](https://www.linkedin.com/pulse/why-gamifying-self-care-virtual-pet-works-finch-heather-arbiter-gjkpe) | 完成自我关怀任务 → 小鸟获得能量成长；**从不惩罚**——漏了一天鸟不会死，只是有点难过；用户出于「看看我的鸟怎么样了」的好奇心回来，而不是被负罪感推送驱动 | 「今天休息做得好不好」可以温和地反映在宠物状态上（如收工时满足的表情），但任何跳过都不产生负面表现——无惩罚是底线 |
| [Yu-kai Chou：Pet Companion Design](https://yukaichou.com/advanced-gamification/the-pet-companion-design-in-gamification/) | 虚拟宠物赢得留存的机制是「照顾的依赖感 + 禀赋效应」：用户回来不是因为奖励，而是因为**有个东西依赖他** | 桌宠的定位应是「陪我工作节奏的伙伴」，它的动作要回应我做过的事，而不是自顾自发通知 |
| [Nathalie Lawhead：About desktop pets](https://www.nathalielawhead.com/candybox/about-desktop-pets-virtual-companions-discussing-the-inhabitants-that-fill-the-void-of-our-digital-spaces) 及 Microsoft Store「Desktop Pets」的自我描述 | 好桌宠的共同点：**填补数字空间的陪伴感，且不打扰** | 印证本项目「默认静止、低频短动作」规则的方向是对的；要加的是「活着的最小证据」：呼吸与眨眼 |

### C. 像素角色动画

| 参考 | 核心做法 | 对 EyeProtect 的可借鉴点 |
| --- | --- | --- |
| [Saint11（Pedro Medeiros）像素教程集](https://saint11.art/blog/pixel-art-tutorials/) 与 [Character Idle 专篇](https://www.patreon.com/saint11/posts/character-idle-12464240) | 待机动画动作幅度极小，常需要 sub-pixel（不足 1 像素）位移技巧；idle 是「有生命感的最小单元」 | 64 网格、整数像素的前提下：呼吸 = 身体轮廓 1 单位起伏；更细的层次用不透明度/描边表现 |
| [Slynyrd Pixelblog 8：像素动画入门](https://www.slynyrd.com/blog/2018/8/19/pixelblog-8-intro-to-animation) | idle 循环的标准做法：**2–4 帧、胸腔/躯干 1px 起伏、2–4 秒慢速循环**，再偶发眨眼 | 直接可作为 A1 提案（待机呼吸 + 眨眼）的帧规格 |
| r/PixelArt [呼吸效果讨论](https://www.reddit.com/r/PixelArt/comments/1iat3yk/breathing_effect_tutorial/) | 社区共识：「上下弹跳整个精灵」是常见错误；正确做法是胸腔局部起伏 + 慢速 | 我们的宠物是整体 SVG——呼吸应作用在躯干/头部组，而不是整体 translateY 弹跳 |

### D. 微交互与动效规范

| 参考 | 核心做法 | 对 EyeProtect 的可借鉴点 |
| --- | --- | --- |
| [!Boring：The World's Most Satisfying Checkbox](https://notbor.ing/words/the-most-satisfying-checkbox)（Apple Design Award「Delight & Fun」团队） | ① **最高频的例行动作最值得投入设计**（引用 Mario 64 的 moment-to-moment 理念）；② 大回报前要有可感知的蓄力（windup）——「每个动作都需要蓄力」；③ 常规极简主义做减法，但透明窗口/游戏感界面「屏幕拿走的，要用动画、声音、触感补回来」；④ 最好的奖励是象征性的，像手写清单上划掉一笔 | EyeProtect 的高频例行动作：打勾完成、点桌宠、点「开始休息」——这三个点是投入打磨的首位。打勾的「画勾 + 划掉」就是「象征性奖励」 |
| [NN/g：Microinteractions](https://www.nngroup.com/articles/microinteractions/) | 微交互 = 触发 → 规则 → 反馈 → 循环/模式四件套；反馈是其中最常缺失的一环 | 完成待办「当场消失、零反馈」是现状最大的缺口（见 C1） |
| 关于满足感复选框的 [HN 讨论](https://news.ycombinator.com/item?id=31781110) | 反方观点：愉悦动画不能拖慢下一个动作、不能在密集操作时变成负担 | 速度纪律：完成反馈全链路 <300ms 且可被后续操作打断（见原则 8） |
| [Apple HIG：Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | 动效要传达层级、关系与状态变化；尊重 Reduce Motion；保持一致 | 我们已有 reduced-motion 全覆盖的硬约束；补的是「动效传达状态」——完成、解锁、庆祝都应有各自的动效语义 |
| [Material 3：Easing & Duration Tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) | 令牌按用途分组：**spatial（位移）vs effects（淡入淡出/颜色）**，各配 default/fast/slow；emphasized 强调曲线用于需要表现力的时刻 | 我们的 `--ease-out`（指针响应）与 `--ease-move`（位移）已符合该分组；缺一档「强调」曲线（见 3.4） |
| [Sunsama：Daily Planning](https://help.sunsama.com/docs/usage-guides/daily-planning/) | 招牌是**引导式每日规划仪式**：选任务 → 估时 → 承诺今日计划，配收尾仪式；规划是被引导的流程而非空白清单 | 「开始每日规划」应成为两三步的轻量仪式（勾选 ≤3 件 → 确认承诺），而不是把用户扔回一个筛选器 |
| Things 3 / Todoist 完成与推迟模式（参考 [Mobbin 复选框合集](https://mobbin.com/glossary/checkbox)、[Ripplix 动画实例](https://www.ripplix.com/browse/interaction/checkbox-ui-animations)） | 完成时勾选框画出勾 → 行短暂保留/淡出；「推迟到明天」是一等公民操作（滑动/菜单一键完成） | C1（完成微交互）与 C2（一键推迟）的行业默认形态 |

---

## 二、提炼的设计原则

这 8 条是后面所有提案的判据。每条标注出处与在本项目的落点。

1. **陪伴而不打扰**（Desktop Pets / Lawhead / vscode-pets）。桌宠的一切动作必须低调且可预期：默认静止，动作由事件触发或极低频出现；它永远不抢焦点、不弹通知。→ 落点：A1/A3 保持「默认静止」项目规则。
2. **照顾与被依赖，永不惩罚**（Finch / Yu-kai Chou）。宠物可以反映「今天被照顾得好不好」，但跳过休息、漏掉规划**绝不**产生负面视觉（不发灰、不哭脸、不扣分）。坚持感放在回顾页，压力不放在当下。→ 落点：A6、B4。
3. **休息要有内容**（Stretchly）。休息屏永远回答「这 30 秒我该干什么」：一个当前步骤、一个下一步预告、一个同步的动画示范。→ 落点：B1（现状已有步骤，缺同步）。
4. **节奏同步**（Apple Breathe / Headspace）。涉及生理节奏的引导（眨眼、呼吸、远望）由动画直接带节奏，动画周期 = 指导周期。→ 落点：A1 呼吸、B2 呼吸环。
5. **例行动作最值得打磨**（!Boring）。设计预算优先给每天发生几十次的动作：打勾、开始休息、点桌宠。里程碑（完成一天、连续一周）反而可以克制。→ 落点：C1 优先级高于任何庆祝大动画。
6. **蓄力 → 回报（windup → payoff）**（!Boring）。有分量的反馈前面要有一拍可感知的预备：点桌宠先挤压再弹跳；「完成休息」解锁前按钮先有一个强调入场。→ 落点：A4、B3。
7. **动效传达状态**（Apple HIG / M3）。每条动画都要回答「什么变了」：入场（出现）、状态（解锁/完成）、关系（行移动到明天）。没有语义的装饰动画一律不做；位移与淡入淡出使用不同的时长档。→ 落点：3.4 动效语法。
8. **速度纪律：<300ms、可打断**（NN/g / HN 讨论）。高频反馈 ≤140ms；完成反馈全链路 ≤300ms；庆祝是一次性事件，不阻塞下一个操作；reduced-motion 下退化为状态直切。→ 落点：所有提案的验收标准。

---

## 三、逐界面改造提案

> 编号规则：A=桌宠、B=休息卡、C=计划/待办；P1/P2/P3 为优先级（见 §四）。现状描述里的代码位置基于 2026-09 的 `codex/simple-experience-split` HEAD。

### 3.1 桌宠（Demo 区块 A）

**现状**：`PixelAnimal.tsx` 是共享的 64×64 SVG；`action` 实际只有「播/不播」两种——护眼、走动、合并、点击反应全部跑同一个 8 步三帧抖动（160ms/步，约 1.3s，`PixelAnimal.tsx:17-22`），之后完全静止；待机状态只有 45 秒一次的 CSS 摇摆 + 700ms 点击 wobble（`PetCharacter.tsx:5-6`）。没有呼吸、没有眨眼。`styles.css:160-161` 注释承诺的「每只动物可见的运动签名」实际不存在。

| # | 提案 | 参考 | 方案 | 验收 |
| --- | --- | --- | --- | --- |
| A1 (P1) | **待机微生命：呼吸 + 眨眼** | Slynyrd/Saint11 idle 规格；原则 1、4 | 躯干/头部组做 1 网格单位的起伏循环（2 帧交换或 CSS scaleY ≈1.5%，3.2s 慢速循环）；每 6–9s 随机眨眼一次（复用现有 blink 帧路径 `PixelAnimal.tsx:72`）。与项目「默认静止」规则的调和：呼吸与眨眼属于「静止的一部分」（幅度 ≤1 单位、无位移弹跳），需同步更新 AGENTS.md 与 `pixelAnimals` 文档措辞；reduced-motion 下完全静止 | 50% 缩放（80px 窗口）下肉眼可辨、不遮挡；reduced-motion 时零动画；`capture:pet-scale` 截图不回归 |
| A2 (P1) | **按提醒类型的动作签名** | vscode-pets 事件姿态；原则 7 | 把 `action` 从「boolean 化」改回 kind 分支：`eye` = 缓慢抬头远望 + 两次眨眼；`walk` = 原地踏步（左右腿 1 单位交替 + 身体同步起伏）；`combined` = 远望 → 踏步序列。实现上扩展 `PixelAnimal.tsx` 的帧交换为按 kind 的编排，宠物窗口与休息卡共用 | `tests/rest-view-model.test.ts` 补 kind→action 映射用例；三类动作录屏/截图肉眼可区分 |
| A3 (P2) | **事件反应** | vscode-pets / chat pet；原则 1 | 完成待办 → 小跳 + 一闪而过的像素庆祝粒子（≤1s，一次性）；番茄专注开始 → 收拢坐下姿态；pre-alert（提前预告）→ 伸懒腰一次，替代突兀的气泡弹出。事件经 IPC 一次性下发（沿用 settings 广播的通道模式），不新增常驻轮询 | 事件时序：反应只在事件发生的一刻播放一次；重复触发不叠帧 |
| A4 (P2) | **点击反馈加蓄力** | !Boring windup；原则 6 | 现有 700ms wobble 前加约 80ms 挤压（scaleY 0.94，transform-origin 底部）再回弹——「它感觉到你了」 | 点击到回弹全程 ≤800ms；连点不叠加 |
| A5 (P2) | **拖拽把手语义修正** | 原则 7 | 现状：把手 pill 可见但 `pointer-events: none` + aria-hidden（`styles.css:111-131`），整个窗口才是拖拽面——可见的「把手」暗示错误的交互范围。二选一：去掉把手视觉，改为 hover 时整窗出现极淡的拖拽提示光标；或让把手成为真实拖拽起始区（需重验 DWM 透明窗口拖拽，参考 `styles.css:22-24` 注释的风险记录） | 视觉呈现与真实可拖拽区域一致；`smoke:pet-failure` 不回归 |
| A6 (P3) | **温和情绪（可选）** | Finch；原则 2 | 当天完成休息数 ≥80% 时，收工时段宠物带一次满足表情（眯眼 + 粉腮）；其余一切状态与平时完全相同——无任何负面表情 | 无惩罚红线：任何跳过/暂停都不触发负面视觉 |

### 3.2 休息卡（Demo 区块 B）

**现状**：玻璃卡「舞台 + 阅读面板」结构（`styles.css:1547+`）：accent 光斑只在上 40%、倒计时环 + 宠物 + 计时 pill 的舞台、当前步骤单独展示、完成按钮锁定至 `unlockAt`、跳过常开、稍后为分体按钮。骨架已达到参考水准；缺的是「活」的部分。

| # | 提案 | 参考 | 方案 | 验收 |
| --- | --- | --- | --- | --- |
| B0 (P1，前置修正) | **修复过期的 smoke 选择器** | — | `scripts/smoke-reminder-experience.mjs:42-51` 仍断言 `.alert-panel` / `.alert-actions`（真实 DOM 是 `.rest-card` / `.rest-actions`）——旗舰界面的打包验证目前是断线的。任何休息卡改动前先修，否则改动的回归无保障 | `smoke:experience` 对真实 DOM 通过 |
| B1 (P1) | **步骤与宠物动画同步** | 原则 3、4；vscode-pets | 当前步骤变化时宠物执行对应动作：远望/眨眼步骤 → A2 的 eye 动作；走动/伸展步骤 → walk 动作。`restViewModel` 增加 step→action 映射，宠物在休息期间持续低频活动（每步一次），而不是开赛 1.3s 后冻住 | `tests/rest-view-model.test.ts`补映射；休息 30s 内宠物动作 ≥2 次且与步骤对应 |
| B2 (P2) | **呼吸引导环** | Apple Breathe / CSS-Tricks；原则 4 | 休息进行中，舞台光晕/外环加 4s 周期的呼吸脉动（scale 1→1.04，纯 CSS `@keyframes`），眨眼/深呼吸类步骤尤其受益；reduced-motion 关闭 | 纯 CSS 实现，不进 JS 时钟；对比度合同不受影响（accent 仅装饰层） |
| B3 (P2) | **完成时刻** | !Boring；原则 5、6 | 倒计时归零瞬间：环做一次 accent 闪烁（360ms）、宠物跳一下（复用 A3 动作）、标题切换为「休息完成」、「完成休息」按钮从锁定态以 140ms 强调入场。全程 ≤600ms，一次性，不播放音效（可后续作为设置项） | 归零到可点击 ≤600ms；重复进入 finished 不重播庆祝 |
| B4 (P3) | **温和坚持可视化** | Stretchly Health Mode 的弱化版；原则 2 | 不做「跳过时屏幕变暗」类实时压力（与原则 2 冲突）；把坚持放在完成记录页：连续完成休息的天数一列展示，跳过那天只是空一格，无任何红叉 | 回顾页无负面符号；仅正向计数 |
| B5 (—) | **出口层级保持现状** | Stretchly | 跳过常开、稍后分体按钮、完成锁定——均已对齐参考实践，不改 | — |

### 3.3 计划 / 待办（Demo 区块 C，简化版基线）

**现状**：待办 = 逾期/今天/未来分组 + 顶部快速输入；完成 = 行当帧消失 + 单槽 undo 横幅；推迟 = 展开表单改日期；行内操作纯 hover 出现；删除用原生 `window.confirm`（`WorkbenchView.tsx:82,91`）。

| # | 提案 | 参考 | 方案 | 验收 |
| --- | --- | --- | --- | --- |
| C1 (P1) | **完成微交互** | !Boring / Things 3 / NN/g；原则 5、8 | 勾选框画勾（SVG stroke-dashoffset，220ms `--ease-out`）→ 行淡出塌缩（140ms，延迟 120ms 让勾被看见）→ undo 横幅（已有样式，`simple.css` `.simple-undo`）。全链路 <400ms，其中用户可感知部分 <300ms；期间点击其他行不阻塞 | 完成到行消失 ≤400ms；勾画可见；undo 可恢复；reduced-motion 直切 |
| C2 (P1) | **一键推迟到明天** | Sunsama / Things 3 defer | 行操作区加「明天」按钮（含 `aria-label`），点击 → 行以 `--ease-move` 移入「明天」分组（FLIP 或先淡出再插入，220ms）。这是最高频规划动作，不该进表单 | 推迟全程 ≤250ms；分组计数同步；undo 可撤销 |
| C3 (P2) | **主题化确认对话框** | 原则 7 | 替换三处 `window.confirm`（`WorkbenchView.tsx:82,91`、`BubbleView.tsx:50`、`PetView.tsx:16`）为应用内 Dialog（`primitives.css` 已有对话框与焦点陷阱，`tests/modal-keyboard-contract.test.ts` 已覆盖） | 删除确认与主题一致；键盘可达（Tab/Esc） |
| C4 (P2) | **轻量每日规划仪式** | Sunsama ritual；原则 3 | 空状态按 next.md 的建议拆成三个独立元素（文案 / 按钮 / 提示）；「开始今日规划」→ 两步轻量流程：从今天可用任务勾选 ≤3 件 → 确认承诺（概念复用死代码 `DailyPlanningFlow` 的 triage→承诺骨架，UI 重做至极简）。承诺结果置顶展示在「今天」分组上方与气泡顶部 | 规划流程 ≤3 步；承诺可一键清空重来；不新增数据模型（复用 `dailyRank` 语义） |
| C5 (P2) | **正在专注的存在感** | Sunsama today；原则 7 | 工作台内容区顶部加一条细横幅（进行中番茄：任务名 + 剩余时间 + 结束按钮），数据走 bubble 使用的同一 `usePomodoro` hook；空闲时完全不渲染 | 专注中可见、结束后消失；不与 undo 横幅叠位 |
| C6 (P2) | **行内操作可发现性** | 原则 1、7 | hover-only（`simple.css:180-182` opacity:0）改为「常态低可见（约 40%）+ hover/focus-within 全显」；触屏/键盘路径常显 | 键盘 Tab 到行时操作可见；常态不喧宾 |
| C7 (P3) | **拖拽排序** | Things 3 | `taskReorder.ts` 数据模型已存在，缺 UI；给行加 `touch-action:none` 拖拽手柄，复用死代码 `TaskList` 的拖拽实现思路 | 拖拽 220ms 落位动画；与 C2 推迟不冲突 |

### 3.4 动效语法（跨界面）

现有令牌（`tokens.css`）方向与 HIG/M3 一致，缺的是「哪个场景用哪一档」的成文约定。建议在 `docs/color-system.md` 或本文件落成下表，并按需补一档强调曲线：

| 场景 | 令牌 | 值 |
| --- | --- | --- |
| 按下反馈 | `--motion-instant` + `--press-scale` | 90ms |
| 悬停、状态切换、行内反馈 | `--motion-fast` + `--ease-out` | 140ms |
| 完成画勾、按钮强调入场 | （新增）`--motion-emphasized` + `--ease-emphasized` | 220ms + 近似 M3 emphasized decelerate（如 `cubic-bezier(0.05, 0.7, 0.1, 1)`） |
| 对话框、卡片入场、行移动 | `--motion-standard`（入）/ `--ease-move`（位移） | 220ms |
| 进度环、进度条（唯一允许 linear） | `--motion-slow` linear | 360ms |
| 庆祝、庆祝粒子 | `--motion-slow` + `--ease-out`，一次性 | ≤600ms |

注意：新增任何非颜色令牌必须同步 `tests/design-system-contract.test.ts` 的白名单（`tests/design-system-contract.test.ts:46-67`），且 `tokens.css` 与 `theme.css` 的令牌所有权不可交叉（`scripts/verify-ui-contract.mjs:119-131`）。

---

## 四、优先级路线图

P1 = 用户每周都会感知到的差距且改动面小；P2 = 明显加分；P3 = 有趣但要防止过度设计。

| 优先级 | 项 | 主要文件 | 需同步的测试/脚本 | 验证 |
| --- | --- | --- | --- | --- |
| P1 | B0 smoke 选择器修复 | `scripts/smoke-reminder-experience.mjs` | — | `npm run smoke:experience`（打包） |
| P1 | A1 待机呼吸 + 眨眼 | `PixelAnimal.tsx`、`PetCharacter.tsx`、`styles.css`、AGENTS.md 措辞 | `tests/rest-view-model.test.ts`（idle 断言） | `npm run typecheck`、`npm test`、`capture:pet-scale` |
| P1 | A2 按类型动作签名 | `PixelAnimal.tsx`、`restViewModel.ts` | `tests/rest-view-model.test.ts` | `npm test`、`capture:ui` |
| P1 | B1 步骤与动画同步 | `restViewModel.ts`、`AlertView.tsx` | `tests/rest-view-model.test.ts` | `npm test`、`smoke:experience` |
| P1 | C1 完成微交互 | `WorkbenchView.tsx`、`simple.css` | `tests/design-system-contract.test.ts`（命中区/令牌） | `npm run verify:ui-contract`、`npm test` |
| P1 | C2 一键推迟 | `WorkbenchView.tsx`、`simple.css`（IPC 若需透传字段则按 docs/ipc-guide.md 三端同步） | `tests/ipc-task-input.test.ts`（若动 IPC） | `npm test` |
| P2 | A3 事件反应 / A4 点击蓄力 / A5 把手修正 | `PetView.tsx`、`main/index.ts`、`styles.css` | `tests/reminder-surface.test.ts`（若动窗口） | `smoke:pet-failure`、`capture:pet-scale` |
| P2 | B2 呼吸环 / B3 完成时刻 | `styles.css`、`AlertView.tsx` | `verify:ui-contract`（accent 装饰规则） | `npm run verify:ui-contract`、`smoke:experience` |
| P2 | C3 主题化对话框 / C4 规划仪式 / C5 专注存在感 / C6 可发现性 | `WorkbenchView.tsx`、`primitives.css`、`simple.css` | `tests/modal-keyboard-contract.test.ts`、`tests/design-system-contract.test.ts` | `npm test`、`verify:ui-contract`、`capture:ui` |
| P3 | A6 情绪 / B4 坚持可视化 / C7 拖拽 / 声音 | 视实现而定 | — | 全量 `npm test` + `npm run package` |

实现顺序建议：**B0 → A1 → A2 → B1 → C1 → C2**（一条「宠物活了」+「完成有反馈」的主线），P2 按 A→B→C 分批，每批跑一次全量验证与截图验收。

---

## 五、硬约束清单（实现时不可违反）

以下来自 `scripts/verify-ui-contract.mjs`、`tests/design-system-contract.test.ts`、`tests/theme-authority.test.ts` 与 AGENTS.md，改版前请全文重读：

1. 颜色只能出自 `theme.css`；任何 CSS 文件（demo 除外，不在扫描范围）不得出现裸色值；`color-mix()` 从令牌派生是唯一豁免。
2. 玻璃面板上的文字只用 `--fg-primary/--fg-secondary`（tertiary 在最坏壁纸下 4.30:1，被禁）；`--rest-accent-*` 只做装饰（舞台、环、徽标点、步骤标记），永不承载文字对比度。
3. 命中区：导航 ≥44px、图标按钮 36px、按钮 ≥40px、任务行 ≥52px；`--hit-target-min: 44px`。
4. 每个活样式表必须有 `prefers-reduced-motion` 与 `forced-colors` 分支；宠物/提醒窗口的 JS 计时动画必须随可见性与 reduced-motion 停止（`PixelAnimal.tsx:11-16` 的既有模式）。
5. `theme.css` 的 light、`[data-theme='dark']`、system-dark 三个块必须令牌一致（theme-authority 测试逐 token 校验）。
6. 图标只用 Lucide，产品 chrome 禁 emoji；全局 SVG 颜色选择器禁止。
7. 桌宠默认静止、动作低频且一次性（本文件 A1 提案调整其措辞，规则本身保持）；宠物 64 网格整数像素、`crispEdges`。
8. 打包相关改动（图标、资源路径）需跑 `npm run package`；提醒体验改动需跑 `smoke:experience`。

---

## 附：参考链接汇总

- Stretchly：<https://github.com/hovancik/stretchly>
- Apple Watch Breathe（官方指引）：<https://support.apple.com/en-gb/guide/watch/apd371dfe3d7/watchos>
- CSS-Tricks 复刻 Breathe 动画：<https://css-tricks.com/recreating-apple-watch-breathe-app-animation/>
- vscode-pets：<https://tonybaloney.github.io/vscode-pets/pets/> · VS Code chat pet：<https://code.visualstudio.com/docs/agents/reference/chat-pet>
- Finch 设计分析：<https://www.linkedin.com/pulse/why-gamifying-self-care-virtual-pet-works-finch-heather-arbiter-gjkpe>
- Yu-kai Chou 宠物陪伴设计：<https://yukaichou.com/advanced-gamification/the-pet-companion-design-in-gamification/>
- Nathalie Lawhead 桌宠随笔：<https://www.nathalielawhead.com/candybox/about-desktop-pets-virtual-companions-discussing-the-inhabitants-that-fill-the-void-of-our-digital-spaces>
- Saint11 像素教程集：<https://saint11.art/blog/pixel-art-tutorials/> · Character Idle：<https://www.patreon.com/saint11/posts/character-idle-12464240>
- Slynyrd 像素动画入门：<https://www.slynyrd.com/blog/2018/8/19/pixelblog-8-intro-to-animation>
- !Boring 最满足复选框：<https://notbor.ing/words/the-most-satisfying-checkbox> · HN 讨论：<https://news.ycombinator.com/item?id=31781110>
- NN/g 微交互：<https://www.nngroup.com/articles/microinteractions/>
- Apple HIG Motion：<https://developer.apple.com/design/human-interface-guidelines/motion>
- Material 3 动效令牌：<https://m3.material.io/styles/motion/easing-and-duration/tokens-specs>
- Sunsama 每日规划：<https://help.sunsama.com/docs/usage-guides/daily-planning/>
- 复选框动效实例：Ripplix <https://www.ripplix.com/browse/interaction/checkbox-ui-animations> · Mobbin <https://mobbin.com/glossary/checkbox>
