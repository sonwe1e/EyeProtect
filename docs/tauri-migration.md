# Tauri + Rust（2.0）

EyeProtect 2.0 使用 Tauri 2 + Rust，`src-tauri/` 是当前主程序，复用 React 渲染层；Electron 1.x 不再维护。仓库保留旧实现和兼容测试供查阅，默认开发、构建与发布入口均为 Tauri。

2.0 使用独立的数据目录，不读取 Electron 数据或 v8 备份。任务单次提醒由 1 秒心跳检查，到期后先记录待投递事项，再调用 Windows 通知；已发送、失败与忽略的状态保存在 `task-reminders.json`，失败可在工作台重试。安装版使用安装程序注册的应用通知身份；没有同目录卸载程序的免安装版使用 PowerShell 身份，发送方可能显示为 PowerShell。系统通知被用户关闭或系统抑制时，Windows 接受调用不保证通知实际可见。该投递记录不进入备份。

任务和清单修改先写入候选数据，写入成功后才更新内存和广播。设置保存失败直接返回错误。备份导入先保存回滚快照，逐文件写入失败时恢复已替换的原文件；如回滚本身失败，提示使用快照恢复。快照不是跨文件崩溃事务。

## 阶段三范围（新增）

| 能力 | 实现 | 对应 Electron 源 |
| --- | --- | --- |
| 前台检测 | `wincontext.rs`：进程内 Win32 采样线程（40 ms 键盘聚合计数 / 2 s 前台+全屏+ConsentStore 麦克风摄像头），无子进程；完整决策链（免打扰 → 全屏勿扰 → 摄像头麦克风 → 会议应用/白名单 → 连续输入）逐条对齐 `contextDecision`，含相同文案与延后秒数 | `src/main/reminderContext.ts`（PowerShell helper 改为进程内 FFI） |
| smoke:tauri | `scripts/smoke-tauri.mjs`：CDP 驱动真实 release 产物——pet 渲染、桥接安装、settings invoke 往返、调度器响应、工作台打开、任务创建/列表、退出后 settings.json + tasks.json 落盘断言；每实例独立 WebView2 user-data-dir（共享目录会吞掉调试端口并出现陈旧 target），进程树清理 | `scripts/smoke-simple-experience.mjs` 的 Tauri 对应物 |
| 主线程死锁修复 | 窗口工作在异步池执行；窗口操作期间仍可能持有 `Core` 锁并等待主线程查询窗口，所以有状态的 Tauri 命令、托盘和热键入口也在主线程之外获取这把锁。启动期先完成状态初始化，再发布窗口更新；不触碰首航中的 pet 窗口（会在导航完成前重摆导致 about:blank） | —（Electron 无此约束） |

## 阶段二范围

| 能力 | 实现 | 对应 Electron 源 |
| --- | --- | --- |
| 备份导出/导入 | 自有 JSON 格式（`eyeprotect-tauri-backup` v1：设置 + 任务/清单 + 活动任务 + 提醒历史）；导入前写回滚快照 `import-rollback-<ts>.json`，快照写失败则拒绝导入；原生保存/打开/确认对话框（tauri-plugin-dialog）。**不读取 Electron v8 备份** | `src/main/backup.ts` + index.ts 对应 IPC |
| 免打扰时段 | `reminder_context.rs`：本地时钟窗口（跨午夜回绕）；真实到期提醒延后 5 分钟并在 `contextDeferral` 透出原因；预提醒与喝水槽位在窗口内静默（槽位照常消耗）；手动/测试提醒绕过 | `src/main/reminderContext.ts` 的 quiet-hours 切片 |
| 全局热键 | tauri-plugin-global-shortcut：Ctrl+Alt+B/P/A/T/H（立即休息/暂停切换/打开待办×2/桌宠开关）；冲突进入 `hotkeys:status` 的 conflicts；设置开关即时生效 | index.ts `applyGlobalHotkeys` |
| 开机自启 | tauri-plugin-autostart（注册表 Run 键）；与 Electron 一致仅打包模式管理 | index.ts `syncStartupShortcut` |
| 打包 | `npm run package` → NSIS 安装包、免安装 EXE 与 SHA-256 校验值（`release/`）；两者数据均保存在用户数据目录 | electron-builder（历史 1.x 产物不同） |

## 阶段一范围

已实现（Rust 后端，`src-tauri/src/`）：

| 模块 | 职责 | 对应 Electron 源 |
| --- | --- | --- |
| `scheduler.rs` | 护眼/走动调度：合并窗口、预提醒、暂停冻结、稍后/跳过/完成、强制休息时长、自然休息（墙钟跳变看门狗）、快照恢复 | `src/main/reminders.ts` + `scheduling/kernel.ts` |
| `tasks.rs` | 任务/清单/步骤域：revision 冲突拒绝、整树完成、步骤序、队列重排（不动 revision）、10 秒撤销、完成记录恢复 | `src/main/taskStore.ts` + `taskService.ts`（简单模式） |
| `pomodoro.rs` | 番茄钟状态机 + 剩余时间推进（elapsed 语义，每 10s 重发布） | `src/main/pomodoro.ts` |
| `hydration.rs` | 喝水时刻：派生间隔网格、槽位只耗一次、sip→strip 生命周期 | `src/main/hydration.ts` + `shared/hydration.ts` |
| `history.rs` | 提醒事件留存 + 本周休息陪伴摘要 | `src/main/reminderHistory.ts` |
| `windows.rs` / `winarea.rs` | 桌宠/气泡/提醒/工作台窗口 + 全屏变暗遮罩；工作区计算走 Win32 FFI | `src/main/windows.ts` + `windowBounds.ts` |
| `tray.rs` | 托盘菜单（按状态重建）+ 桌宠右键菜单 | `src/main/index.ts` 的 tray/context-menu |
| `commands.rs` | 全部 60 个 invoke 命令（通道名冒号→下划线），入参白名单与错误文案与 IPC 层一致 | `src/preload/index.ts` + `ipcTaskInput.ts` |
| `state.rs` | 装配、每秒 tick、发布循环（事件广播/落盘/窗口副作用） | `src/main/index.ts` 装配段 |

渲染层：`src/renderer/src/lib/tauriBridge.ts` 在 Tauri 运行时把 `window.eyeProtect` 桥接到 invoke/event，React 代码零改动；入口 `web.html`（IPC 放行的 CSP）与遮罩页 `dim.html` 由 `vite.web.config.ts` 单独构建到 `out/web/`。

喝水提示在真正发出时读取 Windows 的[客户端动画设置](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfoa)：系统关闭动画或桌宠动效关闭时，直接显示提示条，不等待无法看到的喝水动作。读取失败回退正常动作；不改变喝水计数与槽位规则。

**数据策略（用户已确认）**：Tauri 侧使用全新数据存储（`%APPDATA%\local.eyeprotect.pet\`，可用 `EYEPROTECT_DATA_DIR` 覆盖），不读写 Electron 的 `data/` 目录。文件名与结构（settings.json / runtime-state.json / pomodoro-state.json / hydration-state.json / reminder-history.json / tasks.json）沿用 Electron 约定，任务为 JSON 存储而非 SQLite。

## 运行与验证

```bash
npm run dev:tauri   # Tauri 开发模式（自动起 vite dev server :5199）
npm run build:tauri # 打包（NSIS）
cargo test          # Rust 单元测试（src-tauri/）
npm run typecheck && npm test
npm run smoke:tauri-write-failure
npm run smoke:tauri-task-reminder
```

桌宠切换的线程竞争可用隔离调试构建验证：`npm exec tauri build -- --debug --no-bundle --config src-tauri/tauri.smoke.conf.json`，将 `EYEPROTECT_TAURI_EXE` 指向生成的 debug exe 后运行 `npm run smoke:tauri-threading`。负对照会让它自己的临时实例卡住并结束该实例，再验证真实设置命令能通过同一竞争；不会结束用户正在运行的应用。`npm run smoke:tauri` 还会在有待办气泡时反复切换桌宠。

## 已知差距（后续阶段补齐）

- 备份格式不与 Electron v8 互通（跨版本迁移后续按需提供）。
- NonPackaged 摄像头/麦克风注册表项不再校验进程存活（略保守，见 wincontext.rs 注释）。
- 提醒崩溃兜底（emergency 窗口/ReminderSurfaceManager 回退链）未移植。
- 系统 suspend/resume 以墙钟跳变看门狗近似（无 powerMonitor）。
- Electron 侧 smoke 脚本（缩放矩阵、--emergency）尚未为 Tauri 复刻；smoke:tauri 为单机冒烟。
- 多显示器混合 DPI 下桌宠拖动跨屏可能有轻微换算偏差（按目标屏 scale 换算）。

## 验证记录（阶段三交付时）

`cargo test` 40/40（新增场景决策 4 项）；`npm run typecheck` 通过；`npm test` 641/641；`npm run smoke:tauri` 端到端通过（真实 release 产物：渲染 + invoke + 调度 + 工作台 + 任务 + 持久化）。

## 界面与动效复核（2026-10-28）

`cargo test` 42/42，`npm run build:tauri` 与 `npm run smoke:tauri` 通过。隔离数据的 Tauri/WebView2 实窗覆盖设置分区跳转与保存、所选伙伴、任务创建与定位、长标题和步骤、模拟窄视口、减少动效和休息提醒，并核对设置和任务文件落盘。Windows 动画开关对应的喝水分支通过注入偏好的 Rust 单元测试；本轮没有切换系统设置验证两种真实系统状态，也未完成物理多显示器或混合 DPI 验收。

## 验证记录（阶段二交付时）

`cargo test` 36/36（新增免打扰 4 项、备份往返/拒绝 3 项）；`npm run typecheck` 通过；`npm test` 641/641；`npm run build:tauri` 产出 NSIS 安装包。

## 验证记录（阶段一交付时）

`cargo test` 29/29；`npm run typecheck` 通过；`npm test` 641/641；`npm run build:web` 成功；`cargo build` 成功；dev 模式启动冒烟：进程存活、pet 窗口创建、settings.json / runtime-state.json 按约定格式落盘。
