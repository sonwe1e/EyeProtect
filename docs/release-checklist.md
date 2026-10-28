# 2.0 发布验收

- [ ] `npm run typecheck`、`npm test`、`cargo test --locked --manifest-path src-tauri/Cargo.toml` 和 `npm run lint` 通过。
- [ ] `npm run package` 通过版本和内置素材检查，生成 Windows x64 安装包、免安装 EXE 和 SHA-256 校验文件。
- [ ] `smoke:tauri`、`smoke:tauri-write-failure`、`smoke:tauri-task-reminder`、`smoke:tauri-startup-recovery` 使用隔离数据执行；分别检查实际窗口、持久化失败、任务提醒重启防重复和损坏数据的启动保护。
- [ ] 发布说明标明 2.0 使用独立数据目录、无法导入 Electron 备份；指导用户保留原版数据。说明 2.0 备份不包含喝水、番茄钟和任务通知投递状态。
- [ ] 发布说明标明免安装版也使用用户数据目录，安装版缺少 WebView2 时需要联网安装。
- [ ] 发布说明如实记录未移植的休息提醒兜底与锁屏监听，以及 Windows 通知和系统占用检测的限制。
- [ ] 多显示器、混合 DPI、实际登录自启及不同 Windows 版本覆盖未实际验证时不声称通过。
