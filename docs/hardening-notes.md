# 加固记录（2026-08）

本文记录两轮自主代码审计（渲染端 + 主进程 + 共享层）的发现、修复与验证结果，
作为后续开发的决策背景。修复均已合入 `codex/eyeprotect-runtime-hardening` 分支。

## 审计范围

- 渲染端：`src/renderer/src/` 全部 hooks / views / features / components / lib / CSS。
- 主进程：`src/main/` 全部模块（窗口、调度内核、提醒、设置、SQLite 存储、投递、备份、
  角色、工时、场景感知、崩溃降级链）与 `src/preload/`、`src/shared/`。

## 已修复问题

| # | 发现 | 修复 |
| --- | --- | --- |
| 1 | `asTaskUpdateInput` 丢弃 `baseRevision`，乐观并发保护在 IPC 路径上是死代码，并发编辑会静默互相覆盖 | 提取 `src/main/ipcTaskInput.ts`（镜像 `ipcProjectInput.ts`）并透传 `baseRevision`，新增 5 个回归测试 |
| 2 | 崩溃恢复的进行中休息会话在启动后从不重新呈现（呈现层只响应 `changed` 事件） | 启动装配后显式 `reminderSurface.present(recoveredActive)` |
| 3 | 单实例锁失败后 `whenReady` 仍会完整启动第二实例，两个进程并发触碰同一数据文件 | `whenReady` 入口 `if (!lock) return` |
| 4 | 独立提醒送达失败后，每次 `arm()`（解锁/resume/任意增删改）都会重放同一过期 occurrence，反复弹工作台 | 会话内记录已触发 occurrence，re-arm 时越过旧 fireAt 重算；新进程仍保留一次崩溃重放语义，新增回归测试 |
| 5 | `history:export` / `data:open-directory` 的 fs 调用无错误处理，故障时以裸 rejection 到达渲染端 | try/catch 返回结构化结果 |
| 6 | `TaskScheduler.consumed` Map 会话内无界增长 | `arm()` 时清理已删除任务的标记 |
| 7 | 退出时 `ReminderTrace` 250ms 防抖缓冲未冲刷，最后一批诊断条目丢失 | `before-quit` 中 `reminderTrace.flush()` |
| 8 | 通知 click/close 双事件顺序不保证，close 先到时 `clicked` 终态丢失 | `markDeliveryOutcome('clicked')` 允许覆盖 `dismissed` |
| 9 | `useCommand` 的 in-flight 去重会丢弃携带不同参数的新调用（快速连按箭头/切换材质） | 仅对参数相同的重复调用合并；不同参数并发执行并由 generation 守卫取最新结果；箭头按钮 pending 时禁用、Plan 键盘调度忽略 pending 期间按键 |
| 10 | 深色主题下徽章/芯片白字配浅色 pastel（约 2.1:1 对比度）不可读 | 改用 `--danger-contrast` / `--brand-contrast` 令牌 |
| 11 | 设置页导出/清除/测试/暂停按钮吞掉命令失败 | 统一走 data-message 反馈；公仔卡片展示改名/材质/配饰错误 |
| 12 | 空标题编辑被静默保留旧值 | TaskDetail/TaskList 回退字段并提示「标题不能为空」 |
| 13 | 工作台搜索空查询落到 Today 页 | 增加搜索空状态页 |
| 14 | `characters.ts` 重复实现 `calendar.ts` 的 `localDateKey`（ADR-003 单一来源被破坏） | 删除重复实现，改由 `calendar.ts` 再导出 |
| 15 | 「每 N 天」提醒输入超过 365 时主进程静默拒绝创建 | UI 钳制 1–365 + 主进程抛校验错误，新增边界测试 |
| 16 | 主进程未捕获异常/未处理拒绝无任何落盘证据 | 注册 `uncaughtException` / `unhandledRejection` 处理器，写入 rolling trace（`src: 'system'`） |
| 17 | 托盘「立即休息」/测试按钮在暂停或提醒进行中时点击无效果 | 菜单按状态禁用无效项 |
| 18 | 桌宠窗口 `firingAlarms` 无界增长 | 只保留最近 5 条已触发提醒 |
| 19 | 仓库行尾混用（26 个源文件 CRLF / 其余 LF），每次提交都警告 | 新增 `.gitattributes`（`* text=auto eol=lf` + 二进制白名单） |
| 20 | `updateSettings` 清除可见 pre-alert 但保留按 deadline 的标记，延长导前时间后当前 deadline 不再出现新 pre-alert | 同时清除标记，使新导前时间立即生效，附回归测试 |
| 21 | focused 模式暗化遮罩为全黑不透明窗口（`transparent:false` + `#000000`），桌面完全不可见 | 用 `setOpacity(0.55)` 半透明暗化，保留不透明窗口实现避免透明窗口绘制问题 |

## 已验证无问题的重点

- 调度内核：deadline 队列、单定时器 + watchdog、elapsed 冻结/平移、墙钟漂移与时区变化 reconcile。
- 设置：读失败 quarantine、字段级 sanitize + 限额、tmp+rename 原子写、`get()` 防御性拷贝。
- IPC：全部 handler 经 sender URL 白名单校验；preload↔main 通道名逐一核对一致。
- 投递去重/复活、失败退避（30s/2m/5m）、启动 dead-letter 恢复与 30 天剪枝。
- 退出序列：checkpoint 停止 → markExiting → 最终保存 → 各服务 dispose → 关库 → 快捷键清理。
- 渲染端：所有 IPC 订阅与定时器在卸载时清理；日期运算全部走 DST 安全的 `calendar.ts`。

## 验证

- `npm run typecheck`、`npm test`（当前 427 个用例）、`npm run verify:ui-contract`、`npm run build`（含构建契约）全部通过。
- `npm run package` 本地验证通过：NSIS 安装包与 portable exe 均正常生成（`release/`，不入库）。
- 本地端到端 smoke：`smoke:running` 与 `smoke:experience` 对打包产物全部通过（bridge、拖拽区域、任务/日计划 IPC 往返、主题权威审计）。`smoke:workbench-interactions` 的 CDP 模拟 HTML5 拖放在本机会话不派发 drop 事件（dragstart/dragover 正常、drop 缺失）——经手动派发 drop 事件验证 React 拖放处理完好，属环境差异而非代码回归；CI 的 windows runner 上该脚本正常。
- UI 快照与打包 smoke 由 GitHub Actions Windows CI 覆盖。
