---
feature: ux-polish-p1p2
status: in-progress
updated: 2026-02-14
branch: codex/ux-polish-p1p2
commits: 
---

# UX 美化 · 完整 P1+P2（简化体验）

## Report

## [S1] Problem

简化版体验（待办 / 休息卡 / 桌宠 / 气泡）骨架已安静可用，但高频路径缺少完成反馈、推迟仍进表单、宠物待机冻住、休息步骤与动画脱节。用户给了一组现代 UI 参考站（shadcn/coss、beautifului、beui/rareui、transitions.dev、ui-skills、Emil），希望「集思广益」做一次审美综合，而不是单抄某一库。

## [S2] Design

### 审美综合方向

**基底：安静编辑感；预算：少数签名时刻。**

| 来源 | 可迁移做法 | 落点 |
| --- | --- | --- |
| Emil Kowalski | 有目的才动画；高频/键盘路径零动画；UI 动画 <300ms | 导航、行 hover、键盘选择不加动画 |
| transitions.dev | 成功勾选 stroke-draw、toast 入场、状态交换 | C1 完成微交互 |
| ui-skills playbook | press scale、tabular-nums、text-balance、命中区 | 全局控件与休息标题 |
| shadcn / coss | 控件密度清晰、主次分明、安静 chrome | 工具条、空状态、行内操作基线可见度 |
| beautifului | 任务行/完成态等 primitive 完成度 | 完成行保留划线语义再淡出 |
| beui / rareui | 低频签名动效（不引入 Motion 库，纯 CSS/帧） | 宠物点击蓄力、休息完成时刻 |
| 既有 glass rest card | 近不透明玻璃 + accent 装饰 | 保持，补呼吸与完成仪式 |

硬约束不变：语义令牌、对比度、命中区、reduced-motion、forced-colors、颜色只出自 theme.css。

### 动效语法（补强 tokens）

| 场景 | 令牌 | 值 |
| --- | --- | --- |
| 按下 | `--motion-instant` + `--press-scale` | 90ms |
| 悬停/状态切换 | `--motion-fast` + `--ease-out` | 140ms |
| 完成画勾、按钮强调入场 | `--motion-emphasized` + `--ease-emphasized` | 220ms + `cubic-bezier(0.05, 0.7, 0.1, 1)` |
| 对话框/位移 | `--motion-standard` + `--ease-move` | 220ms |
| 进度环 linear | `--motion-slow` | 360ms |
| 庆祝一次性 | `--motion-slow` + `--ease-out` | ≤600ms |

`tokens.css` 白名单同步更新 `tests/design-system-contract.test.ts`。

### P1 行为

1. **A1 待机微生命** — `PixelAnimal` 支持 idle 呼吸（躯干 1 网格单位、约 3.2–4.4s steps 循环）与随机眨眼（6–9s）。`PetCharacter` 与休息卡共用。reduced-motion / hidden 完全静止。
2. **A2 类型动作签名** — `action` 语义：`idle` | `react` | `eye` | `walk` | `combined`。`eye`=抬头远望帧序；`walk`=踏步腿交替；`combined`=远望→踏步。`restAnimalAction` 已返回 kind，PixelAnimal 真正分支。
3. **B1 步骤同步** — `restViewModel` 增加 `restAnimalActionForStep`：当前 micro-break 步骤映射到 eye/walk 系列动作；步骤切换时宠物重播一次短动作。
4. **C1 完成微交互** — 勾选自定义 SVG 画勾（220ms）→ 行标记 `is-completing`（约 140ms 淡出塌缩）→ 走现有 undo 横幅。全链路 ≤400ms；reduced-motion 直切。
5. **C2 一键推迟到明天** — 行操作区「明天」按钮，`updateTask({ dueDate: tomorrow, baseRevision })`，复用 `addLocalDays`/`localDateKey`。无新 IPC。
6. **C6 行内操作可发现性** — `.simple-row-actions` 常态 opacity≈0.4，hover/focus-within 全显。

### P2 行为

1. **A4 点击蓄力** — 桌宠点击前 80ms 挤压再 wobble（≤800ms 总时长，不叠加）。
2. **A3 事件庆祝** — 工作台完成任务时，若桌宠窗口可见则发一次性 `celebrate`（主进程已有事件通道模式时优先复用；否则工作台本地完成动画已足够，桌宠庆祝作为可选 IPC）。
3. **B2 呼吸引导** — `phase==='resting'` 时 `.rest-stage-glow` 4s CSS 脉动。
4. **B3 完成时刻** — 切到 finished：环一次 accent 闪光 class、标题语义已是「可以完成」、主按钮强调入场（一次性 class）。
5. **C3 主题化确认** — 替换 Workbench/Bubble/Pet 的 `window.confirm` 为共享 `ConfirmDialog`（基于现有 `Dialog`）。
5. **C5 专注存在感** — 工作台顶部：番茄进行中显示细横幅（任务/剩余/结束），复用 `usePomodoro`。
6. **视觉综合** — 休息标题 `text-balance`；空状态更完整；主按钮保留材质高光；完成后的行短暂划线再消失。

### Out of Scope

- C4 每日规划仪式（简化主流程无规划页）
- C7 拖拽排序
- A5 拖拽把手语义（透明窗风险，单独验证）
- A6 情绪、B4 坚持可视化、声音
- 引入 Framer Motion / 外部动画库
- 改变提醒调度、数据模型、窗口布局

## [S3] Out of Scope

见上。旧 workbench.css 任务流、独立规划窗口不恢复。

## Tasks

- [ ] T1: 扩展 tokens（motion-emphasized / ease-emphasized）并同步 design-system 白名单 — acceptance: typecheck + design-system-contract 通过 (covers: S2)
- [ ] T2: PixelAnimal 呼吸/眨眼/类型动作 — acceptance: reduced-motion 静止；eye/walk/combined 帧序可区分；rest-view-model 测试通过 (covers: S2)
- [ ] T3: restViewModel 步骤→动作映射 + AlertView 接线 — acceptance: 步骤切换触发对应 action；tests 补用例 (covers: S2; depends: T2)
- [ ] T4: 工作台完成微交互 + 行操作可见度 + 明日推迟 — acceptance: 完成画勾可见且可 undo；「明天」改 dueDate；C6 opacity (covers: S2)
- [ ] T5: 主题化 ConfirmDialog 替换 window.confirm — acceptance: 三处确认走 Dialog，键盘可达 (covers: S2)
- [ ] T6: 休息卡 B2 呼吸 + B3 完成时刻 — acceptance: resting 脉动；finished 一次性强调 (covers: S2; depends: T3)
- [ ] T7: 桌宠点击蓄力 + 可选完成庆祝 — acceptance: 点击 ≤800ms 不叠加；celebrate 不常驻 (covers: S2; depends: T2)
- [ ] T8: 工作台专注横幅 C5 — acceptance: focus/break 显示剩余与结束；idle 不渲染 (covers: S2)
- [ ] T9: 视觉综合（text-balance、空状态、按钮材质核对）+ verify:ui-contract — acceptance: 契约与 typecheck/test 全绿 (covers: S2)
- [ ] T10: 验证与截图 — acceptance: typecheck、test、verify:ui-contract 通过；记录结果 (covers: S2)
