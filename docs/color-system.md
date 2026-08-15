# EyeProtect 配色系统

## 目标

EyeProtect 使用“中性石墨 + 少量玉石青”的配色方向。背景、侧栏、面板和选中态以中性灰建立层级；品牌色只用于当前状态、主要操作、专注与健康语义，避免整个界面被灰绿色覆盖。

## 核心色板

| 语义 | Light | Dark | 用途 |
| --- | --- | --- | --- |
| App Background | `#F7F7F8` | `#111315` | 主工作区 |
| Sidebar | `#F1F2F4` | `#0D0F10` | 左侧导航 |
| Surface | `#FFFFFF` | `#181B1D` | 面板、输入框 |
| Raised Surface | `#FAFAFB` | `#1D2124` | 浮层 |
| Hover | `#F0F1F2` | `#22272B` | 悬停状态 |
| Selected | `#E8EBED` | `#293034` | 中性选中背景 |
| Border subtle | `#E4E6E8` | `#2A2F33` | 普通分隔 |
| Border strong | `#CDD1D5` | `#3A4248` | 输入框等强调边界 |
| Primary text | `#181A1B` | `#F2F4F5` | 主文字 |
| Secondary text | `#555C64` | `#B8BEC3` | 次文字 |
| Tertiary text | `#6A7178` | `#8C959C` | 辅助文字 |
| Brand | `#2B6B61` | `#7CC0AF` | 主操作、当前和健康状态 |
| Brand subtle | `#EAF2F0` | `#19302B` | 少量品牌背景 |

实际 CSS 值以 `src/renderer/src/styles/theme.css` 中的语义令牌为唯一权威。本页说明设计意图，不应在组件中复制硬编码色值。

## 使用规则

- 导航和任务选中态使用中性背景；品牌色只落在图标、小型指示器或主操作上。
- 普通任务行默认透明，悬停与选中分别使用中性 hover/selected surface。
- 绿色表示当前、执行、成功或健康；琥珀色表示警告与临近截止；红色表示逾期、破坏性操作或失败。
- Task Detail 使用平面属性行和轻量 neutral pill，避免表单控件层层叠加品牌色背景。
- Workbench、Task、Project 与 Plan 样式不得直接写 `#hex`、`rgb()` 或 `rgba()`；颜色必须来自语义令牌。
- 所有需要主动阅读的文本对比度至少为 `4.5:1`。更低对比度仅允许用于装饰、禁用态和非必要提示。

## 对比度基线

核心组合的设计基线如下：

| 组合 | 对比度 |
| --- | ---: |
| Light primary / background | 16.31:1 |
| Light secondary / background | 6.32:1 |
| Light tertiary / background | 4.62:1 |
| Light brand / brand-subtle | 5.46:1 |
| White / Light primary button | 6.22:1 |
| Dark primary / background | 16.88:1 |
| Dark secondary / background | 9.92:1 |
| Dark tertiary / background | 6.11:1 |
| Dark tertiary / hover surface | 4.95:1 |
| Dark brand / brand-subtle | 6.68:1 |

这些数值是色板设计基线；代码变更后的真实结果由 `npm run verify:ui-contract` 校验。

## 工程约束与验收

- `styles.css` 服务桌宠、提醒气泡/卡片窗口，以及 Workbench 内嵌的设置页与独立提醒页；Workbench 主体样式由 `styles/` 下的设计令牌和分层样式负责（旧的面板/闹钟/待办窗口样式已随对应窗口删除）。
- 自动检查覆盖真实组件状态、Light/Dark 主题、raw color、命中区域、forced-colors 和 reduced-motion。
- 截图矩阵覆盖 Today、Task Detail、Command Palette、Plan、Project List/Board、Pet、Reminder 和 Bubble。
- 页面级横向滚动必须为零，只有 Project Board 自身允许横向滚动。
- 960×600 下 Plan 保持待安排区与时间线双栏，Task Detail 不得裁切控件。

常用验收命令：

```powershell
npm run typecheck
npm test
npm run verify:ui-contract
npm run package
```

## 历史交接包说明

原 `eyeprotect-ui-redesign-plan.zip` 是基于提交 `9c21d00` 生成的阶段性交接材料，包含基线截图、根因分析、文件变更图和执行顺序。当前实现已完成其中的 CSS 所有权收敛、配色替换、Task Detail 重组、响应式布局和验收链路升级，因此不再保留 ZIP 及其重复截图。

仍有效的内容已经合并到本页：中性配色原则、语义颜色规则、对比度要求、CSS 所有权以及截图/交互验收矩阵。产品和功能规划以 README、AGENTS、CLAUDE 和现有测试为准（根目录 `USERPLAN.md` 是历史归档，不作为待办清单）。
