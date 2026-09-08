# CLAUDE.md

EyeProtect 是本地优先的 Windows 休息提醒与待办助手，使用 Electron、electron-vite、React、严格 TypeScript。所有工作遵循 [RULES.md](RULES.md)；项目当前架构以 [docs/architecture.md](docs/architecture.md) 为准。

## 当前产品边界

主界面只有待办、完成记录、设置。任务按截止日期分组，使用简单清单；点击任务原地展开备注、日期、单次提醒与一层步骤。桌宠旁气泡展示手选任务或番茄钟。休息统一用遮罩，点击开始休息暂停专注，手动继续恢复。

旧项目/规划/工时/独立提醒/养成界面不在当前主流程。旧数据保留供备份、只读查看与恢复，不重新启用旧自动规则。

## 查找位置

| 领域 | 入口 |
| --- | --- |
| 主任务、清单、步骤 | src/main/taskService.ts、src/main/taskStore.ts、src/shared/simpleTasks.ts |
| 日期与 IPC | src/shared/types.ts、src/main/ipcTaskInput.ts、src/preload/index.ts、src/main/index.ts |
| 休息节奏与生命周期 | src/main/reminders.ts、src/main/scheduling/kernel.ts、src/main/activityMonitor.ts |
| 番茄钟 | src/main/pomodoro.ts、src/renderer/src/features/simple/PomodoroCard.tsx |
| 主界面与设置 | src/renderer/src/views/WorkbenchView.tsx、src/renderer/src/features/simple/SimpleSettings.tsx |
| 窗口与兜底 | src/main/windows.ts、src/main/windowBounds.ts、src/main/reminderSurface.ts |
| 数据兼容 | src/main/backup.ts；数据库 v5、备份 v7 |

## 开发约定

- 严格 TypeScript、两空格、单引号、分号；共享接口定义在 src/shared/types.ts。
- Renderer 不访问 Node/Electron，仅使用 window.eyeProtect。变更 IPC 同步更新类型、preload、主进程清洗与发送方限制。
- 变更通过命令层呈现错误；任务并发修改保留 baseRevision；批量完成/撤销先提交事务再推送。
- 颜色使用语义令牌；simple.css 拥有精简工作台样式，styles.css 拥有桌宠、气泡和休息窗口。
- 桌宠不订阅全量任务；拖动每次重申固定窗口尺寸，防止 Windows 分数 DPI 尺寸漂移。
- 所有倒计时由主进程拥有，复用 SchedulerKernel；不要在 renderer 创建计时权威或恢复旧工时追踪。
- data/、out/、release/、artifacts/、node_modules/ 为本地数据、生成物或依赖，不提交。

## 验证

交付前运行 npm run typecheck、npm test、npm run verify:ui-contract。资源/窗口变化运行 npm run package，并运行 npm run smoke:simple 的 1、1.25、1.5 缩放验收；--emergency 覆盖应急窗口。npm run smoke:pet-failure 验证桌宠失效仍能记任务和休息。

修改休息调度必须补 tests/reminders.test.ts 或 tests/pomodoro.test.ts 的对应行为测试；迁移、步骤和数据完整性测试放 tests/simple-experience.test.ts。记录实际通过的验证与未完成的硬件验证。
