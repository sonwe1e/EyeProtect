# EyeProtect 发布检查表

本清单以 `package.json` 中的当前版本和构建目标为准，不在文档中固定具体版本号。

## 自动验证

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run verify:ui-contract`
- [ ] `npm run build`
- [ ] `npm run package`
- [ ] packaged app：`npm run smoke:running -- <port>`
- [ ] reminder journey：`npm run smoke:experience -- <port>`
- [ ] Workbench 交互与重启持久化：分别运行 `npm run smoke:workbench-interactions -- <port> exercise` 和 `verify`
- [ ] Plan 交互与重启持久化：分别运行 `npm run smoke:plan-interactions -- <port> exercise` 和 `verify`
- [ ] emergency fallback：`npm run smoke:emergency -- <port>`
- [ ] pet renderer isolation：`npm run smoke:pet-failure -- <port>`
- [ ] `npm run capture:ui -- <port> <output-dir> --repeat 3` 生成三轮一致的布局指标

GitHub Actions 中的 Windows CI 会执行上述自动门禁，并额外生成 100%、125%、150% 和 200% scale-factor 截图。

## Windows 实体机矩阵

在 Windows 10 x64 和 Windows 11 x64 上分别验证 NSIS 与 portable：

- [ ] 首次启动、单实例、托盘退出、开机自启。
- [ ] 单屏与双屏（含缩放、旋转、拔插）下的桌宠、提醒卡片和暗色遮罩。
- [ ] idle 不足阈值后继续原周期；idle、锁屏、休眠超过阈值后重置周期。
- [ ] 系统时间前拨/后拨不改变活跃时间提醒；独立日历提醒仍在正确本地时间触发。
- [ ] 暂停后修改间隔，恢复仍使用冻结的当前周期；显式“重新开始”使用新设置。
- [ ] 主提醒 renderer 崩溃后应急 surface 可见；GPU 子进程异常不会误判无关窗口。
- [ ] 禁用系统通知后进入重试；重启后 occurrence 不重复消费，失败计数可见。
- [ ] 自动保存、切换任务不丢稿、Inbox/项目拖放、10 秒撤销、重复父任务树 rollover。
- [ ] Plan 拖放/resize、Project Board 分组、专注会话和重启持久化均正确。
- [ ] 主题（系统/浅色/深色）和密度（舒适/紧凑）在工作台、设置、桌宠与提醒 surface 中一致。
- [ ] Today、Task Detail、Command Palette、Plan、Project List/Board 在 960×600 及常见桌面尺寸下无页面级横向滚动或控件裁切。
- [ ] 每日公仔候选在同一天保持一致；收下/丢弃、固定/每日随机、改名、收藏、材质和配饰均在重启后保留。
- [ ] 桌宠单击互动、双击工作台、右键收藏互不冲突；护眼/走动/合并动作在三种提醒模式中正确显示。
- [ ] forced-colors 和 reduced-motion 下界面仍可操作，动画停在清晰的静态关键姿势。
- [ ] 导出后导入完整备份；故意导入无效文件时现有数据不变且回滚快照保留。
- [ ] 从旧任务状态库升级时先确认并生成 `pre-model-reset` 快照；取消进入恢复模式。

## 发行产物

设 `version` 为 `package.json` 中的版本：

- [ ] `release/EyeProtect-Setup-<version>-win-x64.exe`
- [ ] `release/EyeProtect-<version>-win-x64-portable.exe`
- [ ] 两个产物均包含应用图标和 `public/assets/tray-icon.png`；公仔与提醒视觉不依赖旧固定 PNG。
- [ ] PR/Release notes 记录用户可见变化、数据迁移策略、验证命令和 UI 截图。
- [ ] 不提交 `data/`、`out/`、`release/`、`artifacts/`、`node_modules/` 或本机工具缓存。
