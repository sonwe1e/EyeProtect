# 核心结论

我基于当前 `master` 分支、v0.5.0 的代码进行了文件级审查。项目不需要立刻迁移 Tauri 或重写；现有 Electron + React 架构足以继续演进，但需要优先解决三个结构性问题：

1. **状态事件过于粗糙**：修改一个待办，也会触发“全局设置变化”，进而同步开机快捷方式、重设桌宠窗口、广播所有设置。
2. **常驻窗口和渲染资源偏多**：桌宠与待办气泡分别使用 BrowserWindow；气泡隐藏后不销毁；所有窗口加载同一个完整 React 包。
3. **提醒调度缺少操作系统生命周期意识**：后台每秒唤醒一次，没有处理休眠、锁屏、用户离开、重启恢复等场景。

推荐目标是：

> **保留一个极简常驻桌宠窗口；设置、面板、提醒窗口全部按需创建和销毁；主进程采用领域化状态事件和单次 deadline 调度。**

这样可以在不改技术栈的前提下，同时提升体验、视觉一致性和后台资源效率。

---

# 一、当前架构评估

项目目前是 Electron 33 + React 18 + electron-vite。主进程管理桌宠、设置、面板、待办气泡和多显示器遮罩；所有窗口加载同一个 `index.html`，再通过 URL hash 决定渲染哪个视图。

现有基础并不差：

* 已使用单实例锁。
* `contextIsolation` 已启用，`nodeIntegration` 已关闭。
* Renderer 通过受限 preload API 与主进程交互。
* CSP 已配置。
* 设置窗口、面板窗口关闭后会销毁。
* 配置文件通过临时文件加原子重命名写入。
* 提醒、闹钟、待办和窗口尺寸已有单元测试。

因此技术路线应该是**渐进式重构，而不是框架迁移**。

---

# 二、需要优先处理的具体问题

## 1. 待办和闹钟操作会触发大量无关工作

目前待办的增加、完成、编辑、删除和优先级变化都会同时触发：

* `changed`
* `todos-changed`

而 `changed` 在 `src/main/index.ts` 中会继续执行：

* `scheduler.updateSettings`
* `syncStartupShortcut`
* `windows.applySettings`
* `windows.broadcastSettings`

这意味着用户勾选一个待办时，程序可能重新检查开机快捷方式、重新调用桌宠 `setBounds`、向所有窗口广播完整 Settings，然后再额外广播 Todo 列表。闹钟变化也存在相同问题。

这是当前最值得优先修复的后台问题。它比 `settings.json` 文件本身的大小更重要，因为它造成了重复 IPC、重复 React 更新和重复窗口操作。

### 推荐修改

不要立即拆成多个物理 JSON 文件，而是先拆分事件语义：

* `preferences-changed`
* `pet-preferences-changed`
* `todos-changed`
* `alarms-changed`
* `reminder-runtime-changed`

在 `src/main/index.ts` 中按领域订阅：

* 只有提醒间隔变化才调用 `scheduler.updateSettings`。
* 只有 `startWithWindows` 变化才调用 `syncStartupShortcut`。
* 只有桌宠大小、皮肤、遮罩设置变化才调用 `windows.applyPetSettings`。
* Todo 变化只通知 Pet、Bubble 和 Panel。
* Alarm 变化只通知 Panel 并持久化。
* Pet 位置变化只写文件，不广播其他窗口。

这是低风险、高收益的第一阶段改动。

---

## 2. BubbleWindow 隐藏后仍然长期保留

当前待办气泡使用独立 BrowserWindow。没有待办、面板打开或提醒触发时，只调用 `hide()`；窗口及其 WebContents 并未销毁。下次显示时复用原窗口。

Electron 明确区分 `hide()`、`close()` 和 `destroy()`。隐藏窗口只是不可见，销毁才会结束窗口网页实例。Electron 也建议在页面不可见时暂停昂贵操作。([Electron][1])

### 推荐分两步实现

**第一步，低风险版本：**

在 `src/main/windows.ts` 增加气泡销毁策略：

* 面板打开时先隐藏。
* 隐藏持续超过一个短暂冷却周期后销毁。
* Todo 为空或全部完成时立即销毁。
* 再次需要显示时重新创建。
* 加入创建中的 Promise 或状态，避免多个 `refreshBubble()` 并发创建窗口。

**第二步，可选深度优化：**

把 Bubble 合并进桌宠窗口：

* 扩大透明桌宠窗口的逻辑区域。
* 桌宠放在窗口下方，气泡放在上方。
* 没有气泡时缩小窗口。
* 处理透明区域点击穿透和拖动区域。

第二步能减少一个常驻 WebContents，但实现复杂度较高。建议先做“隐藏后销毁”，测量后再决定是否合并。

---

## 3. 提醒内容加载在长期存活的桌宠渲染进程内

当前桌宠窗口既负责常驻小人物，又负责放大后的提醒界面。提醒触发时，主进程直接把桌宠窗口从小尺寸放大到显示器中心；结束后再恢复。

提醒界面还会在 6 张护眼图片、6 张走动图片之间轮换；组合提醒会使用两组图片。图片在同一个长期存活的 Renderer 中解码和缓存，提醒结束后这些缓存不一定马上归还。

### 推荐目标结构

将提醒窗口从桌宠窗口中拆出：

```text
PetWindow
  长期存在
  只渲染桌宠、快捷入口和轻量状态

AlertWindow
  提醒触发时创建
  加载独立的提醒视图和图片
  提醒结束后直接销毁

DimOverlayWindow
  需要暗化桌面时创建
  提醒结束后销毁
```

具体修改：

* `AppWindows.applyReminderStatus()` 不再修改 PetWindow 尺寸。
* ActiveReminder 出现时：

  * 隐藏或弱化桌宠窗口。
  * 关闭 Panel 和 Bubble。
  * 创建 AlertWindow。
  * 根据当前显示器调用 `getAlertBounds()`。
* ActiveReminder 结束时：

  * 销毁 AlertWindow。
  * 销毁遮罩。
  * 恢复 PetWindow 和 Bubble。

这样不仅释放提醒图片缓存，也让桌宠位置、拖动和提醒布局彻底解耦。

建议将当前 `windows.ts` 拆成：

```text
src/main/windows/
  WindowCoordinator.ts
  PetWindowController.ts
  AlertWindowController.ts
  PanelWindowController.ts
  BubbleWindowController.ts
  OverlayController.ts
  bounds.ts
```

---

## 4. 后台调度器每秒永久唤醒

`ReminderScheduler.start()` 使用固定 1 秒 `setInterval`，无论距离下一次提醒还有 10 秒还是 4 小时，都会每秒执行一次检查。

这不会造成严重内存泄漏，但会产生持续 CPU 唤醒，与桌宠的无限 CSS 动画叠加后，不利于笔记本续航。

### 推荐改成单次 deadline 调度

在 `src/main/reminders.ts` 中用 `armNextTimer()` 替代固定 interval：

1. 计算以下时间中的最早值：

   * `nextEyeAt`
   * `nextWalkAt`
   * `pausedUntil`
2. 使用单次 `setTimeout` 等待最近 deadline。
3. 到期后执行一次 reconcile。
4. 状态处理完成后重新安排下一次 timer。
5. 修改设置、暂停、恢复、完成、稍后时，取消旧 timer 并重新安排。

这样在距离提醒很远时，主进程几乎不做无用工作。

### 同时处理系统生命周期

在 `src/main/index.ts` 中接入 Electron `powerMonitor`：

* `suspend`：记录挂起时间，不弹提醒。
* `resume`：立即重新计算 overdue 状态。
* `unlock-screen`：不要立刻强制弹窗，先给一个恢复宽限期。
* 到期时调用 `getSystemIdleTime()`：

  * 用户已经离开较长时间，视为已经自然休息。
  * 用户回来后重新开始一轮或保留少量剩余时间。

Electron 官方提供 suspend、resume、unlock-screen、空闲时间和空闲状态接口，适合完成这一层逻辑。([Electron][2])

不建议为了检测游戏或会议而高频轮询前台进程。第一阶段只做锁屏、休眠和系统空闲，可靠性更高，资源也更低。

---

## 5. 提醒运行状态没有持久化

当前 `ReminderScheduler` 在构造时直接从当前时间重新计算下一次提醒。程序重启后：

* 原来的剩余时间丢失。
* 暂停状态丢失。
* 稍后周期丢失。
* 用户可以通过重启绕过即将到来的提醒。

### 推荐增加独立 RuntimeStateStore

不要把运行状态继续塞进 Settings。新增：

```text
data/
  settings.json
  runtime-state.json
```

运行状态至少保存：

* `nextEyeAt`
* `nextWalkAt`
* `pausedUntil`
* 当前 snooze cycle
* 上次正常退出时间
* schema version

只在状态发生转换时写入：

* 提醒完成、跳过、稍后。
* 暂停、恢复。
* 修改提醒间隔。
* 应用退出。
* 系统挂起前。

不需要逐秒写入。

启动恢复时：

* 如果状态文件有效且时间合理，继续使用。
* 如果应用离线过久，不补发多次提醒，只进行一次 reconcile。
* 如果状态损坏，备份损坏文件并重新建立默认状态。

---

## 6. 暂停语义需要调整

现在暂停 1 小时后，会把下一次护眼安排在：

> 暂停结束时间 + 完整护眼间隔

例如距离护眼只剩 2 分钟时暂停 1 小时，恢复后还要再等 20 分钟。

更符合用户直觉的方式是“冻结剩余时间”：

* 暂停时保存护眼和走动分别剩余多少时间。
* 恢复后从剩余时间继续。
* 另提供“重新开始计时”操作，用于用户确实想重置周期的场景。

需要新增：

* `scheduler.pause(minutes)`
* `scheduler.resume()`
* `scheduler.restartCycle()`

托盘菜单也要区分：

* 暂停 30 分钟
* 暂停 1 小时
* 今日停用
* 恢复提醒
* 重新开始计时

---

# 三、当前存在的明确功能缺陷

## 1. “单次闹钟”实际上会在重启后再次响起

闹钟触发时，`fire()` 对 daily 闹钟重新安排，但对 once 闹钟既不删除，也不禁用，也不触发 `changed`。因此它仍然以 `enabled: true` 存在于持久化列表中；应用重启后 `hydrate()` 会把它安排到下一天。当前测试甚至固定了这一行为。

### 修改方案

在 `src/main/alarms.ts`：

* once 触发后从列表移除，或者改为 `enabled: false`。
* 触发 `changed`，使 SettingsStore 持久化。
* `hydrate()` 前先清理已有 timer，避免重复 hydrate。
* 增加 `dispose()`，应用退出时取消所有 timer。

同步修改 `tests/alarms.test.ts`：

* 单次闹钟触发后不再存在或处于 disabled。
* 重启后不会再次触发。
* daily 闹钟仍会正确重新安排。

---

## 2. 提醒从 eye 合并成 combined 时，倒计时不会更新

Renderer 中等待时间的 effect 只依赖 `active.id`。Scheduler 在吸收另一类提醒时，会保留原 id，只把 kind 改为 `combined`。因此原本 30 秒的护眼提醒变成 combined 后，UI 不会重新按 60 秒计算。

### 推荐修复方式

不要只把依赖改成 `active.id + active.kind`，而是把规则移到主进程：

在 `ActiveReminder` 中增加：

* `unlockAt`
* `snoozeAllowedAt`
* `mode`

Renderer 只根据时间戳显示剩余时间。合并时由 Scheduler 更新 `unlockAt`，主进程也校验 action 是否允许。

这样即使 Renderer reload、窗口重建或收到重复 IPC，也不能绕过规则。

---

## 3. 设置页的“剩余 N 分钟”会停住

`minutesLeft()` 使用 `Date.now()`，但设置页没有分钟级 tick。Scheduler 也不会每分钟广播状态，因此设置窗口打开后，“剩余 18 分钟”可能长期不变。

### 修改方案

新增通用 `useClock()`：

* 设置页打开时每 30 或 60 秒刷新一次。
* AlertWindow 活跃时每秒刷新。
* Bubble、Panel 不启动时钟。
* 页面 hidden 时暂停。

托盘菜单只需在用户打开菜单时即时计算，不需要后台每秒刷新。

---

## 4. 桌宠上的待办徽章统计的是总数，不是未完成数

Bubble 和 Panel 已经使用未完成数量，但 PetView 仍直接使用 `todos.length`。全部完成后，桌宠仍然显示待办徽章；Bubble 也会继续存在并显示已完成项目。

### 修改方案

统一派生一个 `pendingTodos`：

* 桌宠徽章显示 pending count。
* Bubble 只预览 pending。
* pending 为零时，Bubble 先显示短暂的“全部完成”，随后销毁。
* Panel 中保留已完成项，但增加“清除已完成”。
* 可选自动清理较早的已完成项，避免列表无限增长。

---

## 5. SettingsStore 的 alarms 没有深拷贝

`SettingsStore.get()` 对 petPosition 和 todos 做了复制，但 alarms 数组仍直接暴露内部引用。

应增加 alarms 数组和对象的复制，避免调用方意外修改 Store 内部状态。

同时增强反序列化：

* Todo 文本读取时也要 trim 和限制长度。
* Alarm label 限制长度。
* 时间戳必须是有限数值。
* Settings 增加 schema version 和 migration。
* JSON 读取失败时备份原文件，而不是静默回到默认值。

---

# 四、推荐的目标主进程架构

```text
Main Process
├── AppStore
│   ├── PreferencesDomain
│   ├── TodoDomain
│   ├── AlarmDomain
│   └── RuntimeStateDomain
│
├── DeadlineService
│   ├── Reminder deadlines
│   ├── Alarm deadlines
│   ├── pause/resume
│   └── sleep/idle reconciliation
│
├── WindowCoordinator
│   ├── PetWindowController
│   ├── AlertWindowController
│   ├── BubbleWindowController
│   ├── PanelWindowController
│   ├── SettingsWindowController
│   └── OverlayController
│
├── TrayController
│   └── dynamic status/menu
│
└── Diagnostics
    ├── process metrics
    ├── window lifecycle counters
    └── IPC counters
```

不一定要一次性创建全部类。建议先保留原有类名，逐步把职责移出 `index.ts` 和 `windows.ts`。

---

# 五、Renderer 的详细重构路线

## 1. 拆分 `App.tsx`

当前一个 `App.tsx` 同时包含：

* Pet
* Alert
* Bubble
* Panel
* Todo
* Alarm
* Settings
* 输入组件

并且所有窗口都加载同一个完整 bundle。

建议调整为：

```text
src/renderer/src/
├── app/
│   └── Router.tsx
├── views/
│   ├── PetView.tsx
│   ├── AlertView.tsx
│   ├── BubbleView.tsx
│   ├── PanelView.tsx
│   └── SettingsView.tsx
├── features/
│   ├── reminders/
│   ├── todos/
│   ├── alarms/
│   └── pet/
├── hooks/
│   ├── useReminderState.ts
│   ├── useTodos.ts
│   ├── useAlarms.ts
│   ├── usePreferences.ts
│   └── useClock.ts
└── styles/
    ├── tokens.css
    ├── base.css
    ├── pet.css
    ├── alert.css
    ├── panel.css
    └── settings.css
```

## 2. 按窗口加载数据

当前 Pet 和 Settings 都使用 `useAppState()`，启动时一次获取 Settings、ReminderStatus、RuntimeInfo、Alarms 和 Todos，并注册四类监听。Pet 实际上不需要完整闹钟列表和 RuntimeInfo，Settings 也不需要 Todo 列表。

拆分后：

* Pet：只订阅桌宠偏好、pending todo count、闹钟 fired。
* Alert：只订阅 ActiveReminder 和 action availability。
* Bubble：只订阅 pending todos。
* Panel：订阅 todos 和 alarms。
* Settings：订阅 preferences、reminder status 和 runtime。
* 不再向所有窗口发送所有事件。

## 3. 使用动态导入或多入口构建

先采用低风险方案：

* Router 根据 hash 动态 import 对应 View。
* Vite 自动生成独立 chunk。
* 每个 BrowserWindow 只解析自身需要的代码。

进一步优化时，再在 `electron.vite.config.ts` 配置多个 HTML 入口：

* `pet.html`
* `alert.html`
* `panel.html`
* `bubble.html`
* `settings.html`

多入口更彻底，但动态 import 已能解决大部分无用 bundle 解析问题。

---

# 六、提醒体验的推荐改造

当前提醒属于较强制的模型：

* 桌面直接置黑。
* 提醒窗口放大。
* 完成操作需要等待 30 或 60 秒。
* 当前等待规则实际上始终启用，不再是可选的 force-rest。

建议引入三种模式：

| 模式 | 行为                      |
| -- | ----------------------- |
| 温和 | 到点显示小提醒；所有操作立即可用；不暗化桌面  |
| 引导 | 提醒窗口展开并显示建议休息时间，但允许提前完成 |
| 专注 | 暗化背景；完成和再次稍后需要等待；保留紧急跳过 |

默认建议使用“引导”，而不是当前强制等待。

提醒流程改为：

1. 到期前 30 秒，由托盘或轻量通知预告。
2. 到期时先显示桌宠附近的提醒卡。
3. 用户确认休息，或者超过宽限期后，再创建完整 AlertWindow。
4. 完成后显示短暂正反馈并销毁窗口。
5. 连续多次跳过时，下一次提醒适度提前，而不是和完成完全相同。

当前主进程把 complete 和 skip 都安排为完整下一周期，二者只有名称不同。建议在 RuntimeState 中记录动作类型，为后续统计和自适应策略保留依据。

---

# 七、托盘应成为主要控制入口

目前托盘菜单是启动时静态构建，只包含打开设置、暂停一小时、测试和退出；`rebuildMenu()` 实际只调用了一次。

建议新增 `TrayController`，每次打开菜单时根据当前状态构建：

```text
EyeProtect · 运行中
下次护眼：14:30
下次走动：15:10

立即休息
暂停 30 分钟
暂停 1 小时
今日停用

待办：3 项
打开待办
打开设置
退出
```

暂停时显示：

```text
EyeProtect · 已暂停至 16:00
恢复提醒
重新开始计时
```

托盘 tooltip 只在分钟数或状态发生变化时更新，不要逐秒更新。

---

# 八、美观和设计系统改造

当前界面已经形成暖白、绿色和低饱和度的基本视觉风格，但颜色、阴影、圆角和字号散落在一个超过千行的 CSS 文件中；Todo 优先级颜色还直接写在 TypeScript 中。

## 建议建立设计令牌

在 `tokens.css` 统一定义：

* 表面背景、主背景、悬浮层背景。
* 主文字、次级文字、弱提示文字。
* 强调色、成功色、警告色、危险色。
* 4、8、12、16、24 像素间距。
* 小、中、大三类圆角。
* 浮层和面板两类阴影。
* 12、14、16、20、28 字号层级。
* 快速、标准、慢速三种动画时长。

Priority 不再使用 inline style，而是：

* `data-priority="normal"`
* `data-priority="important"`
* `data-priority="urgent"`

由 CSS 负责颜色。

## 可读性改进

当前 Panel 中大量字体为 10～11px，按钮也只有 16～22px，桌宠缩小时工具按钮还会继续按 vw 缩小。

建议：

* 正文最低 12～13px。
* 交互点击区域最低约 28～32px。
* 工具栏尺寸使用带最小值的 clamp，而不是完全依赖 vw。
* 双击编辑、点击优先级圆点等隐藏交互，增加可见的编辑按钮或菜单。
* 设置页增加浅色、深色、跟随系统。
* `index.html` 的语言从 `en` 改为 `zh-CN`。

---

# 九、持续动画与图片资源优化

桌宠图片目前持续执行无限 transform 动画，即使用户完全没有操作，Renderer/GPU 仍可能持续参与合成。

建议改为：

* 默认静止。
* 每隔较长时间播放一次短动作。
* 电池供电时降低动作频率。
* 用户空闲或锁屏时停止动画。
* 增加“静态桌宠”设置。
* 保留 `prefers-reduced-motion` 支持。

不要为了节省内存直接关闭硬件加速。关闭 GPU 可能反而增加 CPU 和窗口绘制成本，应以测量结果决定。

另外，当前 UI 路径使用 PNG 桌宠和提醒图片，而 `@rive-app/react-canvas` 依赖及 `character.riv` 检测仍然存在。当前 Renderer 中没有实际的 Rive 组件使用路径，这部分看起来是未完成或遗留功能。

建议二选一：

* 当前版本彻底移除 Rive 依赖、RuntimeInfo 字段和 README 说明。
* 后续明确实现 Rive，并单独评估 CPU、GPU 和内存成本。

从资源占用目标出发，建议暂时移除。

---

# 十、安全和发布阻断项

## 1. 立即轮换仓库中出现的密钥

最新 v0.5.0 提交新增的根目录 `1.py` 中存在硬编码访问密钥。不要只删除文件：

1. 在服务端立即撤销并重新生成密钥。
2. 删除 `1.py`。
3. 使用历史清理工具从 Git 历史中移除。
4. 强制更新远端历史。
5. 检查 GitHub Secret Scanning 和服务端访问日志。
6. 后续只从环境变量读取，并提交 `.env.example`，不能提交真实值。

最新发布提交是 `41172e07cf457b05390a1330df2b46827647878a`。

## 2. 启用 Renderer sandbox

Pet、Settings、Panel 和 Bubble 当前都明确配置了 `sandbox: false`。

Preload 只依赖 Electron IPC，理论上适合迁移到 sandbox。Electron 官方安全清单建议：

* context isolation
* process sandbox
* CSP
* IPC sender 验证
* 限制导航和新窗口。([Electron][3])

建议：

* 所有业务窗口改为 `sandbox: true`。
* IPC handler 校验 `event.senderFrame` 是否来自本应用允许的页面。
* 设置 `will-navigate` 阻止外部导航。
* 设置 `setWindowOpenHandler` 拒绝创建新窗口。
* 继续保留当前 CSP。

## 3. Windows 可执行文件未签名

`package.json` 当前设置 `signAndEditExecutable: false`。

这会影响 SmartScreen 信任和用户安装体验。正式分发阶段应增加：

* Windows 代码签名。
* portable 与 installer 两种构建目标。
* 版本信息、图标和 publisher metadata。
* 自动化发布流程。

---

# 十一、测试与性能验收体系

Electron 提供 `app.getAppMetrics()` 和进程内存信息接口，可以按进程观察 CPU 和内存，而不是只看任务管理器中的总数。([Electron][4])

建议新增 `src/main/diagnostics.ts`，只在开发模式或显式诊断参数下启用，记录：

* 每个 Electron process 的类型、PID、private memory 和 CPU。
* 当前 BrowserWindow 数量。
* Window 创建、隐藏、销毁次数。
* 各 IPC channel 调用次数。
* Scheduler 唤醒次数。
* 设置文件写入次数。

至少建立以下场景基线：

| 场景           | 主要验收项                    |
| ------------ | ------------------------ |
| 无待办空闲        | 仅 PetWindow 常驻；CPU 接近空闲  |
| 有待办气泡        | Bubble 增量内存可观察；隐藏后销毁     |
| 设置窗口反复打开关闭   | Window 数量不增长；内存不单调增长     |
| Panel 反复打开关闭 | 事件监听和 timer 不增长          |
| 组合提醒         | Alert 结束后图片 Renderer 被销毁 |
| 双显示器遮罩       | 遮罩数量正确并全部销毁              |
| 休眠后恢复        | 不连续弹出积压提醒                |
| 连续运行         | 线程、句柄、窗口、内存保持稳定          |

建议把目标定义为相对指标，而不是先拍脑袋规定绝对内存：

* Phase 1 后，待办操作不再触发无关窗口和快捷方式处理。
* Phase 2 后，Scheduler 空闲阶段不再每秒唤醒。
* Phase 3 后，隐藏 Bubble 和结束 Alert 后对应 WebContents 被销毁。
* 重复 50 次打开/关闭窗口后，窗口数、监听器数和 timer 数回到基线。
* 长时间运行内存没有持续单调增长。

现有单元测试覆盖核心算法，但需要补充：

```text
tests/
  store-events.test.ts
  scheduler-persistence.test.ts
  scheduler-power.test.ts
  alarms-once.test.ts
  reminder-action-lock.test.ts
  todo-retention.test.ts
```

并增加 Electron 级集成测试，覆盖真实 BrowserWindow 生命周期；纯 Node 测试无法验证窗口销毁和 Renderer 内存。

---

# 十二、文件级修改清单

| 文件                            | 主要修改                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `src/main/index.ts`           | 拆分启动编排；领域事件订阅；接入 powerMonitor；动态托盘；IPC sender 校验                               |
| `src/main/reminders.ts`       | setInterval 改 deadline timer；resume；持久化；idle/resume reconcile；主进程 action lock  |
| `src/main/alarms.ts`          | 修复 once 语义；hydrate 清理；dispose；恢复和错过策略                                          |
| `src/main/settings.ts`        | 领域事件；深拷贝 alarms；schema migration；错误恢复；减少无关写入和广播                                |
| `src/main/windows.ts`         | 拆分 Controller；Alert 独立窗口；Bubble 销毁策略；目标窗口广播；显示器事件                              |
| `src/main/windowBounds.ts`    | 保留纯函数；增加 Overlay union bounds 和多显示器变化测试                                        |
| `src/shared/types.ts`         | Preferences/RuntimeState 分离；unlockAt；reminder mode；schema version；严格 sanitizer |
| `src/preload/index.ts`        | 按窗口缩小 API；增加 resume、tray/状态相关接口；保持安全封装                                         |
| `src/renderer/src/App.tsx`    | 拆分视图与 feature；删除通用 useAppState；动态加载                                            |
| `src/renderer/src/styles.css` | 拆分样式；设计令牌；深色模式；改善字号和点击区域                                                       |
| `src/renderer/index.html`     | `lang="zh-CN"`；继续强化 CSP                                                        |
| `electron.vite.config.ts`     | 动态 chunk 或多 Renderer 入口                                                        |
| `package.json`                | 移除未使用 Rive；增加质量脚本；签名和发布配置                                                      |
| `tests/*.test.ts`             | 修正 once 测试；新增生命周期、持久化和事件隔离测试                                                   |
| `README.md`                   | 更新实际角色资源方案、数据位置、暂停语义和发布方式                                                      |
| 根目录 `1.py`                    | 删除，轮换密钥并清理 Git 历史                                                              |

---

# 十三、推荐实施顺序

## P0：立即修复

* 撤销泄露密钥并清理历史。
* 修复单次闹钟。
* 修复 combined 倒计时。
* Todo 徽章和 Bubble 改为未完成数量。
* `SettingsStore.get()` 深拷贝 alarms。
* `app.getVersion()` 替代环境变量版本获取。
* `lang="zh-CN"`。

## P1：消除无关后台工作

* 拆分 SettingsStore 事件。
* 停止 Todo/Alarm 引发 scheduler、startup 和 pet bounds 更新。
* 将 `sendAll()` 改为目标窗口发送。
* 开机快捷方式只在对应设置发生变化时同步。

## P2：调度与系统生命周期

* deadline timer 替代每秒 interval。
* pause/resume 保存剩余时间。
* RuntimeState 持久化。
* powerMonitor 处理休眠、恢复、锁屏和 idle。
* 动态托盘菜单。

## P3：窗口和内存架构

* 独立 AlertWindow。
* Bubble 隐藏后销毁。
* Overlay 生命周期重构。
* 处理显示器增加、移除、DPI 和工作区变化。
* 所有业务 Renderer 启用 sandbox。

## P4：Renderer 与视觉重构

* 拆分 App、hooks 和样式。
* 按视图动态加载。
* 设置页改为模式预设优先。
* 深色模式、设计令牌和可读性调整。
* 减少连续动画和提醒图片数量。

## P5：测量和发布

* 进程级内存与 CPU 诊断。
* Electron 窗口生命周期集成测试。
* 长时间稳定性测试。
* Windows 签名和自动化发布。

---

# 最终建议

EyeProtect 当前最大的问题并不是 Electron 本身，而是**领域事件耦合、窗口生命周期和长期 Renderer 负载**。先完成事件隔离、deadline 调度、Alert 独立窗口和 Bubble 销毁，通常就能获得最明显的体验与资源改善；在这些改动完成并建立测量基线之前，不建议投入成本迁移桌面框架。

[1]: https://www.electronjs.org/docs/latest/api/browser-window?utm_source=chatgpt.com "BrowserWindow | Electron"
[2]: https://www.electronjs.org/docs/latest/api/power-monitor?utm_source=chatgpt.com "powerMonitor | Electron"
[3]: https://www.electronjs.org/docs/latest/tutorial/security?utm_source=chatgpt.com "Security | Electron"
[4]: https://www.electronjs.org/docs/latest/api/app?utm_source=chatgpt.com "app | Electron"
