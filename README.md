# EyeProtect

Windows 桌面的休息提醒与待办助手。2.0 使用 Tauri 2、Rust、React 和 TypeScript，数据保存在本机。Electron 1.x 版本停止维护。

## 下载与升级

从 [GitHub Releases](https://github.com/sonwe1e/EyeProtect/releases) 下载 Windows x64 版本：安装包 `EyeProtect-Setup-2.0.0-win-x64.exe`，或免安装的 `EyeProtect-2.0.0-win-x64.exe`。两者都使用 Windows 用户数据目录，免安装版不把数据保存在 EXE 同目录。应用需要 Microsoft Edge WebView2 Runtime；安装包缺少该运行时会尝试联网安装。

**从 1.x 升级前请保留旧版数据和备份。** 2.0 使用独立的 `%APPDATA%\local.eyeprotect.pet\` 目录，不自动迁移 Electron 版的设置、待办、休息记录和自定义桌宠，也不能导入 1.x 备份。旧安装版数据通常在 `%APPDATA%\eye-protect-pet\data\`，旧便携版数据在 EXE 旁的 `data` 目录；旧数据不由 2.0 读取。可继续使用原有 1.x 访问旧数据。

## 日常使用

- **待办**：输入名称、回车保存；顶部切换清单与搜索，拖动任务可调整队列顺序。
- 点击任务名称原地展开，填写截止日期、单次提醒、备注和一层步骤。截止日期只表示哪一天，几点通知由“提醒我”单独决定。
- 勾选完成主任务时，如有未完成步骤，会确认是否一起完成；撤销只恢复本次改动。
- **完成记录**：查看何时完成了什么，支持搜索和日期筛选，不将步骤重复算作独立成果。顶部显示“本周休息”：一句鼓励、完成休息次数和七天小图，不显示扣分或未达标提示。
- 悬停任务行，使用图钉选择放到桌宠气泡的任务；最多显示三行，更多内容滚动查看。更多操作中可调整浮窗顺序。
- 从桌宠时钟按钮或任务行开始专注，在同一个气泡里选择时长并启动番茄钟。可不关联任务，默认 25 分钟。
- 护眼或走动到时显示一条大字离屏引导，自动开始休息并暂停专注；每次由主进程随机选择建议、避开近期重复。到时提示并自动收起，不需要选模式、点击开始或打卡。仍可稍后或跳过；专注在休息后手动继续。番茄钟不自动循环或完成任务。
- 番茄钟重启后恢复为暂停；系统长时间中断由看门狗检测，并在恢复时暂停计时。锁屏本身目前没有独立检测。

## 设置

右上角设置仅包含休息提醒、桌面外观、应用三组。默认每 20 分钟护眼、每 60 分钟走动；初始休息时长分别为 30 秒、60 秒，可调整并单独关闭。使用统一的休息遮罩，也可关闭背景暗化。

默认桌宠是用户原作“火力奋斗猫”：火焰敲键盘、挥爪、打哈欠与睡觉 GIF 随安装包内置，干净安装也可用。还可选择抱贝壳吹泡泡的水獭、穿太空服接流星的企鹅，以及带四套装扮的复古像素猫；角色选择在桌面、休息界面与陪伴卡片同步。添加自定义素材后可选择“我的动图”。角色均直接可用，没有解锁或养成。

矢量伙伴放大后保持清晰，有轻微呼吸、眨眼和专属互动，完成待办或临近休息时回应。原作 GIF 保持原来的动画内容；关闭动画、窗口不可见或系统减少动态效果时，GIF 也会显示静止快照。提醒按当前显示器的可用逻辑尺寸适配；设置的“阅读大小（休息与工作台）”独立调大文字与内容，桌宠大小可另行调整。

“开机自启”默认关闭，开启后使用 Windows 当前用户的启动注册项。设置中的“智能选择提醒时机”默认关闭：开启后在会议应用前台或摄像头/麦克风使用时延后，连续输入时等待约 3 秒停顿。全屏应用和定时勿扰有独立开关。设备标记检测可能受 Windows 版本影响；键入检测只在本机计算次数与停顿，不保存输入内容。手动立即休息与测试提醒始终可用。

## 数据与已知差异

2.0 备份包含设置、任务和清单、活动任务与休息记录；喝水计数、番茄钟状态与任务提醒投递状态不包含在备份中。导入会先保存回滚快照。任务的单次提醒通过 Windows 通知发送，需要允许系统通知；应用关闭期间到期的任务会在下次启动后处理。免安装版使用 Windows 的 PowerShell 通知身份，通知的发送方可能显示为 PowerShell。

当前休息提醒没有 Electron 1.x 的应急窗口和原生通知兜底。摄像头和麦克风占用检测依赖系统标记，混合 DPI 多显示器场景尚未完成实机验收。

## 开发与验收

```powershell
npm ci
npm run dev
npm run typecheck
npm test
npm run lint
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run package
npm run smoke:tauri
npm run smoke:tauri-write-failure
npm run smoke:tauri-task-reminder
npm run smoke:tauri-startup-recovery
```

构建需要 Rust 工具链与 Tauri 的 Windows 构建环境。`npm run package` 将安装包、免安装 EXE 与校验值写入 `release/`。冒烟脚本使用独立数据目录和 WebView2 profile；任务提醒冒烟会向 Windows 发送一条测试通知。

源码规范见 [RULES.md](RULES.md)，当前架构见 [docs/architecture.md](docs/architecture.md)，交付验收见 [docs/release-checklist.md](docs/release-checklist.md)。`data/`、`out/`、`release/`、`artifacts/` 为运行或生成目录，不提交。
