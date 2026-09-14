---
feature: ux-polish-p1p2
status: delivered
updated: 2026-02-14
branch: codex/ux-polish-p1p2
commits: 90e63ab..43982d9
---

# UX 美化 · 完整 P1+P2（简化体验）

## Report

**What was built** — 在简化体验上落地「安静基底 + 签名时刻」审美综合：新增强调动效令牌；像素动物待机呼吸/眨眼、按类型动作（eye/walk/combined）、点击蓄力与庆祝；休息卡步骤同步宠物动作、休息中光晕呼吸、完成时环闪光与主按钮强调入场；工作台完成画勾→行淡出→撤销、一键推迟到明天、行操作常显、番茄专注横幅；`window.confirm` 全部替换为主题化 `useConfirm` 对话框。参考 Emil/transitions.dev/shadcn/coss/ui-skills 等站点原则综合，不引入外部动画库。

**Verification** — `npm run typecheck` PASS；`npm test` 486 PASS；`npm run verify:ui-contract` PASS。独立 review 发现并修复 C-1 combined 定时器竞态、C-2 CSS 优先级覆盖、H-1 confirm resolver 悬挂、M-1 完成重入、M-2 眨眼区间后，复审 5/5 PASS。

**Journey log**
1. 审美档位先出对比 demo 再由用户定向为「C 表达力 + 多站综合」，避免单抄某一库。
2. 父级复合选择器（`.pet-character.is-reacting .pixel-animal`）会静默覆盖子元素状态动画；动效所有权应收敛到单一元素。
3. 同延迟 `setTimeout` 链对 clear 顺序敏感：combined 需单一链式回调，不能 eye 结束时 clear 掉 walk。
4. promise 型确认框必须在替换/卸载时 settle 旧 resolver，否则并发调用会永久悬挂。
5. 简化体验与主仓 AGENTS 文档存在漂移；实现以 worktree 内 CLAUDE.md 为准。

## [S1] Problem

简化版体验骨架安静可用，但高频路径缺完成反馈、推迟仍进表单、宠物待机冻住、休息步骤与动画脱节。用户给出多站参考，要求审美综合而非单抄。

## [S2] Design

### 审美综合方向

**基底：安静编辑感；预算：少数签名时刻。**

| 来源 | 可迁移做法 | 落点 |
| --- | --- | --- |
| Emil Kowalski | 有目的才动画；高频/键盘路径零动画；UI 动画 <300ms | 导航、行 hover 不加动画 |
| transitions.dev | 成功勾选 stroke-draw | C1 完成微交互 |
| ui-skills playbook | press scale、tabular-nums、text-balance | 全局控件与休息标题 |
| shadcn / coss | 控件密度、主次分明、安静 chrome | 工具条、空状态、行操作基线可见度 |
| beautifului | primitive 完成度 | 完成行划线语义 |
| beui / rareui | 低频签名动效（纯 CSS/帧） | 点击蓄力、休息完成时刻 |
| 既有 glass rest card | 近不透明玻璃 + accent 装饰 | 保持，补呼吸与完成仪式 |

硬约束不变：语义令牌、对比度、命中区、reduced-motion、forced-colors、颜色只出自 theme.css。

### 动效语法（已补强 tokens）

| 场景 | 令牌 | 值 |
| --- | --- | --- |
| 按下 | `--motion-instant` + `--press-scale` | 90ms |
| 悬停/状态切换 | `--motion-fast` + `--ease-out` | 140ms |
| 完成画勾、按钮强调入场 | `--motion-emphasized` + `--ease-emphasized` | 220ms |
| 对话框/位移 | `--motion-standard` + `--ease-move` | 220ms |
| 进度环 linear | `--motion-slow` | 360ms |
| 庆祝一次性 | `--motion-slow` + `--ease-out` | ≤600ms |

### P1 行为（已交付）

1. **A1** idle 呼吸 + 6–9s 随机眨眼；reduced-motion / hidden 静止。
2. **A2** `idle|react|eye|walk|combined|celebrate` 分支；combined 为链式 eye→walk。
3. **B1** `restAnimalActionForStep` 步骤→动作；AlertView 按步骤 remount 重播。
4. **C1** SVG 画勾 220ms → `is-completing` → undo；防重入。
5. **C2** 行内「明天」`updateTask({ dueDate, baseRevision })`。
6. **C6** 行操作 opacity 0.4 → hover/focus 全显。

### P2 行为（已交付）

1. **A4** 点击 `is-react` 蓄力回弹（动效所有权在 PixelAnimal）。
2. **A3** 工作台本地完成动画；桌宠周期动作用 celebrate（可选 IPC 未做）。
3. **B2** resting 时 glow 4s 脉动。
4. **B3** finished 环 flash + 主按钮 `is-unlocked`。
5. **C3** `useConfirm` 替换三处 `window.confirm`。
6. **C5** 工作台专注横幅（focus/break/focus-finished）。

### Out of Scope

- C4 每日规划仪式、C7 拖拽排序、A5 拖拽把手、A6 情绪、B4 坚持可视化、声音
- Framer Motion 等外部动画库
- 改变提醒调度、数据模型、窗口布局

## [S3] Out of Scope

见上。旧 workbench.css 任务流、独立规划窗口不恢复。

## Tasks

- [x] T1: 扩展 tokens 并同步 design-system 白名单 — typecheck + design-system-contract 通过 (covers: S2)
- [x] T2: PixelAnimal 呼吸/眨眼/类型动作 — reduced-motion 静止；帧序可区分 (covers: S2)
- [x] T3: restViewModel 步骤→动作映射 + AlertView 接线 — tests 补用例 (covers: S2; depends: T2)
- [x] T4: 工作台完成微交互 + 行操作可见度 + 明日推迟 — 画勾/undo/dueDate/C6 (covers: S2)
- [x] T5: 主题化 ConfirmDialog 替换 window.confirm — 三处确认走 Dialog (covers: S2)
- [x] T6: 休息卡 B2 呼吸 + B3 完成时刻 — resting 脉动；finished 强调 (covers: S2; depends: T3)
- [x] T7: 桌宠点击蓄力 + 完成庆祝动作 — 点击不叠加 (covers: S2; depends: T2)
- [x] T8: 工作台专注横幅 C5 — focus/break 显示；idle 不渲染 (covers: S2)
- [x] T9: 视觉综合 + verify:ui-contract — 契约全绿 (covers: S2)
- [x] T10: 验证与独立 review — typecheck/test/ui-contract + critical 修复复审 (covers: S2)
