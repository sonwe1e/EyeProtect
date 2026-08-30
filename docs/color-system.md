# EyeProtect 配色系统

EyeProtect 使用“暖纸面 + 墨色文字 + 少量鼠尾草绿”的配色方向。背景、侧栏、面板和选中态以低饱和中性色建立层级；品牌色只用于当前状态、主要操作、专注与健康语义，避免整个界面被绿色覆盖。

## 核心色板

| 语义 | Light | Dark | 用途 |
| --- | --- | --- | --- |
| App Background | `#F5F6F4` | `#111614` | 主工作区 |
| Sidebar | `#ECEFEB` | `#0B100E` | 左侧导航 |
| Surface | `#FFFFFF` | `#171E1B` | 面板、输入框 |
| Raised Surface | `#FBFCFA` | `#1D2722` | 浮层、强调卡片 |
| Hover | `#EEF2EF` | `#222D27` | 悬停状态 |
| Selected | `#E5ECE8` | `#29372F` | 中性选中背景 |
| Border subtle | `#DDE4DF` | `#29352F` | 普通分隔 |
| Border strong | `#C5D0C8` | `#3A4840` | 输入框等强调边界 |
| Primary text | `#18201D` | `#EEF5F1` | 主文字 |
| Secondary text | `#505D56` | `#B6C2BB` | 次文字 |
| Tertiary text | `#65736C` | `#8D9B93` | 辅助文字 |
| Brand | `#2E6B5A` | `#82C5AF` | 主操作、当前和健康状态 |
| Brand subtle | `#E6F0EB` | `#1A342C` | 少量品牌背景 |

实际 CSS 值以 `src/renderer/src/styles/theme.css` 中的语义令牌为唯一权威。本页说明设计意图，不应在组件中复制硬编码色值。

## 使用规则

- 导航和任务选中态使用中性背景；品牌色只落在图标、小型指示器或主操作上。
- 普通任务行默认透明，悬停与选中分别使用中性 hover/selected surface。
- 普通面板使用一层 surface 和 subtle border；只有对话框、侧滑层、Toast 等浮层使用 `shadow-overlay`。
- 绿色表示当前、执行、成功或健康；琥珀色表示警告与临近截止；红色表示逾期、破坏性操作或失败。
- Task Detail 使用平面属性行和轻量 neutral pill，避免表单控件层层叠加品牌色背景。
- 动效只服务于浮层进出、命令反馈、选中/拖拽反馈；不为装饰加入持续循环动画。
- Workbench、Task、Project 与 Plan 样式不得直接写 `#hex`、`rgb()` 或 `rgba()`；颜色必须来自语义令牌。
- 所有需要主动阅读的文本对比度至少为 `4.5:1`。更低对比度仅允许用于装饰、禁用态和非必要提示。

## 对比度基线

核心组合的设计基线如下：

| 组合 | 对比度 |
| --- | ---: |
| Light primary / background | 15.34:1 |
| Light secondary / background | 6.37:1 |
| Light tertiary / background | 4.59:1 |
| Light primary / surface | 16.62:1 |
| Light secondary / surface | 6.91:1 |
| Light selected text / background | 13.85:1 |
| Light selected metadata / background | 5.75:1 |
| Light brand / brand-subtle | 5.35:1 |
| White / Light primary button | 6.24:1 |
| Light danger / danger-subtle | 5.26:1 |
| Light warning / warning-subtle | 5.26:1 |
| Dark primary / background | 16.51:1 |
| Dark secondary / background | 9.94:1 |
| Dark tertiary / background | 6.30:1 |
| Dark primary / surface | 15.32:1 |
| Dark secondary / surface | 9.23:1 |
| Dark selected text / background | 11.28:1 |
| Dark selected metadata / background | 6.79:1 |
| Dark brand / brand-subtle | 6.72:1 |
| Dark primary button | 8.48:1 |
| Dark danger / danger-subtle | 6.60:1 |
| Dark warning / warning-subtle | 7.12:1 |

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

产品和功能规划以 README、AGENTS、CLAUDE 和现有测试为准（根目录 `USERPLAN.md` 是历史归档，不作为待办清单）。
