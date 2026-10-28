# CLAUDE.md

EyeProtect 是本地优先的 Windows 休息提醒与待办助手。2.0 使用 Tauri 2、Rust、React 和严格 TypeScript；Electron 1.x 已停止维护。工程准则见 [RULES.md](RULES.md)，当前架构与数据边界见 [docs/tauri-migration.md](docs/tauri-migration.md) 和 [docs/architecture.md](docs/architecture.md)。

## 当前产品

主界面为待办、完成记录、设置。任务可以添加截止日期、单次提醒、备注和一层步骤；桌宠气泡显示手选任务或番茄钟。护眼与走动提醒显示休息窗口，真正显示后自动开始并暂停专注，专注仍需手动继续。喝水提示独立于健康休息调度。

2.0 使用独立的 `%APPDATA%\local.eyeprotect.pet\` 数据目录，不自动迁移 Electron 1.x 数据，也不能导入其备份。当前备份包含设置、任务、清单、活动任务与休息历史；喝水、番茄钟和任务通知投递状态不包含在内。

## 查找位置

| 领域 | 入口 |
| --- | --- |
| 程序装配、状态与持久化 | `src-tauri/src/lib.rs`、`state.rs`、`fsutil.rs` |
| 任务、清单、步骤与单次提醒 | `src-tauri/src/tasks.rs`、`task_reminders.rs`、`src/shared/simpleTasks.ts` |
| 休息与番茄钟 | `src-tauri/src/scheduler.rs`、`pomodoro.rs`、`reminder_context.rs`、`wincontext.rs` |
| 喝水与休息记录 | `src-tauri/src/hydration.rs`、`history.rs` |
| 窗口、托盘和设置 | `src-tauri/src/windows.rs`、`winarea.rs`、`tray.rs`、`types.rs` |
| 命令与 renderer 桥 | `src-tauri/src/commands.rs`、`src/renderer/src/lib/tauriBridge.ts`、`src/shared/types.ts` |
| 工作台和视觉 | `src/renderer/src/views/WorkbenchView.tsx`、`features/simple/SimpleSettings.tsx`、`views/PetView.tsx`、`views/AlertView.tsx` |
| 备份 | `src-tauri/src/backup.rs`；Tauri 备份 v1，不兼容 Electron v8 |

## 开发与验证

- 写操作经命令层处理，持久化成功后才发布任务变更；失败要向用户显示。修改 Rust 命令时同步检查共享接口和 Tauri bridge。
- 计时由 Rust 后端持有；renderer 不创建计时权威。休息调度与番茄钟变更补 Rust 测试，任务、步骤与数据完整性变更覆盖失败路径。
- `npm run dev` 启动 Tauri；`npm run package` 构建安装包、免安装 EXE 和校验值。
- 交付前运行 `npm run typecheck`、`npm test`、`cargo test --locked --manifest-path src-tauri/Cargo.toml` 和 `npm run lint`；打包后运行 `npm run smoke:tauri`、`npm run smoke:tauri-write-failure`、`npm run smoke:tauri-task-reminder`。记录实际验证和未完成的硬件验证。
- `src/main/`、`src/preload/` 及 `legacy:*` 脚本是保留的 Electron 历史实现，不作为新功能默认落点。`data/`、`out/`、`release/`、`artifacts/`、`src-tauri/target/` 和 `node_modules/` 不提交。
