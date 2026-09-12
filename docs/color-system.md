# EyeProtect 配色系统

EyeProtect 使用“暖纸面 + 墨色文字 + 低饱和雾蓝灰”的配色方向。背景、侧栏、面板和选中态以低饱和中性色建立层级；品牌色只用于当前状态、主要操作和专注语义，避免整个界面被高饱和颜色覆盖。

## 核心色板

| 语义 | Light | Dark | 用途 |
| --- | --- | --- | --- |
| App Background | `#F5F6F7` | `#111518` | 主工作区 |
| Sidebar | `#ECEFF1` | `#0B1013` | 左侧导航 |
| Surface | `#FFFFFF` | `#171E23` | 面板、输入框 |
| Raised Surface | `#FBFCFD` | `#1D262C` | 浮层、强调卡片 |
| Hover | `#EEF1F3` | `#222D34` | 悬停状态 |
| Selected | `#E5ECEF` | `#293942` | 中性选中背景 |
| Border subtle | `#DCE3E7` | `#29353C` | 普通分隔 |
| Border strong | `#C4D0D6` | `#3A4852` | 输入框等强调边界 |
| Primary text | `#182024` | `#EEF4F7` | 主文字 |
| Secondary text | `#505D63` | `#B6C2C8` | 次文字 |
| Tertiary text | `#65737A` | `#8D9AA1` | 辅助文字 |
| Brand | `#526B78` | `#9DBFC9` | 主操作、当前和专注状态 |
| Brand subtle | `#E7EEF2` | `#1B323A` | 少量品牌背景 |

实际 CSS 值以 `src/renderer/src/styles/theme.css` 中的语义令牌为唯一权威。本页说明设计意图，不应在组件中复制硬编码色值。

## 玻璃材质（提醒窗与气泡专用）

提醒窗和桌宠气泡浮在用户桌面上，它们的卡底不是普通 surface，而是一组玻璃令牌：

| 令牌 | 用途 |
| --- | --- |
| `--glass-panel` | 卡片底色，94% 不透明 |
| `--glass-panel-floor` | 卡底合成到纯黑 / 纯白壁纸后的最坏情况取值 |
| `--glass-highlight` | 顶部 1px 内高光，玻璃质感的主要来源 |
| `--glass-hairline` | 卡片与控件的描边 |
| `--glass-wash` | 卡内小面积覆盖层（如倒计时胶囊） |
| `--glass-shadow` | 双层投影 |

## 控件材质令牌（不透明界面专用）

普通界面（工作台、设置、气泡按钮）的按压/悬浮实体感由三个随主题翻转的材质令牌承担，与玻璃令牌互不混用：

| 令牌 | 用途 |
| --- | --- |
| `--inset-highlight` | 填充/凸起控件顶部 1px 内高光；深色主题降至 8% 白，避免读成划痕 |
| `--inset-press` | 控件按住时替换高光的下压内阴影 |
| `--shadow-hairline` | 静止控件的一层微抬升投影 |

任何组件不得自行硬编码内高光 alpha；需要新材质状态时先在 `theme.css` 三个主题块同步登记。

两条硬规则：

- **卡底必须接近不透明。** 透明度再高一点，正文对比度就会随用户壁纸变化。`--glass-panel-floor` 存在的意义就是把「最坏壁纸」变成一个可机器校验的常量，`verify:ui-contract` 会用它校验正文对比度。
- **玻璃面上只用 `--fg-primary` 和 `--fg-secondary`。** `--fg-tertiary` 在最坏情况下只有 4.30:1，不得出现在半透明面板上。

类型强调色 `--rest-accent-eye/walk/combined` 保持装饰性：舞台辉光、环描边、徽标圆点、步骤标记。它们不承载文字对比度。

## 使用规则

- 导航和任务选中态使用中性背景；品牌色只落在图标、小型指示器或主操作上。
- 普通任务行默认透明，悬停与选中分别使用中性 hover/selected surface。
- 普通面板使用一层 surface 和 subtle border；只有对话框、侧滑层、Toast 等浮层使用 `shadow-overlay`。
- 雾蓝灰表示当前、执行或专注；绿色只表示成功或健康；琥珀色表示警告与临近截止；红色表示逾期、破坏性操作或失败。
- Task Detail 使用平面属性行和轻量 neutral pill，避免表单控件层层叠加品牌色背景。
- 动效只服务于浮层进出、命令反馈、选中/拖拽反馈；不为装饰加入持续循环动画。
- Workbench、Task、Project 与 Plan 样式不得直接写 `#hex`、`rgb()` 或 `rgba()`；颜色必须来自语义令牌。
- 所有需要主动阅读的文本对比度至少为 `4.5:1`。更低对比度仅允许用于装饰、禁用态和非必要提示。

## 对比度基线

核心组合的设计基线如下：

| 组合 | 对比度 |
| --- | ---: |
| Light primary / background | 15.27:1 |
| Light secondary / background | 6.29:1 |
| Light tertiary / background | 4.53:1 |
| Light primary / surface | 16.52:1 |
| Light secondary / surface | 6.80:1 |
| Light selected text / background | 13.83:1 |
| Light selected metadata / background | 5.69:1 |
| Light brand / brand-subtle | 4.80:1 |
| White / Light primary button | 5.63:1 |
| Light danger / danger-subtle | 5.26:1 |
| Light warning / warning-subtle | 5.26:1 |
| Dark primary / background | 16.53:1 |
| Dark secondary / background | 10.08:1 |
| Dark tertiary / background | 6.35:1 |
| Dark primary / surface | 15.18:1 |
| Dark secondary / surface | 9.26:1 |
| Dark selected text / background | 10.76:1 |
| Dark selected metadata / background | 6.56:1 |
| Dark brand / brand-subtle | 6.86:1 |
| Dark primary button | 8.46:1 |
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
