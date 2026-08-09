# EyeProtect

EyeProtect 是一个 local-first 的 Windows 护眼与工作节奏助手。应用常驻托盘并显示透明桌宠；统一工作台负责今日任务、项目、独立提醒、健康节奏和设置。

## 1.1 功能

- 护眼与走动提醒使用统一调度内核，接近到期时合并展示；支持完成、稍后、跳过、暂停和重新开始周期。
- 护眼周期按“活跃使用时间”推进。系统空闲、锁屏或休眠时冻结；达到可配置的自然离开阈值（默认 5 分钟）后，返回时重新开始两个周期。
- 系统时钟调整不会提前或延后活跃时间提醒；日历时间的独立提醒仍遵循本地墙钟。
- 提醒界面由一个 Surface Manager 管理；主提醒渲染器异常时会依次降级到应急窗口和系统通知。
- 桌宠由本地种子实时生成 SVG 结构，不再把固定姿势图片当作皮肤。每天会有一位随机访客，可收集、改名、收藏、固定出场，并独立切换材质与配饰。
- 护眼、走动与合并提醒复用当前公仔的程序化动作；gentle 气泡使用精简动作，guided/focused 卡片使用完整舞台，reduced-motion 下停在静态关键姿势。
- 工作台包含 Today、Inbox、Upcoming、Overdue、Away、Completed 与项目视图，支持全库搜索、临时筛选、自动保存、拖放/键盘排序和 10 秒持久撤销。
- 当前任务与任务状态分离。Rhythm 条同时显示连续活跃时间和当前任务活跃时间；任务达到预估时长时只轻提示一次。
- 重复父任务完成后会创建下一周期的完整子任务树；子任务重置为未完成并保留相对日期。
- 任务、独立提醒和 timebox 共用持久化通知队列。只有系统通知 `show()` 成功后才消费 occurrence，失败按 30 秒、2 分钟、5 分钟重试。
- 设置支持跟随系统/浅色/深色主题、舒适/紧凑密度、免打扰、前台应用白名单、自适应节奏、全局快捷键和本地健康周报。
- 完整 JSON 备份包含设置、任务、项目、独立提醒、公仔收藏和提醒历史。导入前创建回滚快照；数据库升级前需确认并创建快照，失败时原数据库不会被覆盖。

## 数据与架构

- `data/settings.json`：偏好设置。
- `data/runtime-state.json`：护眼周期和暂停状态。
- `data/reminder-history.json`：本地健康趋势。
- `data/eyeprotect.db`：SQLite Task Core、独立提醒、公仔收藏、通知投递、任务工时和撤销状态。

Renderer 不直接访问 Node/Electron；窗口能力统一经 sandboxed preload 和主进程 IPC。桌宠是唯一常驻 renderer，工作台按需创建；提醒窗口在结束后销毁。

若 SQLite 打开或迁移失败，EyeProtect 会保留数据库文件族快照，并以内存恢复会话启动。恢复会话不写回原数据库，设置页会显示快照路径和数据目录入口。

## 开发与验证

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

提醒体验 smoke test 需要先以 `--remote-debugging-port=9333` 启动隔离实例：

```powershell
npm run smoke:experience -- 9333
npm run smoke:emergency -- 9333
```

## 打包

```powershell
npm run package
```

默认在 `release/` 生成 Windows 10/11 x64 的 NSIS 安装包和 portable exe。发行前按 [1.1 发布检查表](docs/1.1-release-checklist.md) 完成实体机验证。
